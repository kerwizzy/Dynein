const isSignalSymbol = Symbol("isSignal")

// Internal state variables
/*

Meaning of various states
=========================

assertedStatic = false, collectingDependencies = false
	* inside an untrack or entirely outside a createEffect
	* accessing signals does nothing (aside from returning the current signal value)

assertedStatic = true, collectingDependencies = false
	* inside an untrack or entirely outside a createEffect
	* accessing signals causes a warning

assertedStatic = false, collectingDependencies = true
	* inside a createEffect or a retrack
	* accessing signals adds the signal as a dependency of the effect

assertedStatic = true, collectingDependencies = true
	* inside a createEffect or a retrack
	* accessing signals triggers a warning
	* The signal is *not* added as a dependency of the effect.
	* (There isn't really a good reason for this situation to appear, but for the sake of something
	   like defense-in-depth for bugs, it's specified here and handled below in DependencyHandler.read)

In other words:
	assertStatic = true               causes accessing signals to do nothing except trigger a warning
	collectingDependencies = false    causes accessing signals to do nothing, but without a warning

Other notes:
	The situation `collectingDependencies && currentEffect` can occur if retrack is called outside an effect
*/
let assertedStatic = false
let collectingDependencies = false

type ValidCurrentOwnerValue = Owner
	| null /* root on purpose */
	| undefined /* root probably not on purpose, so create a warning */

let currentOwner: ValidCurrentOwnerValue = undefined
let currentEffect: Effect | undefined = undefined
let contextValues = new Map<Context<any>, any>()

// currentUpdateQueue is also an internal state variable, but it is declared below.
// There are also custom state variables (also see below)

function updateState<T>(
	new_assertedStatic: boolean,
	new_collectingDependencies: boolean,
	new_currentOwner: Owner | null | undefined,
	new_currentEffect: Effect | undefined,
	inner: () => T
) {
	const old_assertedStatic = assertedStatic
	const old_collectingDependencies = collectingDependencies
	const old_currentOwner = currentOwner
	const old_currentEffect = currentEffect

	assertedStatic = new_assertedStatic
	collectingDependencies = new_collectingDependencies
	currentOwner = new_currentOwner
	currentEffect = new_currentEffect
	try {
		return inner()
	} finally {
		assertedStatic = old_assertedStatic
		collectingDependencies = old_collectingDependencies
		currentOwner = old_currentOwner
		currentEffect = old_currentEffect
	}
}

export function _getInternalState() {
	return { assertedStatic, collectingDependencies, currentOwner, currentEffect, currentUpdateQueue }
}

export function untrack<T>(inner: () => T): T {
	return updateState(false, false, currentOwner, currentEffect, inner)
}
export function retrack<T>(inner: () => T): T {
	// Preserve assertedStatic in case this is called outside an untrack
	return updateState(assertedStatic, true, currentOwner, currentEffect, inner)
}

const sample = untrack
export { sample }

export function assertStatic<T>(inner: () => T): T {
	return updateState(true, false, currentOwner, currentEffect, inner)
}
export function runWithOwner<T>(owner: Owner | null | undefined, inner: () => T): T {
	return updateState(assertedStatic, collectingDependencies, owner, currentEffect, inner)
}

export function getOwner(): Owner | null | undefined {
	return currentOwner
}

export function createRoot<T>(inner: (dispose: () => void) => T): T {
	// The outer updateState is to set collectingDependencies, assertedStatic, and contextValues before
	// creating owner.
	return updateState(false, false, null, currentEffect, () => {
		const owner = new Owner(null)
		return runWithOwner(owner, () => inner(() => owner.destroy()))
	})
}

export type Context<T> = {
	readonly defaultValue: T
}

export function createContext<T>(): Context<T | undefined>
export function createContext<T>(defaultValue: T): Context<T>
export function createContext(defaultValue?: any): Context<any> {
	return { defaultValue }
}

export function runWithContext<T, R>(context: Context<T>, value: T, inner: () => R): R {
	const oldHas = contextValues.has(context)
	let oldValue
	if (oldHas) {
		oldValue = contextValues.get(context)
	}
	contextValues.set(context, value)
	try {
		return inner()
	} finally {
		if (!oldHas) {
			contextValues.delete(context)
		} else {
			contextValues.set(context, oldValue)
		}
	}
}

export function saveContexts(contexts: Context<any>[]): <T>(inner: () => T) => T {
	let restoreContexts = <T>(inner: () => T) => inner()

	for (const ctx of contexts) {
		const innerRestoreContexts = restoreContexts
		const val = useContext(ctx)
		restoreContexts = (inner) => runWithContext(ctx, val, () => innerRestoreContexts(inner))
	}

	return restoreContexts
}

