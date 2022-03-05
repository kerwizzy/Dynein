const DEBUG = false
const dataSignalSymbol = Symbol("dataSignalSymbol");

// Internal state variables
let warnOnNoDepAdd = false;
let ignored = false;

// Change internal state variables controling dependency collection
function setIgnored<T>(newIgnored: boolean, newWarnOnNoDepAdd: boolean, inner: () => T): T {
	const oldIgnored = ignored;
	ignored = newIgnored;
	const oldWarnOnNoDepAdd = warnOnNoDepAdd;
	warnOnNoDepAdd = newWarnOnNoDepAdd;
	let out;
	try {
		out = inner();
	} finally {
		ignored = oldIgnored;
		warnOnNoDepAdd = oldWarnOnNoDepAdd;
	}
	return out;
}

// For test purposes, not part of the official API
export function getInternalState() {
	return { currentContext, warnOnNoDepAdd, ignored };
}

export interface Destructable {
	destroy(): void;
	parent: DestructionContext | undefined;
}

let debugIDCounter = 0
// A simple tree for destroying all descendant contexts when an ancestor is destroyed
class DestructionContext implements Destructable {
	debugID: string
	protected children: Set<Destructable> = new Set();
	protected destroyed: boolean = false;
	parent: DestructionContext | undefined = undefined;

	constructor() {

		this.debugID = (debugIDCounter++).toString()
		if (DEBUG) {
			console.trace(`DestructionContext@${this.debugID}: create`)
		}
		addToContext(this);
	}

	addChild(thing: Destructable) {
		if (DEBUG) {
			console.log(`DestructionContext@${this.debugID}: add child`, thing)
		}
		if (this.destroyed) {
			throw new Error(`DestructionContext@${this.debugID}: Can't add to destroyed context.`);
		}
		thing.parent = this;
		this.children.add(thing);
	}

	destroy() {
		if (DEBUG) {
			console.log(`DestructionContext@${this.debugID}: destroy`)
		}
		this.destroyed = true;
		if (this.parent) {
			this.parent.children.delete(this)
			this.parent = undefined
		}
		this.reset();
	}

	reset() {
		if (DEBUG) {
			console.log(`DestructionContext@${this.debugID}: reset`)
		}
		for (const child of this.children) {
			child.parent = undefined;
			child.destroy();
		}
		this.children.clear();
	}

	resume(fn: () => void) {
		// Notice does NOT call reset
		setContext(this, fn);
	}
}

export { DestructionContext };

let currentContext:
	| DestructionContext
	| null /* root context on purpose */
	| undefined /* probably accidental root context, warn when adding */ = undefined;

function addToContext(child: Destructable) {
	if (currentContext === undefined) {
		console.trace("Unanchored destructable");
	}
	if (currentContext) {
		currentContext.addChild(child);
	}
}

function setContext<T>(ctx: DestructionContext | null | undefined, inner: () => T) {
	const oldCtx = currentContext;
	currentContext = ctx;
	if (DEBUG) {
		console.log(`Enter context @${ctx?.debugID ?? ctx}`)
	}
	try {
		return inner();
	} finally {
		if (DEBUG) {
			console.log(`Leave context @${ctx?.debugID ?? ctx}`)
		}
		currentContext = oldCtx;
	}
}

// Singleton API object and default export
const DyneinState = {
	watch(fn: () => void): Destructable {
		const comp = new Computation(fn);
		updateQueue.delayStart(()=>{
			comp.exec();
		})
		return comp;
	},

	on<T>(signal: () => T, listener: (newValue: T) => void): Destructable {
		let isFirst = true;
		return DyneinState.watch(() => {
			const newValue = signal();
			if (!isFirst) {
				DyneinState.ignore(() => {
					listener(newValue);
				});
			}
			isFirst = false;
		});
	},

	when(cond: (isFirst: boolean) => boolean, listener: () => void): Destructable {
		let lastVal = false;
		let isFirst = true;
		return DyneinState.watch(() => {
			const val = cond(isFirst);
			if (val && !lastVal) {
				DyneinState.ignore(() => {
					listener();
				});
			}
			lastVal = val;
			isFirst = false;
		});
	},

	memo<T>(fn: () => T, updateOnEqual = false): () => T {
		const internalSignal = DyneinState.datavalue<T>(undefined as unknown as T, updateOnEqual);
		DyneinState.watch(() => {
			internalSignal(fn());
		});
		return () => internalSignal();
	},

	root(fn: () => void): DestructionContext {
		let ctx: DestructionContext
		setContext(null, ()=>{
			ctx = new DestructionContext()
			setContext(ctx, fn)
		})
		return ctx!
	},

	setContext,
	DestructionContext,

	getContext() {
		return currentContext
	},

	cleanup(fn: () => void) {
		addToContext({ destroy: fn, parent: undefined });
	},

	batch(fn: () => void) {
		updateQueue.delayStart(fn);
	},

	subclock(fn: () => void) {
		updateQueue.subclock(fn);
	},

	datavalue<T>(init: T, updateOnEqual: boolean) {
		return makeSignalFromHandler(new SimpleValueHandler(init), updateOnEqual);
	},

	data<T>(init: T) {
		return DyneinState.datavalue(init, true);
	},

	value<T>(init: T) {
		return DyneinState.datavalue(init, false);
	},

	makeSignal<T>(getter: () => T, setter: (val: T) => void): DataSignal<T> {
		const out = function (newVal?: T) {
			if (arguments.length === 0) {
				return getter();
			} else {
				if (arguments.length !== 1) {
					throw new Error(
						"must have exactly 0 or 1 arguments to a value signal read/write function"
					);
				}
				setter(newVal!);
				return newVal!;
			}
		} as DataSignal<T>;
		//@ts-ignore
		out[dataSignalSymbol] = true;
		return out;
	},

	ignore<T>(inner: () => T): T {
		return setIgnored(true, false, inner);
	},

	// Alias for ignore to improve readability in certain contexts
	sample<T>(getter: () => T): T {
		return DyneinState.ignore(getter);
	},

	expectStatic<T>(inner: () => T): T {
		return setIgnored(true, true, inner);
	},

	unignore(inner: () => void): void {
		return setIgnored(false, warnOnNoDepAdd, inner);
	},

	isDataSignal(thing: any): thing is DataSignal<any> {
		return thing && thing[dataSignalSymbol] === true;
	}
};

