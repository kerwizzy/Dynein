import { default as DyneinState, DataPort } from "dynein-state"
import WatchedValue from "./WatchedValue.js"

export default class WatchedMap<K, V> extends WatchedValue<Map<K, V>> {
	readonly value: DataPort<Map<K, V>>;

	constructor(iterable?: Iterable<readonly [K,V]> | null | undefined | DataPort<Map<K,V>>) {
		super();
		if (DyneinState.isDataPort(iterable)) {
			this.value = iterable
		} else if (iterable) {
			this.value = DyneinState.data(new Map<K, V>(iterable));
		} else {
			this.value = DyneinState.data(new Map())
		}
	}

	get(key: K): V | undefined {
		return this.value().get(key)
	}

	set(key: K, value: V) {
		const out = this.v.set(key, value);
		this.fire();
		return out;
	}

	has(key: K) {
		return this.value().has(key);
	}

	delete(key: K) {
		const out = this.v.delete(key);
		this.fire();
		return out;
	}

	clear() {
		const out = this.v.clear();
		this.fire();
		return out;
	}

	entries() {
		return this.value().entries();
	}
}
