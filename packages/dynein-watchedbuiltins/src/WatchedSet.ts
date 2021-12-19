import { default as DyneinState, DataSignal } from "dynein-state"
import WatchedValue from "./WatchedValue.js"

export default class WatchedSet<T> extends WatchedValue<Set<T>> {
	readonly value: DataSignal<Set<T>>;

	constructor(iterable?: T[] | Iterable<T> | null | undefined | DataSignal<Set<T>>) {
		super();
		if (DyneinState.isDataSignal(iterable)) {
			this.value = iterable
		} else {
			this.value = DyneinState.data(new Set(iterable));
		}
	}

	add(value: T) {
		this.v.add(value);
		this.fire();
		return this;
	}

	has(value: T) {
		return this.value().has(value);
	}

	delete(value: T) {
		const out = this.v.delete(value);
		this.fire();
		return out;
	}

	clear() {
		this.v.clear();
		this.fire();
	}

	get size() {
		return this.value().size;
	}

	[Symbol.iterator]() {
		return this.value()[Symbol.iterator]();
	}
}