export interface DataSignal<T> {
	(): T;
	(newVal: T): T;
	readonly [dataSignalSymbol]: true;
}

function makeSignalFromHandler<T>(handler: DataSignalDependencyHandler<T>, updateOnEqual: boolean) {
	const signal = DyneinState.makeSignal(
		() => handler.read(),
		(val) => handler.write(val, updateOnEqual)
	);
	handler.dependents.add(signal) //needed to make GC of signal not run when it shouldn't
	return signal
}

// Necessary since console isn't part of the default Typescript defs, and I don't want to include
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
	parent: UpdateQueue | null
	thisTick: Map<any, () => void>;
	nextTick: Map<any, () => void>;
	ticking: boolean;
	startDelayed: boolean;

	constructor(parent: UpdateQueue | null = null) {
		this.parent = parent
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
			if (subTickN > 100) {
				console.warn("Runaway update detected");
				break;
			}

			subTickN++;
			for (let [key, val] of this.thisTick) {
				this.thisTick.delete(key)
				try {
					val();
				} catch (err) {
					console.warn("Caught error", err, "in tick function", val);
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

	subclock(fn: ()=>void) {
		const oldUpdateQueue = updateQueue
		updateQueue = new UpdateQueue(this)
		fn()
		updateQueue = oldUpdateQueue
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
		this.thisTick.delete(key)
		this.nextTick.delete(key)
		this.parent?.unschedule(key)
	}

	schedule(key: any, fn: () => void) {
		if (this.ticking && this.thisTick.has(key)) {
			// if this is already scheduled on the current tick but not started yet, don't schedule it
			// again on the next tick
			return
		}
		this.parent?.unschedule(key)
		this.nextTick.set(key, fn);
		this.start();
	}
}

let updateQueue = new UpdateQueue();

// Internal class created by DyneinState.watch. Collects dependencies of `fn` and rexecutes `fn` when
// dependencies update.
class Computation extends DestructionContext {
	private fn: () => void;
	private sources: Set<DataSignalDependencyHandler<any>>;
	boundExec: () => void;
	private executing: boolean = false
	private pendingDestroy: boolean = false

	constructor(fn: () => void) {
		super();
		this.fn = fn.bind(undefined);
		this.sources = new Set();
		this.boundExec = this.exec.bind(this);
	}

	addSource(src: DataSignalDependencyHandler<any>) {
		this.sources.add(src);
	}

	exec() {
		if (this.destroyed) {
			return;
		}

		this.removeSources()
		try {
			this.executing = true
			setContext(this, () => {
				setIgnored(false, warnOnNoDepAdd, this.fn);
			});
		} finally {
			this.executing = false
			if (this.pendingDestroy) {
				this.destroy()
			}
		}
	}

	destroy() {
		if (this.executing) {
			this.pendingDestroy = true
		} else {
			super.destroy()
		}
	}

	schedule() {
		this.reset() // Destroy subwatchers
		updateQueue.schedule(this, this.boundExec);
	}

	removeSources() {
		for (let src of this.sources) {
			src.removeDrain(this);
		}
		this.sources.clear();
	}
}

function findParentComputation(c: typeof currentContext): Computation | undefined | null {
	return c && (c instanceof Computation ? c : findParentComputation(c.parent));
}

abstract class DataSignalDependencyHandler<T> {
	abstract value: T;
	drains: Set<Computation>;

	dependents: Set<any> = new Set() //for GC stuff

	constructor() {
		this.drains = new Set();
	}

	read(): T {
		const currentComputation = findParentComputation(currentContext);
		if (!ignored && currentComputation) {
			currentComputation.addSource(this);
			this.addDrain(currentComputation);
		} else if (warnOnNoDepAdd) {
			console.error("Looks like you might have wanted to add a dependency but didn't.");
		}
		return this.value;
	}

	fire(val: T, doWrite: boolean, updateOnEqual: boolean) {
		updateQueue.delayStart(() => {
			let changedValue = false;
			if (doWrite) {
				if (DyneinState.ignore(() => this.value) !== val) {
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

	addDrain(comp: Computation) {
		this.drains.add(comp);
	}

	removeDrain(comp: Computation) {
		this.drains.delete(comp);
	}
}

class SimpleValueHandler<T> extends DataSignalDependencyHandler<T> {
	value: T;

	constructor(init: T) {
		super();
		this.value = init;
	}
}

export default DyneinState;
