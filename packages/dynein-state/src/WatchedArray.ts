import { createSignal, Signal, sample, isSignal, toSignal, subclock, onWrite } from "./state.js"
import WatchedValue from "./WatchedValue.js"

export default class WatchedArray<T> extends WatchedValue<T[]> {
	readonly value: Signal<T[]>
	readonly spliceEvent: Signal<[start: number, added: T[], removed: T[]] | null>

	constructor(iterable?: Iterable<T> | Signal<T[]> | null | undefined) {
		super()

		const baseSignal = isSignal(iterable) ? iterable : createSignal(iterable ? Array.from(iterable as Iterable<T>) : [], true)

		this.value = toSignal(() => baseSignal(), (value: T[]) => {
			if (value !== sample(baseSignal)) {
				// used in @dynein/dom addFor to detect an overwrite of the entire array. addFor can'
				// just listen on array.value() because that gets fired for every .splice

				// Update this before firing spliceEvent because the handlers in addFor will need
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

	get length() {
		return this.value().length
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

	splice(start: number, deleteCount?: number): T[]
	splice(start: number, deleteCount: number, ...items: T[]): T[]
	splice(arg1: any, arg2: any, ...items: T[]): T[] {
		const currentArr = this.v
		const len = currentArr.length


		let start = arg1
		let remove = 0

		// Normalize arguments to the native JS behavior, so that things which consume .spliceEvent
		// don't have to do this normalization.
		if (arguments.length === 0) {
			return [] // splice called with no arguments, nothing to do.
		}

		start = start || 0

		if (arguments.length === 1) {
			// remove parameter *omitted*, not just undefined
			remove = Infinity
		} else {
			remove = arguments[1] || 0
		}

		if (start < 0) {
			if (start < -len) {
				start = 0
			} else {
				start = start + len
			}
		} else if (start >= len) {
			remove = 0
			start = len
		}

		if (remove < 0) {
			remove = 0
		}
		if (start + remove > len) {
			remove = len - start
		}

		// TODO: do more testing about the most performant way to pass the arguments list down to the real .splice
		const removed = currentArr.splice(start, remove, ...items)

		this.spliceEvent([start, items, removed])

		this.fire()
		return removed
	}

	// wrapper around .spliceEvent to give the added and removed items.
	onSplice(listener: (...args: ([start: number, added: T[], removed: T[]] | [undefined, undefined, undefined])) => void) {
		onWrite(this.spliceEvent, (evt) => {
			if (!evt) {
				listener(undefined, undefined, undefined)
				return
			}

			listener(evt[0], evt[1], evt[2])
		})
	}

	push(...items: T[]) {
		this.splice(this.v.length, 0, ...items)
		return this.v.length
	}

	unshift(...items: T[]) {
		this.splice(0, 0, ...items)
		return this.v.length
	}

	pop(): T | undefined {
		const removed = this.splice(this.v.length - 1, 1)
		return removed[0]
	}

	shift(): T | undefined {
		const removed = this.splice(0, 1)
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