export function saveAllContexts(): <T>(inner: () => T) => T {
	const savedContextValues = new Map(contextValues)
	return ((inner) => {
		const oldContextValues = contextValues
		try {
			contextValues = savedContextValues
			return inner()
		} finally {
			contextValues = oldContextValues
		}
	})
}

export function useContext<T>(context: Context<T>): T {
	if (contextValues.has(context)) {
		return contextValues.get(context)
	}

	return context.defaultValue
}

export interface Destructable {
	destroy(): void
	parent: Owner | null
}

// Any owners created as root (i.e., with `parent` null or undefined)
// are added to this object so that the owners will never be garbage collected.
const rootOwners = new Set<any>()

///*DEBUG*/let debugIDCounter = 0
// A simple tree for destroying all descendant contexts when an ancestor is destroyed
export class Owner implements Destructable {
	///*DEBUG*/debugID: string
	protected children: Set<Destructable> = new Set();
	readonly isDestroyed: boolean = false;
	parent: Owner | null = null;

	///*DEBUG*/protected createContext: any
	///*DEBUG*/protected destroyContext: any

	constructor(parent: Owner | null | undefined = currentOwner) {
		///*DEBUG*/this.debugID = (debugIDCounter++).toString()

		///*DEBUG*/this.createContext = new Error(`Create Owner@${this.debugID}`)

		///*DEBUG*/console.trace(`Owner@${this.debugID}: create`)
		if (parent === undefined) {
			console.trace("Destructables created outside of a `createRoot` will never be disposed.")
		}

		if (!parent) {
			rootOwners.add(this)
		} else {
			parent.addChild(this)
		}
	}

	addChild(thing: Destructable) {
		///*DEBUG*/console.log(`Owner@${this.debugID}: add child`, thing)
		if (this.isDestroyed) {
			///*DEBUG*/console.log(this.createContext, this.destroyContext)
			///*DEBUG*/throw new Error(`Owner@${this.debugID}: Can't add to destroyed context.`)
			throw new Error("Can't add to destroyed context.")
		}
		thing.parent = this
		this.children.add(thing)
	}

	destroy() {
		///*DEBUG*/this.destroyContext = new Error(`Destroy Owner@${this.debugID}`)
		///*DEBUG*/console.log(`Owner@${this.debugID}: destroy`)

		//@ts-ignore
		this.isDestroyed = true
		if (this.parent) {
			this.parent.children.delete(this)
			this.parent = null
		}
		this.reset()
	}

	reset() {
		///*DEBUG*/console.log(`Owner@${this.debugID}: reset`)
		const children = this.children

		// if one of the child destructors triggers `reset` again, we don't
		// want it to rerun `reset` with the same list, because that would cause an infinite loop
		this.children = new Set()

		for (const child of children) {
			child.parent = null
			child.destroy()
		}
	}
}

export type Signal<T> = (() => T) & (<U extends T>(newVal: U) => U) & { [isSignalSymbol]: true }

// Every ReadableSignal is also a Signal at runtime, but declaring or casting a Signal to a ReadableSignal
// indicates to other functions that it shouldn't be written to.
export type ReadableSignal<T> = (() => T) & { [isSignalSymbol]: true }

