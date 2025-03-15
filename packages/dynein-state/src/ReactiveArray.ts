import WatchedArray from "./WatchedArray.js"
import { Signal, createSignal, sample, batch, onUpdate, createEffect, Owner, runWithOwner, getOwner, assertStatic, untrack, onWrite } from "./state.js"

type ReactiveArrayItem<T> = {
	value: T,
	index: () => number
	owner?: Owner
}

// https://stackoverflow.com/a/41956372

/**
 * Return min <= i <= max such that !pred(i - 1) && pred(i).
 */
function binarySearch(min: number, max: number, pred: (val: number) => boolean) {
	let lo = min - 1, hi = max
	while (1 + lo < hi) {
		const mi = lo + ((hi - lo) >> 1)
		if (pred(mi)) {
			hi = mi
		} else {
			lo = mi
		}
	}
	return hi
}

export class MappableReactiveArray<T> {
	readonly array: WatchedArray<ReactiveArrayItem<T>>

	protected readonly rawArray: ReactiveArrayItem<T>[]

	constructor(items: T[]) {
		this.array = new WatchedArray(items.map((value, i) => ({ value, index: createSignal(i) })))

		this.rawArray = sample(this.array.value)
	}

	map<U>(fn: (item: T, index: () => number) => U, equalityChecker?: (oldValue: U | undefined, newValue: U) => boolean): MappableReactiveArray<U> {
		const mapped = new MappableReactiveArray<U>([])

		const outerOwner = getOwner()
		const mapItem = (baseItem: ReactiveArrayItem<T>): ReactiveArrayItem<U> => {
			const baseValue = baseItem.value

			const baseIndexSignal = baseItem.index

			let mappedItem: ReactiveArrayItem<U>
			let oldMappedValue: U

			const owner = new Owner(outerOwner)
			runWithOwner(owner, () => {
				createEffect(() => {
					const mappedValue = fn(baseValue, baseIndexSignal)
					const firstRun = !mappedItem

					mappedItem = { value: mappedValue, index: baseIndexSignal, owner }

					if (!firstRun) {
						if (equalityChecker ? !equalityChecker(oldMappedValue, mappedValue) : oldMappedValue !== mappedValue) {
							mapped.array.set(sample(baseIndexSignal), mappedItem)
						}
					}

					oldMappedValue = mappedValue
				})
			})

			return mappedItem!
		}

		mapped.array.value(this.rawArray.map(mapItem))

		this.array.onSplice((startIndex, added, removed) => {
			if (startIndex === undefined) {
				return
			}
			const mappedAdded = added.map(mapItem)

			const mappedRemoved = mapped.array.splice(startIndex, removed.length, ...mappedAdded)
			mappedRemoved.forEach(item => item.owner?.destroy())
		})

		return mapped
	}

	filter(fn: (item: T, index: () => number) => boolean): MappableReactiveArray<T> {
		const intermediate = this.map<{ keep: boolean, value: T, filteredItem?: ReactiveArrayItem<T> }>((item, index) => ({ keep: fn(item, index), value: item }), (o, n) => o?.keep === n.keep)

		const filtered = new ReactiveArray<T>([])
		for (const item of intermediate) {
			if (item.keep) {
				const filteredItem = filtered.push(item.value)
				item.filteredItem = filteredItem
			}
		}

		intermediate.array.onSplice((startIndexInIntermediate, intermediateAdded, intermediateRemoved) => {
			if (startIndexInIntermediate === undefined) {
				return
			}

			// count how many of the removed intermediate items were actually in the filtered list at all
			const totalFilteredRemoved = intermediateRemoved.reduce((acc, val) => val.value.keep ? acc + 1 : acc, 0)

			const firstRemovedInFiltered = intermediateRemoved.find(item => item.value.keep)

			let startIndexInFiltered: number
			if (firstRemovedInFiltered) {
				// one of the removed items was in the filtered list, so we know where to insert

				if (!firstRemovedInFiltered.value.filteredItem) {
					throw new Error("Unexpected state")
				}

				startIndexInFiltered = firstRemovedInFiltered.value.filteredItem.index()
			} else {
				// none of the removed items were in the filtered list, so we don't know where
				// intermediateStart maps to in the filtered list.

				// TODO: we could use a binary search if we had an inverse map from filtered index to
				// intermediate index.

				const arr = intermediate.array.value()

				// iterate backwards because the items in startIndexInIntermediate after startIndexInIntermediate
				// will be the *new* intermediate items, and it's a bit less confusing to go backwards.
				let i = startIndexInIntermediate - 1
				for (; i >= 0; i--) {
					const intermediateItem = arr[i]
					if (intermediateItem.value.keep) {
						if (!intermediateItem.value.filteredItem) {
							throw new Error("Unexpected state")
						}
						startIndexInFiltered = intermediateItem.value.filteredItem.index() + 1
						break
					}
				}

				startIndexInFiltered ??= 0
			}

			const filteredToAdd = intermediateAdded.filter(item => item.value.keep)
			const [filteredAdded] = filtered.splice(startIndexInFiltered, totalFilteredRemoved, ...filteredToAdd.map(item => item.value.value))

			for (let i = 0; i < filteredToAdd.length; i++) {
				filteredToAdd[i].value.filteredItem = filteredAdded[i]
			}
		})

		return filtered
	}

