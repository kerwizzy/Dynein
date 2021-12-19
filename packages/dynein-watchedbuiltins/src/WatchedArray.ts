import { default as DyneinState, DataSignal } from "dynein-state"
import WatchedValue from "./WatchedValue.js"

export default class WatchedArray<T> extends WatchedValue<T[]> {
	readonly value: DataSignal<T[]>;

	constructor(init?: DataSignal<T[]> | T[]) {
		super();
		if (DyneinState.isDataSignal(init)) {
			this.value = init
		} else {
			this.value = DyneinState.data(init ?? []);
		}
	}

	includes(searchElement: T, fromIndex?: number | undefined): boolean {
		return this.value().includes(searchElement, fromIndex);
	}
	indexOf(searchElement: T, fromIndex?: number | undefined): number {
		return this.value().indexOf(searchElement, fromIndex);
	}
	lastIndexOf(searchElement: T, fromIndex?: number | undefined): number {
		return this.value().lastIndexOf(searchElement, fromIndex);
	}
	map<U>(callbackfn: (value: T, index: number, array: T[]) => U, thisArg?: any): U[] {
		return this.value().map(callbackfn, thisArg);
	}

	splice(start: number, deleteCount: number, ...items: T[]) {
		const out = this.v.splice(start, deleteCount, ...items);
		this.fire();
		return out;
	} //TODO: other overload?

	push(...items: T[]) {
		const out = this.v.push(...items);
		this.fire();
		return out;
	}

	unshift(...items: T[]) {
		const out = this.v.unshift(...items);
		this.fire();
		return out;
	}

	pop() {
		const out = this.v.pop();
		this.fire();
		return out;
	}

	shift() {
		const out = this.v.shift();
		this.fire();
		return out;
	}

	get length() {
		return this.value().length;
	}

	[Symbol.iterator]() {
		return this.value()[Symbol.iterator]();
	}
}
