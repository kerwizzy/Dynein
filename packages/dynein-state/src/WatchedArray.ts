import { createSignal, Signal, sample, toSignal, onCleanup, _runAtBaseWithState, batch } from "./state.js"

export default class WatchedArray<T> {
	readonly value: Signal<readonly T[]>

	private array: T[]
	private readonly hiddenSignal: Signal<T[]>
	private readonly spliceListeners: ((startIndex: number, added: T[], removed: T[]) => void)[] = []
	private readonly replaceListeners: ((oldArray: readonly T[], newArray: readonly T[]) => void)[] = []

	constructor(iterable?: Iterable<T> | undefined) {
		this.array = iterable ? Array.from(iterable) : []
		this.hiddenSignal = createSignal(this.array, true)

		this.value = toSignal(this.hiddenSignal, (newValue: T[]) => {
			if (newValue === this.array) {
				//@ts-ignore
				console.warn("Assigning the same array to WatchedArray.value has no effect.")
				return
			}

			// This avoids confusing behavior caused by passing a WatchedArray to .value
			if (!Array.isArray(newValue)) {
				//@ts-ignore
				console.warn("Converting new value to native array.")
				newValue = sample(() => Array.from(newValue))
			}

			_runAtBaseWithState(false, false, undefined, undefined, () => {
				batch(() => {
					for (let i = 0; i < this.replaceListeners.length; i++) {
						this.replaceListeners[i](this.array, newValue)
					}
				})
			})

			this.array = newValue
			this.hiddenSignal(newValue)
		})
	}

	onSplice(listener: ((startIndex: number, added: T[], removed: T[]) => void)) {
		this.spliceListeners.push(listener)
		onCleanup(() => {
			const idx = this.spliceListeners.indexOf(listener)
			if (idx === -1) {
				//@ts-ignore
				console.warn("Unexpected state: unable to remove onSplice listener")
			}

			this.spliceListeners.splice(idx, 1)
		})
	}

	onReplace(listener: ((oldArray: readonly T[], newArray: readonly T[]) => void)) {
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

	map<U>(fn: (value: T, index: number, array: readonly T[]) => U): U[] {
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
		const len = this.array.length

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
		const removed = this.array.splice(start, remove, ...items)

		_runAtBaseWithState(false, false, undefined, undefined, () => {
			batch(() => {
				for (let i = 0; i < this.spliceListeners.length; i++) {
					this.spliceListeners[i](start, items, removed)
				}
			})
		})

		this.hiddenSignal(this.array) // trigger everything listening on value()

		return removed
	}



	push(...items: T[]) {
		this.splice(this.array.length, 0, ...items)
		return this.array.length
	}

	unshift(...items: T[]) {
		this.splice(0, 0, ...items)
		return this.array.length
	}

	pop(): T | undefined {
		const removed = this.splice(this.array.length - 1, 1)
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