const onWriteListenersFunctionsSymbol = Symbol("onWriteListeners")
const onWriteListenersOwnersSymbol = Symbol("onWriteOwners")
const onWriteListenersContextValuesSymbol = Symbol("onWriteContextValues")
export function toSignal<T>(getter: () => T, setter: (value: T) => void): Signal<T> {
	const signalWrapper = function (newVal?: T) {
		if (arguments.length === 0) {
			return getter()
		} else {
			if (arguments.length !== 1) {
				throw new Error(
					"Expected exactly 0 or 1 arguments to a signal read/write function, got " +
					arguments.length
				)
			}
			setter(newVal!)
			//@ts-ignore
			if (signalWrapper[onWriteListenersFunctionsSymbol].length > 0) {
				assertedStatic = false
				collectingDependencies = false
				for (const fn of customRestoreBaseStateFunctions) {
					fn()
				}
				const old_currentOwner = currentOwner
				const old_currentEffect = currentEffect
				const old_contextValues = contextValues

				// Notice that currentUpdateQueue is preserved while all the other state values are reset
				// to the base values (as if run in the root event loop), or else to the values saved
				// when the onWrite was created.
				batch(() => {
					currentEffect = undefined

					//@ts-ignore
					for (let i = 0; i < signalWrapper[onWriteListenersOwnersSymbol].length; i++) {
						//@ts-ignore
						const owner: Owner = signalWrapper[onWriteListenersOwnersSymbol][i]

						// this cannot be null or undefined because a new owner is created for
						// every onWrite
						owner.reset()
					}
					// @ts-ignore
					for (let i = 0; i < signalWrapper[onWriteListenersFunctionsSymbol].length; i++) {
						//@ts-ignore
						const owner: Owner = signalWrapper[onWriteListenersOwnersSymbol][i]

						// this cannot be null or undefined because a new owner is created for
						// every onWrite
						currentOwner = owner

						//@ts-ignore
						const listener = signalWrapper[onWriteListenersFunctionsSymbol][i]

						//@ts-ignore
						contextValues = signalWrapper[onWriteListenersContextValuesSymbol][i]

						try {
							listener(newVal!)
						} catch (err) {
							console.warn("Caught error in onWrite listener:", err)
						}
					}
				})

				currentOwner = old_currentOwner
				currentEffect = old_currentEffect
				contextValues = old_contextValues
			}
		}
		return newVal!
	} as Signal<T>
	//@ts-ignore
	signalWrapper[isSignalSymbol] = true

	//@ts-ignore
	signalWrapper[onWriteListenersFunctionsSymbol] = []
	//@ts-ignore
	signalWrapper[onWriteListenersOwnersSymbol] = []
	//@ts-ignore
	signalWrapper[onWriteListenersContextValuesSymbol] = []

	//@ts-ignore
	return signalWrapper
}

export function onWrite<T>(getter: ReadableSignal<T>, listener: (newValue: T) => void): void {
	const owner = new Owner()

	//@ts-ignore
	getter[onWriteListenersFunctionsSymbol].push(listener)
	//@ts-ignore
	getter[onWriteListenersOwnersSymbol].push(owner)
	//@ts-ignore
	getter[onWriteListenersContextValuesSymbol].push(new Map(contextValues))
	onCleanup(() => {
		//@ts-ignore
		const idx = getter[onWriteListenersFunctionsSymbol].indexOf(listener)
		if (idx === -1) {
			console.warn("Unexpected internal state in onWrite listener cleanup")
		}

		// @ts-ignore
		getter[onWriteListenersFunctionsSymbol].splice(idx, 1)
		// @ts-ignore
		getter[onWriteListenersOwnersSymbol].splice(idx, 1)
		// @ts-ignore
		getter[onWriteListenersContextValuesSymbol].splice(idx, 1)
	})
}

export function createSignal<T>(init: T, fireWhenEqual: boolean = false): Signal<T> {
	const handler = new DependencyHandler(init)
	const signal = toSignal(
		() => handler.read(),
		(val) => handler.write(val, fireWhenEqual)
	)
	// the above makes GC of `handler` depend on GC of `signal`

	// This makes GC of `signal` depends on GC of `handler`, so now
	// GC of signal and handler are linked. (This is important for @dynein/shared-signals)
	handler.dependents.add(signal)

	return signal
}

export function isSignal(thing: any): thing is Signal<any> {
	return thing && thing[isSignalSymbol] === true
}

export function createEffect(fn: () => (void | Promise<void>)): Destructable {
	return new Effect(fn)
}

export function onUpdate<T>(signal: () => T, listener: (newValue: T) => void): Destructable {
	let isFirst = true
	return createEffect(() => {
		const newValue = signal()
		if (!isFirst) {
			untrack(() => {
				listener(newValue)
			})
		}
		isFirst = false
	})
}

export function createMemo<T>(fn: () => T, fireWhenEqual: boolean = false): () => T {
	const internalSignal = createSignal<T>(undefined as unknown as T, fireWhenEqual)
	createEffect(() => {
		internalSignal(fn())
	})
	return () => internalSignal()
}

export function onCleanup(fn: () => void) {
	if (currentOwner === undefined) {
		console.trace("Destructables created outside of a `createRoot` will never be disposed.")
	}

	const savedContextValues = new Map(contextValues)
	currentOwner?.addChild({
		destroy: () => {
			const old_contextValues = contextValues
			try {
				contextValues = savedContextValues
				runWithOwner(undefined, fn)
			} catch (err) {
				console.warn("Caught error in cleanup function:", err)
			} finally {
				contextValues = old_contextValues
			}
		},
		parent: null
	})
}

export function batch(fn: () => void) {
	currentUpdateQueue.delayStart(fn)
}

export function subclock(fn: () => void) {
	currentUpdateQueue.subclock(fn)
}

// Necessary since console isn't part of the default Typescript defs, and we don't want to include
// either DOM or @types/node as deps of this module.
interface Console {
	error(...data: any[]): void
	log(...data: any[]): void
	warn(...data: any[]): void
	trace(...data: any[]): void
}

