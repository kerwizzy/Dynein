const DEBUG = false;
const isSignalSymbol = Symbol("isSignal");

// Internal state variables
let assertedStatic = false;
let collectingDependencies = true;

let currentOwnerScope:
	| DestructionScope
	| null /* root on purpose */
	| undefined /* root probably not on purpose, so create a warning */ = undefined;

function updateState<T>(
	new_assertedStatic: boolean,
	new_collectingDependencies: boolean,
	new_currentOwnerScope: DestructionScope | null | undefined,
	inner: () => T
) {
	const old_assertedStatic = assertedStatic;
	const old_collectingDependencies = collectingDependencies;
	const old_currentOwnerScope = currentOwnerScope;

	assertedStatic = new_assertedStatic;
	collectingDependencies = new_collectingDependencies;
	currentOwnerScope = new_currentOwnerScope;
	try {
		return inner();
	} finally {
		assertedStatic = old_assertedStatic;
		collectingDependencies = old_collectingDependencies;
		currentOwnerScope = old_currentOwnerScope;
	}
}

export function _getInternalState() {
	return { assertedStatic, collectingDependencies, currentOwnerScope }
}

export function untrack<T>(inner: () => T): T {
	return updateState(false, false, currentOwnerScope, inner);
}
export function retrack<T>(inner: () => T): T {
	return updateState(assertedStatic, true, currentOwnerScope, inner);
}

const sample = untrack;
export { sample };

export function assertStatic<T>(inner: () => T): T {
	return updateState(true, false, currentOwnerScope, inner);
}
export function runInScope<T>(owner: DestructionScope | null | undefined, inner: () => T) {
	return updateState(assertedStatic, collectingDependencies, owner, inner);
}
export function getScope(): DestructionScope | null | undefined {
	return currentOwnerScope;
}
export function createRootScope<T>(inner: ()=>T): T {
	return runInScope(null, inner)
}

export interface Destructable {
	destroy(): void;
	parent: DestructionScope | null;
}

let debugIDCounter = 0;
// A simple tree for destroying all descendant contexts when an ancestor is destroyed
export class DestructionScope implements Destructable {
	debugID: string;
	protected children: Set<Destructable> = new Set();
	protected destroyed: boolean = false;
	parent: DestructionScope | null = null;

	constructor(parentScope: DestructionScope | null | undefined = currentOwnerScope) {
		this.debugID = (debugIDCounter++).toString();
		if (DEBUG) {
			console.trace(`DestructionScope@${this.debugID}: create`);
		}
		if (parentScope === undefined) {
			console.trace("Destructables created outside of a `createRoot` will never be disposed.")
		}
		parentScope?.addChild(this);
	}

	addChild(thing: Destructable) {
		if (DEBUG) {
			console.log(`DestructionScope@${this.debugID}: add child`, thing);
		}
		if (this.destroyed) {
			throw new Error(`DestructionScope@${this.debugID}: Can't add to destroyed context.`);
		}
		thing.parent = this;
		this.children.add(thing);
	}

	destroy() {
		if (DEBUG) {
			console.log(`DestructionScope@${this.debugID}: destroy`);
		}
		this.destroyed = true;
		if (this.parent) {
			this.parent.children.delete(this);
			this.parent = null;
		}
		this.reset();
	}

	reset() {
		if (DEBUG) {
			console.log(`DestructionScope@${this.debugID}: reset`);
		}
		for (const child of this.children) {
			child.parent = null;
			child.destroy();
		}
		this.children.clear();
	}

	resume(fn: () => void) {
		// Notice does NOT call reset
		runInScope(this, fn);
	}
}

export type Signal<T> = (()=> T) & ((newVal: T) => T)

export function toSignal<T>(getter: () => T, setter: (value: T) => void): Signal<T> {
	const signalWrapper = function (newVal?: T) {
		if (arguments.length === 0) {
			return getter();
		} else {
			if (arguments.length !== 1) {
				throw new Error(
					"Expected exactly 0 or 1 arguments to a signal read/write function, got " +
						arguments.length
				);
			}
			setter(newVal!);
			return newVal!;
		}
	} as Signal<T>;
	//@ts-ignore
	signalWrapper[isSignalSymbol] = true;
	//@ts-ignore
	return signalWrapper;
}

export function createSignal<T>(init: T, fireWhenEqual: boolean = false): Signal<T> {
	const handler = new SimpleValueHandler(init);
	const signal = toSignal(
		() => handler.read(),
		(val) => handler.write(val, fireWhenEqual)
	);

	// make GC of signal and handler be linked. (This is important for @dynein/shared-state)
	handler.dependents.add(signal);

	//@ts-ignore
	return signal;
}

export function isSignal(thing: any): thing is Signal<any> {
	return thing && thing[isSignalSymbol] === true;
}

export function createEffect(fn: () => void): Destructable {
	const effect = new Effect(fn);
	currentUpdateQueue.delayStart(() => {
		effect.exec();
	});
	return effect;
}

export function onUpdate<T>(signal: () => T, listener: (newValue: T) => void): Destructable {
	let isFirst = true;
	return createEffect(() => {
		const newValue = signal();
		if (!isFirst) {
			untrack(() => {
				listener(newValue);
			});
		}
		isFirst = false;
	});
}

export function createMemo<T>(fn: () => T, fireWhenEqual: boolean = false): () => T {
	const internalSignal = createSignal<T>(undefined as unknown as T, fireWhenEqual);
	createEffect(() => {
		internalSignal(fn());
	});
	return () => internalSignal();
}


export function onCleanup(fn: () => void) {
	currentOwnerScope?.addChild({ destroy: fn, parent: null });
}

