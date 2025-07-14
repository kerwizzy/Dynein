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

export { updateState as _updateState }


/** STATE CHANGES (template)
 * assertedStatic 	       x
 * collectingDependencies  x
 * currentOwner            x
 * currentEffect           x
 * contextValues           x
 * currentUpdateQueue	   x
 * startDelayed            x
 * custom states           x
 */

export function untrack<T>(inner: () => T): T {
	/** STATE CHANGES
	 * assertedStatic 	       false
	 * collectingDependencies  false
	 * currentOwner            (preserve)
	 * currentEffect           (preserve)
	 * contextValues           (preserve)
	 * currentUpdateQueue	   (preserve)
	 * startDelayed            (preserve)
	 * custom states           (preserve)
	 */

	return updateState(false, false, currentOwner, currentEffect, inner)
}

export function retrack<T>(inner: () => T): T {
	/** STATE CHANGES
	 * assertedStatic 	       false
	 * collectingDependencies  true
	 * currentOwner            (preserve)
	 * currentEffect           (preserve)
	 * contextValues           (preserve)
	 * currentUpdateQueue	   (preserve)
	 * startDelayed            (preserve)
	 * custom states           (preserve)
	 */

	return updateState(false, true, currentOwner, currentEffect, inner)
}

const sample = untrack
export { sample }

export function assertStatic<T>(inner: () => T): T {
	/** STATE CHANGES
	 * assertedStatic 	       true
	 * collectingDependencies  false
	 * currentOwner            (preserve)
	 * currentEffect           (preserve)
	 * contextValues           (preserve)
	 * currentUpdateQueue	   (preserve)
	 * startDelayed            (preserve)
	 * custom states           (preserve)
	 */

	return updateState(true, false, currentOwner, currentEffect, inner)
}

export function runWithOwner<T>(owner: Owner | null | undefined, inner: () => T): T {
	/** STATE CHANGES
	 * assertedStatic 	       (preserve)
	 * collectingDependencies  (preserve)
	 * currentOwner            replace
	 * currentEffect           (preserve)
	 * contextValues           (preserve)
	 * currentUpdateQueue	   (preserve)
	 * startDelayed            (preserve)
	 * custom states           (preserve)
	 */
	return updateState(assertedStatic, collectingDependencies, owner, currentEffect, inner)
}

export function getOwner(): Owner | null | undefined {
	return currentOwner
}

export function _runAtBaseWithState<T>(
	new_assertedStatic: boolean,
	new_collectingDependencies: boolean,
	new_currentOwner: Owner | null | undefined,
	new_currentEffect: Effect | undefined,
	inner: () => T): T {
	/** STATE CHANGES
	 * assertedStatic 	       (from arguments)
	 * collectingDependencies  (from arguments)
	 * currentOwner            (from arguments)
	 * currentEffect           (from arguments)
	 * contextValues           reset to base
	 * currentUpdateQueue	   (preserve)
	 * startDelayed            (preserve)
	 * custom states           reset to base
	 */
	const restore = getRestoreAllStateFunction()
	try {
		restoreBaseState(false)
		assertedStatic = new_assertedStatic
		collectingDependencies = new_collectingDependencies
		currentOwner = new_currentOwner
		currentEffect = new_currentEffect
		return inner()
	} finally {
		restore()
	}
}

