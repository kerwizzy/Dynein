const isSignalSymbol = Symbol("isSignal");

// Internal state variables
let assertedStatic = false;
let collectingDependencies = false;

let currentOwner:
	| Owner
	| null /* root on purpose */
	| undefined /* root probably not on purpose, so create a warning */ = undefined;

// Values overlayed on top of currentOwner.contextValues
let contextValues: Map<Context<any>, any> | null = null

function updateState<T>(
	new_assertedStatic: boolean,
	new_collectingDependencies: boolean,
	new_currentOwner: Owner | null | undefined,
	inner: () => T
) {
	const old_assertedStatic = assertedStatic;
	const old_collectingDependencies = collectingDependencies;
	const old_currentOwner = currentOwner;

	assertedStatic = new_assertedStatic;
	collectingDependencies = new_collectingDependencies;
	currentOwner = new_currentOwner;
	try {
		return inner();
	} finally {
		assertedStatic = old_assertedStatic;
		collectingDependencies = old_collectingDependencies;
		currentOwner = old_currentOwner;
	}
}

export function _getInternalState() {
	return { assertedStatic, collectingDependencies, currentOwner }
}

export function untrack<T>(inner: () => T): T {
	return updateState(false, false, currentOwner, inner);
}
export function retrack<T>(inner: () => T): T {
	return updateState(assertedStatic, true, currentOwner, inner);
}

const sample = untrack;
export { sample };

export function assertStatic<T>(inner: () => T): T {
	return updateState(true, false, currentOwner, inner);
}
export function runWithOwner<T>(owner: Owner | null | undefined, inner: () => T): T {
	return updateState(owner?.assertedStatic ?? false, owner?.collectingDependencies ?? false, owner, inner);
}

// Returns a "restore point" that can be used with runWithOwner to restore the current effect,
// collectingDependencies, assertedStatic, and contextValues state
export function getOwner(): Owner | null | undefined {
	if (!currentOwner) {
		return currentOwner;
	} else if (currentOwner.collectingDependencies === collectingDependencies && currentOwner.assertedStatic === assertedStatic && contextValues === null) {
		return currentOwner
	} else {
		/* TODO: Maybe change this because it might cause unexpected behavior for .destroy()?

		e.g., with

			innerOwner
			createEffect(()=>{
				untrack(()=>{
					innerOwner = getOwner()
				})
			})

		This won't do anything:
			innerOwner.destroy()

		Could fix this by adding some flag in Owner, like .destroyParentOnDestroyCall

		*/
		return new Owner(currentOwner)
	}
}
export function createRoot<T>(inner: (dispose: ()=>void)=>T): T {
	return updateState(false, false, currentOwner, ()=>{
		const owner = new Owner(null)
		return runWithOwner(owner, ()=>inner(()=>owner.destroy()))
	})
}

export type Context<T> = {
	readonly defaultValue: T
}

export function createContext<T>(): Context<T | undefined>
export function createContext<T>(defaultValue: T): Context<T>
export function createContext(defaultValue?: any): Context<any> {
	return {defaultValue}
}

export function runWithContext<T, R>(context: Context<T>, value: T, inner: ()=>R): R {
	const old_contextValues = contextValues
	if (!contextValues) {
		contextValues = new Map()
	}
	const old_hasValue = old_contextValues && contextValues.has(context)
	const old_value = old_hasValue && contextValues.get(context)

	contextValues.set(context, value)
	try {
		return inner()
	} finally {
		if (!old_contextValues) {
			contextValues = null
		} else if (!old_hasValue) {
			contextValues.delete(context)
		} else {
			contextValues.set(context, old_value)
		}
	}
}

export function saveContexts(contexts: Context<any>[]): <T>(inner: ()=>T) => T {
	let restoreContexts = <T>(inner: ()=>T)=>inner()

	for (const ctx of contexts) {
		const innerRestoreContexts = restoreContexts
		const val = useContext(ctx)
		restoreContexts = (inner)=>runWithContext(ctx, val, ()=>innerRestoreContexts(inner))
	}

	return restoreContexts
}

