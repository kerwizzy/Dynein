import { Signal, sample, createSignal, toSignal, onCleanup, _runAtBaseWithState, batch } from "./state.js"

export default class WatchedMap<K, V> {
	readonly value: Signal<ReadonlyMap<K, V>>

	private hiddenValue: Map<K, V>
	private readonly hiddenSignal: Signal<Map<K, V>>

	// Use `any` instead of `T` to make typescript not complain in certain situations
	private readonly editListeners: ((key: any, value: any, setting: boolean) => void)[] = []
	private readonly replaceListeners: ((oldMap: ReadonlyMap<any, any>, newMap: ReadonlyMap<any, any> | null) => void)[] = []

	constructor(iterable?: Iterable<readonly [K, V]> | undefined) {
		this.hiddenValue = iterable ? new Map(iterable) : new Map()
		this.hiddenSignal = createSignal(this.hiddenValue, true)

		this.value = toSignal(this.hiddenSignal, (newValue: Map<K, V>) => {
			if (newValue === this.hiddenValue) {
				//@ts-ignore
				console.warn("Assigning the same Map to WatchedMap.value has no effect.")
				return
			}

			// This avoids confusing behavior caused by passing a WatchedMap to .value
			if (!(newValue instanceof Map)) {
				//@ts-ignore
				console.warn("Converting new value to native Map.")
				newValue = sample(() => new Map(newValue))
			}

			this.runReplaceListeners(newValue)

			this.hiddenValue = newValue
			this.hiddenSignal(newValue)
		})
	}

	private runEditListeners(key: K, value: V | undefined, setting: boolean) {
		_runAtBaseWithState(false, false, undefined, undefined, () => {
			batch(() => {
				for (let i = 0; i < this.editListeners.length; i++) {
					this.editListeners[i](key, value, setting)
				}
			})
		})
	}

	private runReplaceListeners(newValue: ReadonlyMap<K, V> | null) {
		_runAtBaseWithState(false, false, undefined, undefined, () => {
			batch(() => {
				for (let i = 0; i < this.replaceListeners.length; i++) {
					this.replaceListeners[i](this.hiddenValue, newValue)
				}
			})
		})
	}

	onEdit(listener: ((key: K, value: V | undefined, setting: boolean) => void)) {
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

	onReplace(listener: ((oldMap: ReadonlyMap<K, V>, newMap: ReadonlyMap<K, V> | null) => void)) {
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

	get(key: K): V | undefined {
		return this.value().get(key)
	}

	set(key: K, value: V) {
		const out = this.hiddenValue.set(key, value)

		this.runEditListeners(key, value, true)

		this.hiddenSignal(this.hiddenValue) // fire

		return out
	}

	has(key: K) {
		return this.value().has(key)
	}

	delete(key: K) {
		const wasChanged = this.hiddenValue.delete(key)

		if (wasChanged) {
			this.runEditListeners(key, undefined, false)

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