declare var console: Console

// Internal class to keep track of pending updates
class UpdateQueue {
	parent: UpdateQueue | null
	thisTick: Set<() => void>
	nextTick: Set<() => void>
	onTickEnd: Set<() => void>
	ticking: boolean
	startDelayed: boolean

	constructor(parent: UpdateQueue | null = null) {
		this.parent = parent
		this.thisTick = new Set()
		this.nextTick = new Set()
		this.onTickEnd = new Set()
		this.ticking = false
		this.startDelayed = false
	}

	start() {
		if (this.ticking || this.startDelayed) {
			return
		}

		let subTickN = 0
		this.ticking = true
		while (true) {
			if (subTickN > 10000) {
				console.warn("Runaway update detected")
				break
			}

			subTickN++

			const tmp = this.thisTick
			this.thisTick = this.nextTick
			this.nextTick = tmp
			this.nextTick.clear()

			if (this.thisTick.size === 0) {
				if (this.onTickEnd.size === 0) {
					break
				}
				const old_assertedStatic = assertedStatic
				const old_collectingDependencies = collectingDependencies
				const old_currentOwner = currentOwner
				const old_currentEffect = currentEffect
				const old_contextValues = contextValues
				const restoreCustomStates = customStateStashers.map(stasher => stasher())

				assertedStatic = false
				collectingDependencies = false
				currentOwner = undefined
				contextValues = new Map()
				for (const fn of customRestoreBaseStateFunctions) {
					fn()
				}

				for (const fn of this.onTickEnd) {
					this.onTickEnd.delete(fn)
					try {
						fn()
					} catch (err) {
						console.warn("Caught error in onBatchEnd function:", err)
					}
				}

				assertedStatic = old_assertedStatic
				collectingDependencies = old_collectingDependencies
				currentOwner = old_currentOwner
				currentEffect = old_currentEffect
				contextValues = old_contextValues
				for (const fn of restoreCustomStates) {
					fn()
				}

				continue // the onTickEnd functions might have added more stuff to nextTick
			}

			for (const fn of this.thisTick) {
				this.thisTick.delete(fn)
				try {
					fn()
				} catch (err) {
					console.warn("Caught error in tick function:", err)
				}
			}
		}
		this.ticking = false
	}

	subclock(fn: () => void) {
		const old_assertedStatic = assertedStatic
		const old_collectingDependencies = collectingDependencies

		const oldUpdateQueue = currentUpdateQueue
		currentUpdateQueue = new UpdateQueue(this)
		assertedStatic = false
		collectingDependencies = false

		try {
			fn()
		} finally {
			currentUpdateQueue = oldUpdateQueue
			assertedStatic = old_assertedStatic
			collectingDependencies = old_collectingDependencies
		}
	}

	delayStart(fn: () => void) {
		const oldStartDelayed = this.startDelayed
		this.startDelayed = true
		try {
			fn()
		} finally {
			this.startDelayed = oldStartDelayed
			this.start()
		}
	}

	unschedule(fn: any) {
		this.thisTick.delete(fn)
		this.nextTick.delete(fn)
		this.parent?.unschedule(fn)
	}

	schedule(fn: () => void) {
		if (this.ticking && this.thisTick.has(fn)) {
			// if this is already scheduled on the current tick but not started yet, don't schedule it
			// again on the next tick
			return
		}

		this.parent?.unschedule(fn)
		this.nextTick.add(fn)
		this.start()
	}
}

let currentUpdateQueue = new UpdateQueue()

// Internal class created by createEffect. Collects dependencies of `fn` and rexecutes `fn` when
// dependencies update.
class Effect extends Owner {
	private readonly fn: () => void | Promise<void>
	private readonly savedContextValues: Map<Context<any>, any>
	readonly sources: Set<DependencyHandler<any>>
	private readonly boundExec: () => void
	private executing: boolean = false
	private destroyPending: boolean = false
	private asyncExec: boolean = false
	private schedulePending: boolean = false

	constructor(fn: () => (void | Promise<void>)) {
		super()
		this.savedContextValues = new Map(contextValues)
		this.fn = fn.bind(undefined)
		this.sources = new Set()
		this.boundExec = this.exec.bind(this)
		currentUpdateQueue.delayStart(this.boundExec)
	}