export function useContext<T>(context: Context<T>): T {
	if (contextValues?.has(context)) {
		return contextValues!.get(context)
	}

	let owner = currentOwner
	while (owner) {
		if (owner.contextValues?.has(context)) {
			return owner.contextValues!.get(context)
		}
		owner = owner.parent
	}

	return context.defaultValue
}

export interface Destructable {
	destroy(): void;
	parent: Owner | null;
}

// Any owners created as root (i.e., with `parent` null or undefined)
// are added to this object so that the owners will never be garbage collected.
const rootOwners = new Set<any>()

///*DEBUG*/let debugIDCounter = 0;
// A simple tree for destroying all descendant contexts when an ancestor is destroyed
export class Owner implements Destructable {
	///*DEBUG*/debugID: string;
	protected children: Set<Destructable> = new Set();
	readonly isDestroyed: boolean = false;
	parent: Owner | null = null;

	readonly assertedStatic: boolean
	readonly collectingDependencies: boolean
	readonly contextValues: ReadonlyMap<Context<any>, any> | null

	///*DEBUG*/protected createContext: any
	///*DEBUG*/protected destroyContext: any

	constructor(parent: Owner | null | undefined = currentOwner) {
		///*DEBUG*/this.debugID = (debugIDCounter++).toString();

		///*DEBUG*/this.createContext = new Error(`Create Owner@${this.debugID}`)

		this.assertedStatic = assertedStatic
		this.collectingDependencies = collectingDependencies
		this.contextValues = contextValues && new Map(contextValues)

		///*DEBUG*/console.trace(`Owner@${this.debugID}: create`);
		if (parent === undefined) {
			console.trace("Destructables created outside of a `createRoot` will never be disposed.")
		}

		if (!parent) {
			rootOwners.add(this);
		} else {
			parent.addChild(this);
		}
	}

	addChild(thing: Destructable) {
		///*DEBUG*/console.log(`Owner@${this.debugID}: add child`, thing);
		if (this.isDestroyed) {
			///*DEBUG*/console.log(this.createContext, this.destroyContext)
			///*DEBUG*/throw new Error(`Owner@${this.debugID}: Can't add to destroyed context.`);
			throw new Error("Can't add to destroyed context.");
		}
		thing.parent = this;
		this.children.add(thing);
	}

	destroy() {
		///*DEBUG*/this.destroyContext = new Error(`Destroy Owner@${this.debugID}`)
		///*DEBUG*/console.log(`Owner@${this.debugID}: destroy`);

		//@ts-ignore
		this.isDestroyed = true;
		if (this.parent) {
			this.parent.children.delete(this);
			this.parent = null;
		}
		this.reset();
	}

	reset() {
		///*DEBUG*/console.log(`Owner@${this.debugID}: reset`);
		const children = this.children

		// if one of the child destructors triggers `reset` again, we don't
		// want it to rerun `reset` with the same list, because that would cause an infinite loop
		this.children = new Set()

		for (const child of children) {
			child.parent = null;
			child.destroy();
		}
	}
}

export type Signal<T> = (() => T) & (<U extends T>(newVal: U) => U) & {[isSignalSymbol]: true}

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
	const handler = new DependencyHandler(init);
	const signal = toSignal(
		() => handler.read(),
		(val) => handler.write(val, fireWhenEqual)
	);
	// the above makes GC of `handler` depend on GC of `signal`

	// This makes GC of `signal` depends on GC of `handler`, so now
	// GC of signal and handler are linked. (This is important for @dynein/shared-signals)
	handler.dependents.add(signal);

	return signal;
}

export function isSignal(thing: any): thing is Signal<any> {
	return thing && thing[isSignalSymbol] === true;
}

export function createEffect(fn: () => void): Destructable {
	return new Effect(fn);
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
	if (currentOwner === undefined) {
		console.trace("Destructables created outside of a `createRoot` will never be disposed.")
	}
	currentOwner?.addChild({ destroy: ()=>{
		try {
			runWithOwner(undefined, fn)
		} catch (err) {
			console.warn("Caught error in cleanup function:",err)
		}
	}, parent: null });
}

