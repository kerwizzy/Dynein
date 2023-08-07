import { createSignal, Signal, sample, isSignal, toSignal, subclock } from "@dynein/state"
import WatchedValue from "./WatchedValue.js"

export default class WatchedArray<T> extends WatchedValue<T[]> {
	readonly value: Signal<T[]>
	readonly spliceEvent: Signal<[startIndex: number, added: T[], removed: T[]] | null>

	constructor(iterable?: Iterable<T> | Signal<T[]> | null | undefined) {
		super()

		const baseSignal = isSignal(iterable) ? iterable : createSignal(iterable ? Array.from(iterable as Iterable<T>) : [], true)

		this.value = toSignal(()=>baseSignal(), (value: T[]) => {
			if (value !== sample(baseSignal)) {
				// used in Hyperfor to detect an overwrite of the entire array. Hyperfor can't just
				// listen on array.value() because that gets fired for every .splice

				// Update this before firing spliceEvent because the handlers in Hyperfor will need
				// to read the updated array value
				baseSignal(value)

				this.spliceEvent(null)
			} else {
				baseSignal(value)
			}
		})

		this.spliceEvent = createSignal<[startIndex: number, added: T[], removed: T[]] | null>(null, true)
	}

	map<U>(fn: (value: T, index: number, array: T[]) => U): U[] {
		return this.value().map(fn)
	}
	slice(start?: number, end?: number): T[] {
		return this.value().slice(start, end)
	}
	every(pred: (element: T, index: number) => boolean): boolean {
		return this.value().every(pred)
	}
	find(pred: (element: T, index: number) => boolean): T | undefined {
		return this.value().find(pred)
	}
	findIndex(pred: (element: T, index: number) => boolean): number {
		return this.value().findIndex(pred)
	}
	includes(searchElement: T, fromIndex?: number): boolean {
		return this.value().includes(searchElement, fromIndex)
	}
	indexOf(searchElement: T, fromIndex?: number): number {
		return this.value().indexOf(searchElement, fromIndex)
	}
	lastIndexOf(searchElement: T, fromIndex?: number): number {
		return this.value().lastIndexOf(searchElement, fromIndex)
	}
	some(pred: (element: T, index: number) => boolean): boolean {
		return this.value().some(pred)
	}
	join(sep?: string): string {
		return this.value().join(sep)
	}
	[Symbol.iterator]() {
		return this.value()[Symbol.iterator]()
	}
	get length() {
		return this.value().length
	}

	splice(start: number, remove: number, ...insert: T[]) {
		if (start < 0) {
			throw new Error("Cannot splice before the beginning of the array")
		}
		if (start > this.v.length) {
			throw new Error("Cannot splice after the end of the array")
		}
		const removed = this.v.splice(start, remove, ...insert)

		this.spliceEvent([start, insert, removed])

		this.fire()
		return removed
	}

	push(...items: T[]) {
		this.splice(this.v.length, 0, ...items);
		return this.v.length;
	}

	unshift(...items: T[]) {
		this.splice(0, 0, ...items);
		return this.v.length;
	}

	pop(): T | undefined {
		const removed = this.splice(this.v.length-1, 1);
		return removed[0]
	}

	shift(): T | undefined {
		const removed = this.splice(0, 1);
		return removed[0]
	}

	set(index: number, value: T) {
		this.splice(index, 1, value)
		return value
	}

	get(index: number) {
		return this.value()[index]
	}
}
