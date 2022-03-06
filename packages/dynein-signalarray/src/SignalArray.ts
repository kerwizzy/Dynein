import { createSignal, Signal, sample } from "@dynein/state"

export default class SignalArray<T> {
	readonly value: Signal<T[]>
	readonly spliceEvent: Signal<[startIndex: number, removeLength: number, added: T[], removed: T[]] | null>

	constructor(iterable?: Iterable<T>) {
		this.value = createSignal(iterable ? Array.from(iterable) : [], true)
		this.spliceEvent = createSignal<[startIndex: number, removeLength: number, added: T[], removed: T[]] | null>(null)
	}

	private get v() {
		return sample(this.value);
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

	private fire() {
		this.value(sample(this.value))
	}

	splice(start: number, remove: number, ...insert: T[]) {
		const removed = this.v.splice(start, remove, ...insert)
		this.spliceEvent([start, remove, removed, insert])
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
