import { Signal, sample, isSignal, createSignal, toSignal } from "./state.js"
import WatchedValue from "./WatchedValue.js"


export default class WatchedMap<K, V> extends WatchedValue<Map<K, V>> {
	readonly value: Signal<Map<K, V>>
	readonly editEvent: Signal<[key: K, value: V | undefined, add: boolean] | null> // event for *any* call. Not necessarily one that actually changes the map.

	constructor(iterable?: Iterable<readonly [K, V]> | null | undefined | Signal<Map<K, V>>) {
		super()

		const baseSignal = isSignal(iterable) ? iterable : createSignal(iterable ? new Map<K, V>(iterable as any) : new Map(), true)

		this.editEvent = createSignal(null, true)

		this.value = toSignal(() => baseSignal(), (value: Map<K, V>) => {
			if (value !== sample(baseSignal)) {
				// used in @dynein/dom addFor to detect an overwrite of the entire map. addFor can't just
				// listen on set.value() because that gets fired for every .set and .delete

				// Update this before firing spliceEvent because the handlers in addFor will need
				// to read the updated set value
				baseSignal(value)

				this.editEvent(null)
			} else {
				baseSignal(value)
			}
		})
	}

	get(key: K): V | undefined {
		return this.value().get(key)
	}

	set(key: K, value: V) {
		const out = this.v.set(key, value)
		this.editEvent([key, value, true])
		this.fire()
		return out
	}

	has(key: K) {
		return this.value().has(key)
	}

	delete(key: K) {
		const out = this.v.delete(key)
		this.editEvent([key, undefined, false])
		this.fire()
		return out
	}

	clear() {
		const out = this.v.clear()
		this.editEvent(null)
		this.fire()
		return out
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
