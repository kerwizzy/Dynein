import { Signal, sample, createSignal, toSignal, _runAtBaseWithState, batch, onCleanup } from "./state.js"

export default class WatchedSet<T> {
	readonly value: Signal<ReadonlySet<T>>

	private hiddenValue: Set<T>
	private readonly hiddenSignal: Signal<Set<T>>
	private readonly editListeners: ((value: T, add: boolean) => void)[] = []
	private readonly replaceListeners: ((oldSet: ReadonlySet<T>, newSet: ReadonlySet<T> | null) => void)[] = []

	constructor(iterable?: Iterable<T> | undefined) {
		this.hiddenValue = iterable ? new Set(iterable) : new Set()
		this.hiddenSignal = createSignal(this.hiddenValue, true)

		this.value = toSignal(this.hiddenSignal, (newValue: Set<T>) => {
			if (newValue === this.hiddenValue) {
				//@ts-ignore
				console.warn("Assigning the same Set to WatchedSet.value has no effect.")
				return
			}

			// This avoids confusing behavior caused by passing a WatchedSet to .value
			if (!(newValue instanceof Set)) {
				//@ts-ignore
				console.warn("Converting new value to native Set.")
				newValue = sample(() => new Set(newValue))
			}

			this.runReplaceListeners(newValue)

			this.hiddenValue = newValue
			this.hiddenSignal(newValue)
		})
	}

	private runEditListeners(value: T, add: boolean) {
		_runAtBaseWithState(false, false, undefined, undefined, () => {
			batch(() => {
				for (let i = 0; i < this.editListeners.length; i++) {
					this.editListeners[i](value, add)
				}
			})
		})
	}

	private runReplaceListeners(newValue: ReadonlySet<T> | null) {
		_runAtBaseWithState(false, false, undefined, undefined, () => {
			batch(() => {
				for (let i = 0; i < this.replaceListeners.length; i++) {
					this.replaceListeners[i](this.hiddenValue, newValue)
				}
			})
		})
	}

	onEdit(listener: ((value: T, add: boolean) => void)) {
		this.editListeners.push(listener)
		onCleanup(() => {
			const idx = this.editListeners.indexOf(listener)
			if (idx === -1) {
				//@ts-ignore
				console.warn("Unexpected state: unable to remove onEdit listener")
			}

			this.editListeners.splice(idx, 1)
		})
	}

	onReplace(listener: ((oldSet: ReadonlySet<T>, newSet: ReadonlySet<T> | null) => void)) {
		this.replaceListeners.push(listener)

		onCleanup(() => {
			const idx = this.replaceListeners.indexOf(listener)
			if (idx === -1) {
				//@ts-ignore
				console.warn("Unexpected state: unable to remove onReplace listener")
			}

			this.replaceListeners.splice(idx, 1)
		})
	}

	add(value: T) {
		this.hiddenValue.add(value)

		this.runEditListeners(value, true)

		this.hiddenSignal(this.hiddenValue) // trigger everything listening on value()

		return this
	}

	has(value: T) {
		return this.value().has(value)
	}

	delete(value: T) {
		const wasChanged = this.hiddenValue.delete(value)

		if (wasChanged) {
			this.runEditListeners(value, false)

			this.hiddenSignal(this.hiddenValue)
		}

		return wasChanged
	}

	clear() {
		if (this.hiddenValue.size > 0) {
			this.runReplaceListeners(null)

			this.hiddenValue.clear()

			this.hiddenSignal(this.hiddenValue)
		}
	}

	entries() {
		return this.value().entries()
	}

	keys() {
		return this.value().keys()
	}

	values() {
		return this.value().values()
	}

	[Symbol.iterator]() {
		return this.value()[Symbol.iterator]()
	}

	get size() {
		return this.value().size
	}
}