	private exec() {
		if (this.isDestroyed) {
			return
		}

		this.reset() // Necessary to make the "effect created inside an exec-pending effect" test pass
		for (const src of this.sources) {
			src.drains.delete(this)
		}
		this.sources.clear()

		const oldContextValues = contextValues
		try {
			this.executing = true
			contextValues = this.savedContextValues
			const maybePromise = updateState(false, true, this, this, this.fn)
			this.asyncExec = maybePromise instanceof Promise
			if (this.asyncExec) {
				(maybePromise as any).finally(() => {
					this.finishExec()
				})
			}
		} finally {
			contextValues = oldContextValues
			if (!this.asyncExec) {
				this.finishExec()
			}
		}
	}

	private finishExec() {
		this.executing = false
		if (this.destroyPending) {
			this.destroy()
		} else if (this.schedulePending) {
			this.schedulePending = false
			currentUpdateQueue.schedule(this.boundExec)
		}
	}

	destroy() {
		if (this.executing) {
			this.reset()
			this.destroyPending = true
		} else {
			super.destroy()
		}
	}

	schedule() {
		this.reset() // Destroy subwatchers
		if (this.asyncExec && this.executing) {
			this.schedulePending = true
		} else {
			currentUpdateQueue.schedule(this.boundExec)
		}
	}
}

class DependencyHandler<T> {
	value: T
	drains: Set<Effect>

	dependents: Set<any> = new Set(); //for GC stuff

	constructor(value: T) {
		this.value = value
		this.drains = new Set()
	}

	read(): T {
		if (collectingDependencies && currentEffect && !assertedStatic) {
			currentEffect.sources.add(this)
			this.drains.add(currentEffect)
		} else if (assertedStatic) {
			console.error("Looks like you might have wanted to add a dependency but didn't.")
		}
		return this.value
	}

	write(val: T, updateOnEqual: boolean) {
		currentUpdateQueue.delayStart(() => {
			const changedValue = this.value !== val
			this.value = val

			if (updateOnEqual || changedValue) {
				for (const drain of this.drains) {
					drain.schedule()
				}
			}
		})
	}
}

const rootUpdateQueue = currentUpdateQueue

type StateStasher = () => (() => void)
const customStateStashers: StateStasher[] = []
const customRestoreBaseStateFunctions: (() => void)[] = []

export function addCustomStateStasher(stateStasher: StateStasher) {
	customStateStashers.push(stateStasher)
	customRestoreBaseStateFunctions.push(stateStasher())
}

function stashAllState() {
	const old_assertedStatic = assertedStatic
	const old_collectingDependencies = collectingDependencies
	const old_currentOwner = currentOwner
	const old_currentEffect = currentEffect
	const old_contextValues = new Map(contextValues)

	const old_currentUpdateQueue = currentUpdateQueue
	const old_currentUpdateQueue_startDelayed = currentUpdateQueue.startDelayed

	const restoreCustomStates = customStateStashers.map(stasher => stasher())

	return () => {
		assertedStatic = old_assertedStatic
		collectingDependencies = old_collectingDependencies
		currentOwner = old_currentOwner
		currentEffect = old_currentEffect
		contextValues = old_contextValues
		currentUpdateQueue = old_currentUpdateQueue
		currentUpdateQueue.startDelayed = old_currentUpdateQueue_startDelayed

		for (const fn of restoreCustomStates) {
			fn()
		}
	}
}

export function $s<T>(promise: Promise<T>): Promise<T> {
	const restore = stashAllState()
	promise
		.finally(() => {
			///*DEBUG*/console.log("$s restore saved state")
			restore()

			// TODO: Should maybe use process.nextTick in node, since process.nextTick runs before
			// microtasks, and thus code in process.nextTick will have state leakage.
			// See: https://stackoverflow.com/a/57325561

			//@ts-ignore
			queueMicrotask(() => {
				///*DEBUG*/console.log("restore base state")

				// Really restore *everything*, because this is returning control to the main event
				// loop, and leaving a Dynein-wrapped code block.
				assertedStatic = false
				collectingDependencies = false
				currentOwner = undefined
				currentEffect = undefined
				contextValues = new Map()
				currentUpdateQueue = rootUpdateQueue
				rootUpdateQueue.startDelayed = false
				rootUpdateQueue.start()
				for (const fn of customRestoreBaseStateFunctions) {
					fn()
				}
			})
		})
		.catch(() => { })
	return promise
}

export function stashState(): <T>(inner: () => T) => T {
	const restoreStashed = stashAllState()
	return (inner) => {
		const restore = stashAllState()
		try {
			restoreStashed()
			return inner()
		} finally {
			restore()
		}
	}
}

export { default as WatchedArray } from "./WatchedArray.js"
export { default as WatchedMap } from "./WatchedMap.js"
export { default as WatchedSet } from "./WatchedSet.js"
export { ReactiveArray, MappableReactiveArray } from "./ReactiveArray.js"