export function createRoot<T>(inner: (dispose: () => void) => T): T {
	/** STATE CHANGES
	 * assertedStatic 	       false (reset)
	 * collectingDependencies  false (reset)
	 * currentOwner            wrapped null (reset)
	 * currentEffect           undefined (reset)
	 * contextValues           reset to base
	 * currentUpdateQueue	   (preserve)
	 * startDelayed            (preserve)
	 * custom states           reset to base
	 */

	const owner = new Owner(null)
	return _runAtBaseWithState(false, false, owner, undefined, () => inner(() => owner.destroy()))
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
	/** STATE CHANGES
	 * assertedStatic 	       (preserve)
	 * collectingDependencies  (preserve)
	 * currentOwner            (preserve)
	 * currentEffect           (preserve)
	 * contextValues           modify
	 * currentUpdateQueue	   (preserve)
	 * startDelayed            (preserve)
	 * custom states           (preserve)
	 */

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
	/** STATE CHANGES (after calling inner)
	 * assertedStatic 	       (preserve)
	 * collectingDependencies  (preserve)
	 * currentOwner            (preserve)
	 * currentEffect           (preserve)
	 * contextValues           restore
	 * currentUpdateQueue	   (preserve)
	 * startDelayed            (preserve)
	 * custom states           (preserve)
	 */

	const savedContextValues = new Map(contextValues)
	return ((inner) => {
		const oldContextValues = contextValues
		try {
			// The extra clone here is required to handle restores within restores (see the
			// "handles restores inside restores" test).
			contextValues = new Map(savedContextValues)
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

// Any owners created as root (i.e., with `parent` null or undefined)
// are added to this object so that the owners will never be garbage collected.
const rootOwners = new Set<any>()

///*DEBUG*/let debugIDCounter = 0
// A simple tree for destroying all descendant contexts when an ancestor is destroyed
export class Owner {
	///*DEBUG*/debugID: string
	protected children: Set<Owner | (() => void)> = new Set()
	readonly isDestroyed: boolean = false;
	protected parent: Owner | null = null;

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

	private addChild(thing: Owner | (() => void)) {
		///*DEBUG*/console.log(`Owner@${this.debugID}: add child`, thing)
		if (this.isDestroyed) {
			///*DEBUG*/console.log(this.createContext, this.destroyContext)
			///*DEBUG*/throw new Error(`Owner@${this.debugID}: Can't add to destroyed context.`)
			throw new Error("Can't add to destroyed context.")
		}
		if (thing instanceof Owner) {
			thing.parent = this
		}
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

		_runAtBaseWithState(false, false, undefined, undefined, () => {
			batch(() => {
				for (const child of children) {
					if (child instanceof Owner) {
						child.parent = null
						child.destroy()
					} else {
						child()
					}
				}
			})
		})
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

			//@ts-ignore
			if (signalWrapper[onWriteListenersFunctionsSymbol].length > 0) {
				// Notice that currentUpdateQueue is preserved while all the other state values are reset
				// to the base values (as if run in the root event loop), or else to the values saved
				// when the onWrite was created.
				//
				// (This is the same as UpdateQueue.tick())
				const old_assertedStatic = assertedStatic
				const old_collectingDependencies = collectingDependencies
				const old_currentOwner = currentOwner
				const old_currentEffect = currentEffect
				const old_contextValues = contextValues
				const restoreCustomStates = customStateStashers.map(stasher => stasher())

				assertedStatic = false
				collectingDependencies = false

				// (Don't need to run these here because they are reset below)
				// currentOwner = undefined
				// contextValues = new Map()

				for (const fn of customRestoreBaseStateFunctions) {
					fn()
				}

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

						// TODO: is it safe to trust the creators of custom states to make sure that
						// the functions they pass never throw?
						for (const fn of customRestoreBaseStateFunctions) {
							fn()
						}

						try {
							listener(newVal!)
						} catch (err) {
							console.warn("Caught error in onWrite listener:", err)
						}
					}
				})

				assertedStatic = old_assertedStatic
				collectingDependencies = old_collectingDependencies
				currentOwner = old_currentOwner
				currentEffect = old_currentEffect
				contextValues = old_contextValues
				for (const fn of restoreCustomStates) {
					fn()
				}
			}

			setter(newVal!)
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
	/** STATE CHANGES (inside listener, relative to their values at listener creation)
	 * assertedStatic 	       false
	 * collectingDependencies  false
	 * currentOwner            child (reset on rerun)
	 * currentEffect           null
	 * contextValues           (preserve)
	 * currentUpdateQueue	   NOT PRESERVED
	 * startDelayed            true
	 * custom states           null/reset
	 *
	 * (all the state changes are implemented above, not here)
	 */

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
			return
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
	const handler = new DependencyHandler(init, fireWhenEqual)
	const signal = toSignal(handler.read.bind(handler), handler.write.bind(handler))

	// the above makes GC of `handler` depend on GC of `signal`

	// This makes GC of `signal` depends on GC of `handler`, so now
	// GC of signal and handler are linked. (This is important for @dynein/shared-signals)
	handler.dependents.add(signal)

	return signal
}

export function isSignal(thing: any): thing is Signal<any> {
	return thing && thing[isSignalSymbol] === true
}

export function createEffect(fn: () => (void | Promise<void>)): Owner {
	/** STATE CHANGES (inside fn, relative to their values at effect creation)
	 * assertedStatic 	       false
	 * collectingDependencies  true
	 * currentOwner            (created Effect)
	 * currentEffect           (created Effect)
	 * contextValues           (preserve)
	 * currentUpdateQueue	   NOT (necessarily) PRESERVED
	 * startDelayed            true
	 * custom states           null/reset
	 */

	return new Effect(fn)
}

export function onUpdate<T>(signal: () => T, listener: (newValue: T) => void): Owner {
	/** STATE CHANGES (inside listener, relative to their values at listener creation)
	 * assertedStatic 	       false
	 * collectingDependencies  false
	 * currentOwner            child (reset on rerun)
	 * currentEffect           undefined
	 * contextValues           (preserve)
	 * currentUpdateQueue	   NOT PRESERVED
	 * startDelayed            true
	 * custom states           null/reset
	 *
	 * (notice this is the same as onWrite)
	 */

	let isFirst = true
	return createEffect(() => {
		const newValue = signal()
		if (!isFirst) {
			// This will be reset after the effect exits, so we don't need to bother resetting it here
			currentEffect = undefined
			collectingDependencies = false

			batch(() => {
				listener(newValue)
			})
		}
		isFirst = false
	})
}

export function createMemo<T>(fn: () => T): () => T {
	/** STATE CHANGES (inside fn, relative to their values at memo creation)
	 * assertedStatic 	       false
	 * collectingDependencies  true
	 * currentOwner            internal effect
	 * currentEffect           internal effect
	 * contextValues           (preserve)
	 * currentUpdateQueue	   NOT PRESERVED
	 * startDelayed            true
	 * custom states           null/reset
	 */

	let latestValue: T
	const internalSignal = createSignal<T>(undefined as unknown as T)

	let execForced = false
	const runUpdate = () => {
		latestValue = fn()
		if (execForced) {
			// We're running inside a subclock, so don't update the signal here, so that we don't
			// trigger everything that depends on the signal to also run immediately inside the
			// subclock. This is only being run now inside a subclock to return the latest value to
			// something being run in a batch.
		} else {
			internalSignal(latestValue)
		}
	}

	const effect = new Effect(runUpdate)

	return () => {
		if (effect.execPending) {
			// We must be in a batch, or else the effect would have already been run

			execForced = true
			effect.forceExec()
			execForced = false

			// Mark that everything that uses the signal needs an update. (But because this isn't run
			// inside the subclock created by forceExec, the updates triggered by this new value change
			// (if it really did change) will only be handled after the end of the batch.)
			internalSignal(latestValue)
		}

		// Log this signal as a dependency
		return internalSignal()
	}
}

export function createMuffled<T>(signal: Signal<T>): Signal<T> {
	const fire = createSignal(true, true)
	let updateFromMuffled = false
	let triggeringOnWrite = false

	const muffled = toSignal(() => {
		fire()
		return sample(signal)
	}, (val: T) => {
		if (triggeringOnWrite) {
			return
		}

		if (currentUpdateQueue.startDelayed) {
			updateFromMuffled = true
			currentUpdateQueue.onTickEnd.add(() => {
				updateFromMuffled = false
			})
			signal(val)
		} else {
			updateFromMuffled = true
			try {
				signal(val)
			} finally {
				updateFromMuffled = false
			}
		}
	})

	onUpdate(signal, () => {
		if (updateFromMuffled) {
			return
		}

		fire(true)
	})

	return muffled
}

export function onCleanup(fn: () => void) {
	/** STATE CHANGES (relative to values at creation)
	 *
	 * (most of these are handled in Owner.reset)
	 *
	 * assertedStatic 	       false
	 * collectingDependencies  false
	 * currentOwner            undefined
	 * currentEffect           undefined
	 * contextValues           (preserve)
	 * currentUpdateQueue	   NOT PRESERVED
	 * startDelayed            true
	 * custom states           null/reset
	 */

	if (currentOwner === undefined) {
		console.trace("Destructables created outside of a `createRoot` will never be disposed.")
	}

	const savedContextValues = new Map(contextValues)

	// Do the ts-ignore to get around the private method warning
	//@ts-ignore
	currentOwner?.addChild(() => {
		const old_contextValues = contextValues
		try {
			contextValues = savedContextValues
			fn()
		} catch (err) {
			console.warn("Caught error in cleanup function:", err)
		} finally {
			contextValues = old_contextValues
		}
	})
}

export function batch<T>(fn: () => T): T {
	/** STATE CHANGES
	 * assertedStatic 	       (preserve)
	 * collectingDependencies  (preserve)
	 * currentOwner            (preserve)
	 * currentEffect           (preserve)
	 * contextValues           (preserve)
	 * currentUpdateQueue	   (preserve)
	 * startDelayed            true
	 * custom states           (preserve)
	 */
	return currentUpdateQueue.delayStart(fn)
}

export function subclock(fn: () => void) {
	/** STATE CHANGES
	 * assertedStatic 	       (preserve)
	 * collectingDependencies  (preserve)
	 * currentOwner            (preserve)
	 * currentEffect           (preserve)
	 * contextValues           (preserve)
	 * currentUpdateQueue	   NEW
	 * startDelayed            false
	 * custom states           (preserve)
	 */
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
				currentEffect = undefined
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
		this.unschedule(fn) // Important for having Effect.forceExec not cause unnecessary executions

		const oldUpdateQueue = currentUpdateQueue
		currentUpdateQueue = new UpdateQueue(this)

		try {
			fn()
		} finally {
			currentUpdateQueue = oldUpdateQueue
		}
	}

	delayStart<T>(fn: () => T): T {
		const oldStartDelayed = this.startDelayed
		this.startDelayed = true
		try {
			return fn()
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
		if (this.thisTick.has(fn)) {
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
	destroyPending: boolean = false
	execPending: boolean = false
	executing: boolean = false
	synchronousExecutionDepth = 0

	constructor(fn: () => (void | Promise<void>)) {
		super()
		this.savedContextValues = new Map(contextValues)
		this.fn = fn.bind(undefined)
		this.sources = new Set()
		this.boundExec = this.exec.bind(this)
		this.boundExec()
	}

	private exec() {
		this.execPending = false

		// TODO: does there need to be an async version of this somehow...? Invoking async effects
		// while executing is fine because it freezes/discards existing executions
		if (this.synchronousExecutionDepth > 0) {
			console.error("Nested effect self-triggering detected. This is not supported because it can lead to unexpected behavior. The effect will now be destroyed and further executions will be blocked.")
			this.synchronousExecutionDepth = 0
			this.executing = false
			this.destroy()
			return
		}

		if (this.isDestroyed) {
			return
		}

		const cachedUpdateQueue = currentUpdateQueue // TODO: is this really necessary?

		const oldStartDelayed = currentUpdateQueue.startDelayed
		cachedUpdateQueue.startDelayed = true

		this.reset()
		for (const src of this.sources) {
			src.drains.delete(this)
		}
		this.sources.clear()

		const oldContextValues = contextValues

		const restoreCustomStates = customStateStashers.map(stasher => stasher())

		for (const fn of customRestoreBaseStateFunctions) {
			fn()
		}

		let asyncExec = false
		try {
			contextValues = this.savedContextValues

			this.synchronousExecutionDepth++
			this.executing = true
			const maybePromise = updateState(false, true, this, this, this.fn)
			asyncExec = maybePromise instanceof Promise

			if (asyncExec) {
				(maybePromise as any).finally(() => {
					this.executing = false
					if (this.destroyPending) {
						this.destroy()
					}
				})
			}
		} finally {
			this.synchronousExecutionDepth--

			if (!asyncExec) {
				this.executing = false
			}

			contextValues = oldContextValues
			for (const fn of restoreCustomStates) {
				fn()
			}

			// this applies even if asyncExec is true
			if (this.destroyPending) {
				this.executing = false
				this.destroy()
			}

			cachedUpdateQueue.startDelayed = oldStartDelayed
			cachedUpdateQueue.start()
		}
	}

	destroy(force: boolean = false) {
		if (this.sources.size > 0) {
			for (const src of this.sources) {
				src.drains.delete(this)
			}
			this.sources.clear() // make garbage collection easier by removing more links
		}

		if (this.executing && !force) {
			this.destroyPending = true
			this.reset()
		} else {
			super.destroy()
		}

		// This may not actually be necessary, but it probably doesn't matter much for performance and
		// it's a safegaurd against memory leaks
		if (this.sources.size > 0) {
			for (const src of this.sources) {
				src.drains.delete(this)
			}
			this.sources.clear() // make garbage collection easier by removing more links
		}

		if (this.isDestroyed) {
			this.executing = false
			this.synchronousExecutionDepth = 0
		}
	}

	schedule() {
		this.reset() // Destroy subwatchers (and any existing async execution runs)
		this.execPending = true
		currentUpdateQueue.schedule(this.boundExec)
	}

	forceExec() {
		currentUpdateQueue.subclock(this.boundExec)
	}
}

class DependencyHandler<T> {
	value: T
	readonly drains: Set<Effect>
	readonly fireWhenEqual: boolean

	readonly dependents: Set<any> = new Set() // for GC stuff

	constructor(value: T, fireWhenEqual: boolean) {
		this.value = value
		this.drains = new Set()
		this.fireWhenEqual = fireWhenEqual
	}

	read(): T {
		if (collectingDependencies && currentEffect && !assertedStatic && !currentEffect.destroyPending) {
			currentEffect.sources.add(this)
			this.drains.add(currentEffect)
		} else if (assertedStatic) {
			console.error("Looks like you might have wanted to add a dependency but didn't.")
		}
		return this.value
	}

	write(val: T) {
		const shouldFire = this.fireWhenEqual || this.value !== val
		this.value = val
		if (shouldFire) {
			// This is basically a copy of the code in UpdateQueue.delayStart, but it avoids creating
			// a closure and calling that function. Writing to signals is obviously in the
			// really really hot path, so we want to avoid unneeded function calls and closure creation.
			const oldStartDelayed = currentUpdateQueue.startDelayed
			currentUpdateQueue.startDelayed = true

			// We don't need a try/catch here because there's nothing in .schedule that could throw.
			// The only user-controlled code during a schedule is in onCleanup, and that's already
			// wrapped inside a try/catch.
			for (const drain of this.drains) {
				drain.schedule()
			}

			currentUpdateQueue.startDelayed = oldStartDelayed
			currentUpdateQueue.start()
		}
	}
}

// Returns the value of the condition above inside DependencyHandler.read.
export function isTracking() {
	return collectingDependencies && currentEffect && !assertedStatic && !currentEffect.destroyPending
}

const rootUpdateQueue = currentUpdateQueue

type StateStasher = () => (() => void)
const customStateStashers: StateStasher[] = []
const customRestoreBaseStateFunctions: (() => void)[] = []

export function registerCustomStateStasher(stateStasher: StateStasher) {
	customStateStashers.push(stateStasher)
	customRestoreBaseStateFunctions.push(stateStasher())
}

function getRestoreAllStateFunction() {
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

		// see the "handles restores inside restores" test for why the extra new Map() clone is required
		contextValues = new Map(old_contextValues)

		currentUpdateQueue = old_currentUpdateQueue
		currentUpdateQueue.startDelayed = old_currentUpdateQueue_startDelayed

		for (const fn of restoreCustomStates) {
			fn()
		}
	}
}

function restoreBaseState(leavingSynchronousRegion = true) {
	// leavingSynchronousRegion is true when called from queueMicrotask below, but false when called
	// from createRoot

	///*DEBUG*/console.log("restore base state")

	// At the end of a synchronous execution run
	if (leavingSynchronousRegion && currentEffect && currentEffect.destroyPending) {
		currentEffect.destroy(true)
	}

	// Really restore *everything*, because this is called below in stateStashPromise to return
	// control to the main event loop after leaving a Dynein-wrapped code block.
	//
	// This is also called above in createRoot to run code as if it was run outside any other functions.
	assertedStatic = false
	collectingDependencies = false
	currentOwner = undefined
	currentEffect = undefined
	contextValues = new Map()

	for (const fn of customRestoreBaseStateFunctions) {
		fn()
	}

	if (leavingSynchronousRegion) {
		currentUpdateQueue = rootUpdateQueue
		rootUpdateQueue.startDelayed = false
		rootUpdateQueue.start()
	}
}

export function stateStashPromise<T>(promise: Promise<T>): Promise<T> {
	const restore = getRestoreAllStateFunction()
	const maybeResolve = Promise.withResolvers<T>()

	let destroyed = false
	if (currentOwner) {
		onCleanup(() => {
			destroyed = true
		})
	}

	Promise.allSettled([promise]).then(([result]) => {
		// if the area or execution run that this was called in gets destroyed, simply freeze
		// further execution by not resolving the output promise
		if (destroyed) {
			return
		}

		restore()

		if (result.status === "fulfilled") {
			maybeResolve.resolve(result.value)
		} else {
			maybeResolve.reject(result.reason)
		}

		// TODO: Should maybe use process.nextTick in node, since process.nextTick runs before
		// microtasks, and thus code in process.nextTick will have state leakage.
		// See: https://stackoverflow.com/a/57325561

		//@ts-ignore
		queueMicrotask(restoreBaseState)
	})

	return maybeResolve.promise
}

export { stateStashPromise as $s }

export function saveAllState(): <T>(inner: () => T) => T {
	const restoreSavePoint = getRestoreAllStateFunction()
	return (inner) => {
		const restoreOuterState = getRestoreAllStateFunction()
		try {
			restoreSavePoint()
			return inner()
		} finally {
			restoreOuterState()
		}
	}
}

export { default as WatchedArray } from "./WatchedArray.js"
export { default as WatchedMap } from "./WatchedMap.js"
export { default as WatchedSet } from "./WatchedSet.js"
export { ReactiveArray, MappableReactiveArray } from "./ReactiveArray.js"