export function batch(fn: () => void) {
	currentUpdateQueue.delayStart(fn);
}

export function onBatchEnd(fn: ()=>void) {
	currentUpdateQueue.schedule(fn)
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
	thisTick: Set<() => void>;
	nextTick: Set<() => void>;
	ticking: boolean;
	startDelayed: boolean;

	constructor(parent: UpdateQueue | null = null) {
		this.parent = parent;
		this.thisTick = new Set();
		this.nextTick = new Set();
		this.ticking = false;
		this.startDelayed = false;
	}

	start() {
		if (this.ticking || this.startDelayed) {
			return;
		}

		let subTickN = 0;
		this.ticking = true;
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
			for (const fn of this.thisTick) {
				this.thisTick.delete(fn);
				try {
					fn();
				} catch (err) {
					console.warn("Caught error", err, "in tick function", fn);
				}
			}
		}
		this.ticking = false;
	}

	subclock(fn: () => void) {
		const oldUpdateQueue = currentUpdateQueue;
		currentUpdateQueue = new UpdateQueue(this);
		try {
			fn();
		} finally {
			currentUpdateQueue = oldUpdateQueue;
		}
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

	unschedule(fn: any) {
		this.thisTick.delete(fn);
		this.nextTick.delete(fn);
		this.parent?.unschedule(fn);
	}

	schedule(fn: () => void) {
		if (this.ticking && this.thisTick.has(fn)) {
			// if this is already scheduled on the current tick but not started yet, don't schedule it
			// again on the next tick
			return;
		}

		this.parent?.unschedule(fn);
		this.nextTick.add(fn);
		this.start();
	}
}

let currentUpdateQueue = new UpdateQueue();

// Internal class created by createEffect. Collects dependencies of `fn` and rexecutes `fn` when
// dependencies update.
class Effect extends Owner {
	private readonly fn: () => void;
	readonly sources: Set<DependencyHandler<any>>;
	private readonly boundExec: () => void;
	private executing: boolean = false;
	private destroyPending: boolean = false;

	constructor(fn: () => void) {
		super();
		this.fn = fn.bind(undefined);
		this.sources = new Set();
		this.boundExec = this.exec.bind(this);
		currentUpdateQueue.delayStart(this.boundExec);
	}

	exec() {
		if (this.isDestroyed) {
			return;
		}

		for (const src of this.sources) {
			src.drains.delete(this);
		}
		this.sources.clear();
		try {
			this.executing = true;
			updateState(false, true, this, this.fn);
		} finally {
			this.executing = false;
			if (this.destroyPending) {
				this.destroy();
			}
		}
	}

	destroy() {
		if (this.executing) {
			this.destroyPending = true;
		} else {
			super.destroy();
		}
	}

	schedule() {
		this.reset(); // Destroy subwatchers
		currentUpdateQueue.schedule(this.boundExec);
	}
}

function findParentEffect(c: Owner | null | undefined): Effect | null | undefined {
	return c && (c instanceof Effect ? c : findParentEffect(c.parent));
}

class DependencyHandler<T> {
	value: T;
	drains: Set<Effect>;

	dependents: Set<any> = new Set(); //for GC stuff

	constructor(value: T) {
		this.value = value
		this.drains = new Set();
	}

	read(): T {
		const currentComputation = findParentEffect(currentOwner);
		if (collectingDependencies && currentComputation) {
			currentComputation.sources.add(this);
			this.drains.add(currentComputation);
		} else if (assertedStatic) {
			console.error("Looks like you might have wanted to add a dependency but didn't.");
		}
		return this.value;
	}

	write(val: T, updateOnEqual: boolean) {
		currentUpdateQueue.delayStart(() => {
			const changedValue = this.value !== val;
			this.value = val;

			if (updateOnEqual || changedValue) {
				for (const drain of this.drains) {
					drain.schedule();
				}
			}
		});
	}
}