	sort(cmp: (a: T, b: T) => number): MappableReactiveArray<T> {
		const sorted = new ReactiveArray<T>([])

		const thisToSorted: ReactiveArrayItem<T>[] = []

		for (const item of this) {
			const sortedItem = sorted.push(item)
			thisToSorted.push(sortedItem)
		}

		const sortedArr = sample(sorted.array.value)

		assertStatic(() => {
			sortedArr.sort((aItem, bItem) => cmp(aItem.value, bItem.value))
		})

		for (let i = 0; i < sortedArr.length; i++) {
			//@ts-ignore
			sortedArr[i].index(i)
		}

		this.array.onSplice((start, thisAdded, thisRemoved) => {
			if (start === undefined) {
				return
			}

			for (let i = start; i < start + thisRemoved.length; i++) {
				const sortedIndex = thisToSorted[i].index()
				sorted.splice(sortedIndex, 1)
			}

			const sortedAdded: ReactiveArrayItem<T>[] = []
			assertStatic(() => {
				for (const item of thisAdded) {
					const thisValue = item.value
					const insertIndex = binarySearch(0, sortedArr.length, (maybeAfter) => cmp(thisValue, sortedArr[maybeAfter].value) < 0)

					const sortedAddedItem = sorted.splice(insertIndex, 0, item.value)[0][0]
					sortedAdded.push(sortedAddedItem)
				}
			})

			thisToSorted.splice(start, thisRemoved.length, ...sortedAdded)
		})

		return sorted
	}

	effectForEach(fn: (value: T, index: () => number) => void): void {
		const handleItem = (item: ReactiveArrayItem<T>) => {
			return createEffect(() => {
				fn(item.value, item.index)
			})
		}

		const destructables = this.rawArray.map(handleItem)

		const outerOwner = getOwner()
		this.array.onSplice((start, added, removed) => {
			if (start === undefined) {
				return
			}

			const destructablesToAdd = runWithOwner(outerOwner, () => added.map(handleItem))

			const toDestroy = destructables.splice(start, removed.length, ...destructablesToAdd)

			toDestroy.forEach(d => d.destroy())
		})
	}

	static fromWatchedArray<T>(arr: WatchedArray<T>): MappableReactiveArray<T> {
		const out = new ReactiveArray(sample(arr.value))

		arr.onSplice((startIndex, added, removed) => {
			if (startIndex === undefined) {
				return
			}

			out.splice(startIndex, removed.length, ...added)
		})

		return out
	}

	*[Symbol.iterator]() {
		for (const item of this.array) {
			yield item.value
		}
	}
}


export class ReactiveArray<T> extends MappableReactiveArray<T> {
	splice(start: number, remove: number, ...insert: T[]): [added: ReactiveArrayItem<T>[], removed: ReactiveArrayItem<T>[]] {
		const mappedInsert = insert.map((value, i) => ({ value, index: createSignal(start + i) }))

		let removed: ReactiveArrayItem<T>[]
		untrack(() => {
			batch(() => {
				removed = this.array.splice(start, remove, ...mappedInsert)

				const rawArr = this.array.value()
				for (let i = start; i < this.array.length; i++) {
					//@ts-ignore
					rawArr[i].index(i)
				}
			})
		})

		return [mappedInsert, removed!]
	}

	set(index: number, value: T): ReactiveArrayItem<T> {
		const [mappedInsert] = this.splice(index, 1, value)
		return mappedInsert[0]
	}

	push(value: T): ReactiveArrayItem<T> {
		return this.splice(this.rawArray.length, 0, value)[0][0]
	}
}
