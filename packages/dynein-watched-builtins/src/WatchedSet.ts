import { Signal, sample, isSignal, createSignal } from "@dynein/state"
import WatchedValue from "./WatchedValue.js"

export default class WatchedSet<T> extends WatchedValue<Set<T>> {
	readonly value: Signal<Set<T>>;

	constructor(iterable?: T[] | Iterable<T> | null | undefined | Signal<Set<T>>) {
		super();
		if (isSignal(iterable)) {
			this.value = iterable
		} else {
			this.value = createSignal<Set<T>>(iterable ? new Set(iterable as Iterable<T>) : new Set(), true);
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