export function batch(fn: () => void) {
	currentUpdateQueue.delayStart(fn);
}

export function subclock(fn: () => void) {
	currentUpdateQueue.subclock(fn);
}

// Necessary since console isn't part of the default Typescript defs, and we don't want to include
// either DOM or @types/node as deps of this module.
interface Console {
	error(...data: any[]): void;
	log(...data: any[]): void;
	warn(...data: any[]): void;
	trace(...data: any[]): void;
}

declare var console: Console;

// Internal class to keep track of pending updates
class UpdateQueue {
	parent: UpdateQueue | null;
	thisTick: Map<any, () => void>;
	nextTick: Map<any, () => void>;
	ticking: boolean;
	startDelayed: boolean;

	constructor(parent: UpdateQueue | null = null) {
		this.parent = parent;
		this.thisTick = new Map();
		this.nextTick = new Map();
		this.ticking = false;
		this.startDelayed = false;
	}

	start() {
		if (this.ticking || this.startDelayed) {
			return;
		}

		let subTickN = 0;
		this.ticking = true;
		let firstErr;
		while (true) {
			const tmp = this.thisTick;
			this.thisTick = this.nextTick;
			this.nextTick = tmp;
			this.nextTick.clear();

			if (this.thisTick.size === 0) {
				break;
			}
			if (subTickN > 10000) {
				console.warn("Runaway update detected");
				break;
			}

			subTickN++;
			for (const [key, fn] of this.thisTick) {
				this.thisTick.delete(key);
				try {
					fn();
				} catch (err) {
					console.warn("Caught error", err, "in tick function", fn);
					if (!firstErr) {
						firstErr = err;
					}
				}
			}
		}
		this.ticking = false;
		if (firstErr) {
			throw firstErr;
		}
	}

	subclock(fn: () => void) {
		const oldUpdateQueue = currentUpdateQueue;
		currentUpdateQueue = new UpdateQueue(this);
		fn();
		currentUpdateQueue = oldUpdateQueue;
	}

	delayStart(fn: () => void) {
		const oldStartDelayed = this.startDelayed;
		this.startDelayed = true;
		try {
			fn();
		} finally {
			this.startDelayed = oldStartDelayed;
			this.start();
		}
	}

	unschedule(key: any) {
		this.thisTick.delete(key);
		this.nextTick.delete(key);
		this.parent?.unschedule(key);
	}

	schedule(key: any, fn: () => void) {
		if (this.ticking && this.thisTick.has(key)) {
			// if this is already scheduled on the current tick but not started yet, don't schedule it
			// again on the next tick
			return;
		}
		this.parent?.unschedule(key);
		this.nextTick.set(key, fn);
		this.start();
	}
}

let currentUpdateQueue = new UpdateQueue();

// Internal class created by createEffect. Collects dependencies of `fn` and rexecutes `fn` when
// dependencies update.
class Effect extends DestructionScope {
	private fn: () => void;
	private sources: Set<DependencyHandler<any>>;
	boundExec: () => void;
	private executing: boolean = false;
	private pendingDestroy: boolean = false;

	constructor(fn: () => void) {
		super();
		this.fn = fn.bind(undefined);
		this.sources = new Set();
		this.boundExec = this.exec.bind(this);
	}

	addSource(src: DependencyHandler<any>) {
		this.sources.add(src);
	}

	exec() {
		if (this.destroyed) {
			return;
		}

		this.removeSources();
		try {
			this.executing = true;

			updateState(false, true, this, this.fn);
		} finally {
			this.executing = false;
			if (this.pendingDestroy) {
				this.destroy();
			}
		}
	}

	destroy() {
		if (this.executing) {
			this.pendingDestroy = true;
		} else {
			super.destroy();
		}
	}

	schedule() {
		this.reset(); // Destroy subwatchers
		currentUpdateQueue.schedule(this, this.boundExec);
	}

	removeSources() {
		for (let src of this.sources) {
			src.removeDrain(this);
		}
		this.sources.clear();
	}
}

function findParentComputation(c: DestructionScope | null | undefined): Effect | null | undefined {
	return c && (c instanceof Effect ? c : findParentComputation(c.parent));
}

abstract class DependencyHandler<T> {
	abstract value: T;
	drains: Set<Effect>;

	dependents: Set<any> = new Set(); //for GC stuff

	constructor() {
		this.drains = new Set();
	}

	read(): T {
		const currentComputation = findParentComputation(currentOwnerScope);
		if (collectingDependencies && currentComputation) {
			currentComputation.addSource(this);
			this.addDrain(currentComputation);
		} else if (assertedStatic) {
			console.error("Looks like you might have wanted to add a dependency but didn't.");
		}
		return this.value;
	}

	fire(val: T, doWrite: boolean, updateOnEqual: boolean) {
		currentUpdateQueue.delayStart(() => {
			let changedValue = false;
			if (doWrite) {
				if (sample(() => this.value) !== val) {
					changedValue = true;
				}
				this.value = val;
			}

			if (!doWrite || updateOnEqual || changedValue) {
				for (let drain of this.drains) {
					drain.schedule();
				}
			}
		});
	}

	write(val: T, updateOnEqual: boolean) {
		this.fire(val, true, updateOnEqual);
	}

	addDrain(comp: Effect) {
		this.drains.add(comp);
	}

	removeDrain(comp: Effect) {
		this.drains.delete(comp);
	}
}

class SimpleValueHandler<T> extends DependencyHandler<T> {
	value: T;

	constructor(init: T) {
		super();
		this.value = init;
	}
}
