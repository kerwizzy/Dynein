const isSignalSymbol = Symbol("isSignal");

// Internal state variables
let assertedStatic = false;
let collectingDependencies = false;

let currentOwner:
	| Owner
	| null /* root on purpose */
	| undefined /* root probably not on purpose, so create a warning */ = undefined;

type ContextStore = {
	parent: ContextStore | null
	values: Map<Context<any>, any>,
	frozen: boolean
}

let contextValues: ContextStore | null = null

function updateState<T>(
	new_assertedStatic: boolean,
	new_collectingDependencies: boolean,
	new_currentOwner: Owner | null | undefined,
	new_contextValues: ContextStore | null,
	inner: () => T
) {
	const old_assertedStatic = assertedStatic;
	const old_collectingDependencies = collectingDependencies;
	const old_currentOwner = currentOwner;
	const old_contextValues = contextValues

	assertedStatic = new_assertedStatic;
	collectingDependencies = new_collectingDependencies;
	currentOwner = new_currentOwner;
	contextValues = new_contextValues
	try {
		return inner();
	} finally {
		assertedStatic = old_assertedStatic;
		collectingDependencies = old_collectingDependencies;
		currentOwner = old_currentOwner;
		contextValues = old_contextValues
	}
}

export function _getInternalState() {
	return { assertedStatic, collectingDependencies, currentOwner }
}

export function untrack<T>(inner: () => T): T {
	return updateState(false, false, currentOwner, contextValues, inner);
}
export function retrack<T>(inner: () => T): T {
	return updateState(assertedStatic, true, currentOwner, contextValues, inner);
}

const sample = untrack;
export { sample };

export function assertStatic<T>(inner: () => T): T {
	return updateState(true, false, currentOwner, contextValues, inner);
}
export function runWithOwner<T>(owner: Owner | null | undefined, inner: () => T): T {
	return updateState(owner?.assertedStatic ?? false, owner?.collectingDependencies ?? false, owner, owner?.contextValues ?? null, inner);
}

