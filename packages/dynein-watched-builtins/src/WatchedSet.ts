import { Signal, sample, isSignal, createSignal, toSignal } from "@dynein/state"
import WatchedValue from "./WatchedValue.js"

export default class WatchedSet<T> extends WatchedValue<Set<T>> {
	readonly value: Signal<Set<T>>
	readonly editEvent: Signal<[key: T, value: T | undefined, add: boolean] | null> // event for *any* call. Not necessarily one that actually changes the map.

	constructor(iterable?: Iterable<T> | null | undefined | Signal<Set<T>>) {
		super()

		const baseSignal = isSignal(iterable) ? iterable : createSignal(iterable ? new Set(iterable as Iterable<T>) : new Set(), true) as Signal<Set<T>>

		this.editEvent = createSignal(null, true)

		this.value = toSignal(() => baseSignal(), (value: Set<T>) => {
			if (value !== sample(baseSignal)) {
				// used in Hyperfor to detect an overwrite of the entire set. Hyperfor can't just
				// listen on set.value() because that gets fired for every .add and .delete

				// Update this before firing spliceEvent because the handlers in Hyperfor will need
				// to read the updated set value
				baseSignal(value)

				this.editEvent(null)
			} else {
				baseSignal(value)
			}
		})
	}

	add(value: T) {
		this.v.add(value)
		// TODO only fire on actual insertion
		this.editEvent([value, value, true])
		this.fire()
		return this
	}

	has(value: T) {
		return this.value().has(value)
	}

	delete(value: T) {
		const out = this.v.delete(value)
		this.editEvent([value, undefined, false])
		this.fire()
		return out
	}

	clear() {
		this.v.clear()
		this.editEvent(null)
		this.fire()
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