// Returns a "restore point" that can be used with runWithOwner to restore the current effect,
// collectingDependencies, assertedStatic, and contextValues state
export function getOwner(): Owner | null | undefined {
	if (!currentOwner) {
		if (!contextValues) {
			return currentOwner;
		} else {
			return new Owner(null)
		}
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
	// The outer updateState is to set collectingDependencies, assertedStatic, and contextValues before
	// creating owner.
	return updateState(false, false, null, null, ()=>{
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
	if (!contextValues || contextValues.frozen) {
		contextValues = {
			parent: contextValues,
			values: new Map(),
			frozen: false
		}
	}
	const values = contextValues.values

	const old_hasValue = values.has(context)
	const old_value = values.get(context)

	values.set(context, value)
	try {
		return inner()
	} finally {
		// It could have been frozen by something inside inner that cached the context.
		if (!contextValues!.frozen) {
			if (!old_hasValue) {
				values.delete(context)
			} else {
				values.set(context, old_value)
			}
		}
		contextValues = old_contextValues
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
	let ctx: ContextStore | null = contextValues
	while (ctx) {
		if (ctx.values?.has(context)) {
			return ctx.values!.get(context)
		}
		ctx = ctx.parent
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
	readonly contextValues: ContextStore | null

	///*DEBUG*/protected createContext: any
	///*DEBUG*/protected destroyContext: any

	constructor(parent: Owner | null | undefined = currentOwner) {
		///*DEBUG*/this.debugID = (debugIDCounter++).toString();

		///*DEBUG*/this.createContext = new Error(`Create Owner@${this.debugID}`)

		this.assertedStatic = assertedStatic
		this.collectingDependencies = collectingDependencies
		this.contextValues = contextValues
		if (contextValues) {
			contextValues.frozen = true
		}

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
export type ReadableSignal<T> = (() => T) & {[isSignalSymbol]: true}

const onWriteListenersSymbol = Symbol("onWriteListeners")
const onWriteOwnersSymbol = Symbol("onWriteOwners")
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
			//@ts-ignore
			if (signalWrapper[onWriteListenersSymbol] && signalWrapper[onWriteListenersSymbol].size > 0) {
				runWithBaseStateButKeepUpdateQueue(()=>{
					batch(()=>{
						//@ts-ignore
						for (const owner of signalWrapper[onWriteOwnersSymbol]) {
							owner.reset()
						}
						//@ts-ignore
						for (const listener of signalWrapper[onWriteListenersSymbol]) {
							try {
								listener(newVal!)
							} catch (err) {
								console.warn("Caught error in onWrite listener:", err)
							}
						}
					})
				})
			}
			return newVal!;
		}
	} as Signal<T>;
	//@ts-ignore
	signalWrapper[isSignalSymbol] = true;

	// TODO: should we set signalWrapper[onWriteListenersSymbol] and onWriteOwnersSymbol to null here to reduce polymorphism?

	//@ts-ignore
	return signalWrapper;
}

export function onWrite<T>(getter: ReadableSignal<T>, listener: (newValue: T) => void): void {
	//@ts-ignore
	if (!getter[onWriteListenersSymbol]) {
		//@ts-ignore
		getter[onWriteListenersSymbol] = new Set()
		//@ts-ignore
		getter[onWriteOwnersSymbol] = new Set()
	}

	const owner = new Owner()
	const wrappedListener = (val: T)=>{
		updateState(false, false, owner, owner.contextValues, ()=>{
			listener(val)
		})
	}

	//@ts-ignore
	getter[onWriteListenersSymbol].add(wrappedListener)
	//@ts-ignore
	getter[onWriteOwnersSymbol].add(owner)
	onCleanup(()=>{
		//@ts-ignore
		getter[onWriteListenersSymbol].delete(wrappedListener)
		//@ts-ignore
		getter[onWriteOwnersSymbol].delete(owner)
	})
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

export function createEffect(fn: () => (void | Promise<void>)): Destructable {
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

export function schedule(fn: ()=>void) {
	currentUpdateQueue.schedule(()=>{
		runWithBaseStateButKeepUpdateQueue(fn)
	})
}

export function onBatchEnd(fn: ()=>void) {
	currentUpdateQueue.onTickEnd.add(fn)
	currentUpdateQueue.start()
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
	onTickEnd: Set<() => void>;
	ticking: boolean;
	startDelayed: boolean;

	constructor(parent: UpdateQueue | null = null) {
		this.parent = parent;
		this.thisTick = new Set();
		this.nextTick = new Set();
		this.onTickEnd = new Set();
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
			if (subTickN > 10000) {
				console.warn("Runaway update detected");
				break;
			}

			subTickN++;

			const tmp = this.thisTick;
			this.thisTick = this.nextTick;
			this.nextTick = tmp;
			this.nextTick.clear();

			if (this.thisTick.size === 0) {
				if (this.onTickEnd.size === 0) {
					break
				}
				runWithBaseStateButKeepUpdateQueue(()=>{
					for (const fn of this.onTickEnd) {
						this.onTickEnd.delete(fn)
						try {
							fn()
						} catch (err) {
							console.warn("Caught error in onBatchEnd function:", err);
						}
					}
				})
				continue; // the onTickEnd functions might have added more stuff to nextTick
			}

			for (const fn of this.thisTick) {
				this.thisTick.delete(fn);
				try {
					fn();
				} catch (err) {
					console.warn("Caught error in tick function:", err);
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
	private readonly fn: () => (void | Promise<void>);
	readonly sources: Set<DependencyHandler<any>>;
	private readonly boundExec: () => void;
	private executing: boolean = false;
	private destroyPending: boolean = false;
	private asyncExec: boolean = false
	private schedulePending: boolean = false

	constructor(fn: () => (void | Promise<void>)) {
		super();
		//@ts-ignore
		this.assertedStatic = false
		//@ts-ignore
		this.collectingDependencies = true
		this.fn = fn.bind(undefined);
		this.sources = new Set();
		this.boundExec = this.exec.bind(this);
		currentUpdateQueue.delayStart(this.boundExec);
	}

	private exec() {
		if (this.isDestroyed) {
			return;
		}

		this.reset() // Necessary to make the "effect created inside an exec-pending effect" test pass
		for (const src of this.sources) {
			src.drains.delete(this);
		}
		this.sources.clear();
		try {
			this.executing = true;
			const maybePromise = updateState(false, true, this, this.contextValues, this.fn);
			this.asyncExec = maybePromise instanceof Promise
			if (this.asyncExec) {
				(maybePromise as any).finally(()=>{
					this.finishExec()
				})
			}
		} finally {
			if (!this.asyncExec) {
				this.finishExec()
			}
		}
	}

	private finishExec() {
		this.executing = false;
		if (this.destroyPending) {
			this.destroy();
		} else if (this.schedulePending) {
			this.schedulePending = false
			currentUpdateQueue.schedule(this.boundExec);
		}
	}

	destroy() {
		if (this.executing) {
			this.reset()
			this.destroyPending = true;
		} else {
			super.destroy();
		}
	}

	schedule() {
		this.reset(); // Destroy subwatchers
		if (this.asyncExec && this.executing) {
			this.schedulePending = true
		} else {
			currentUpdateQueue.schedule(this.boundExec);
		}
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

type StateStasher = ()=>(()=>void)

const stateStashers = new Set<StateStasher>()
const stashAllState: StateStasher = ()=>{
	const restorers: (()=>void)[] = []
	for (const getRestorer of stateStashers) {
		restorers.push(getRestorer())
	}
	return ()=>{
		for (const restorer of restorers) {
			restorer()
		}
	}
}

let basicRestoreBaseState = ()=>{}
const restoreBaseState = ()=>{
	basicRestoreBaseState()
	currentUpdateQueue.start()
}

const rootUpdateQueue = currentUpdateQueue
export function runWithBaseState<T>(inner: ()=>T): T {
	const old_rootUpdateQueue_startDelayed = rootUpdateQueue.startDelayed
	const restore = stashAllState()
	try {
		basicRestoreBaseState()
		rootUpdateQueue.startDelayed = old_rootUpdateQueue_startDelayed
		return inner()
	} finally {
		restore()
	}
}

function runWithBaseStateButKeepUpdateQueue(inner: ()=>void) {
	const old_currentUpdateQueue = currentUpdateQueue
	runWithBaseState(()=>{
		currentUpdateQueue = old_currentUpdateQueue
		inner()
	})
}

export function addStateStasher(stasher: StateStasher) {
	stateStashers.add(stasher)
	basicRestoreBaseState = stashAllState()
}

addStateStasher(()=>{
	const old_assertedStatic = assertedStatic;
	const old_collectingDependencies = collectingDependencies;
	const old_currentOwner = currentOwner;
	const old_contextValues = contextValues
	if (contextValues) {
		contextValues.frozen = true
	}

	const old_currentUpdateQueue = currentUpdateQueue
	const old_currentUpdateQueue_startDelayed = currentUpdateQueue.startDelayed

	return ()=>{
		assertedStatic = old_assertedStatic
		collectingDependencies = old_collectingDependencies
		currentOwner = old_currentOwner
		contextValues = old_contextValues
		currentUpdateQueue = old_currentUpdateQueue
		currentUpdateQueue.startDelayed = old_currentUpdateQueue_startDelayed
	}
})

export function $s<T>(promise: Promise<T>): Promise<T> {
	const restore = stashAllState()
	promise.finally(()=>{
		///*DEBUG*/console.log("$s restore saved state")
		restore()

		// TODO: Should maybe use process.nextTick in node, since process.nextTick runs before
		// microtasks, and thus code in process.nextTick will have state leakage.
		// See: https://stackoverflow.com/a/57325561

		//@ts-ignore
		queueMicrotask(()=>{
			///*DEBUG*/console.log("restore base state")
			restoreBaseState()
		})
	}).catch(()=>{})
	return promise
}

export function stashState(): <T>(inner: ()=>T)=>T {
	const restoreStashed = stashAllState()
	return (inner)=>{
		const restore = stashAllState()
		try {
			restoreStashed()
			return inner()
		} finally {
			restore()
		}
	}
}
