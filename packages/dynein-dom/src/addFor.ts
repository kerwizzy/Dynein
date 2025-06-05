import { assertStatic, createEffect, createSignal, Owner, getOwner, onCleanup, onUpdate, runWithOwner, sample, Signal, onWrite, WatchedSet, WatchedMap, WatchedArray } from "@dynein/state"
import { addNode, setInsertionState } from "./dom.js"

const returnNaN = () => NaN

class ForListArea<T> {
	readonly start: Node
	readonly end: Node
	readonly updateIndex: boolean
	readonly render: (item: T, index: () => number) => void
	readonly owner: Owner

	private itemStartNodes: (Node | null)[]
	private itemEndNodes: (Node | null)[]
	private itemOwners: Owner[]
	private indexSignals: (Signal<number> | (() => number))[]

	nItems: number

	constructor(render: (item: T, index: () => number) => void, updateIndex: boolean) {
		this.render = render
		this.start = addNode(document.createComment("<for>"))
		this.end = addNode(document.createComment("</for>"))
		this.updateIndex = updateIndex

		this.owner = new Owner()

		this.itemStartNodes = []
		this.itemEndNodes = []
		this.indexSignals = []
		this.itemOwners = []

		this.nItems = 0
	}

	clear() {
		if (this.nItems === 0) {
			return // nothing to do
		}

		if (this.start.previousSibling === null && this.end.nextSibling === null) {
			const parent = this.start.parentNode!
			parent.textContent = ""
			parent.appendChild(this.start)
			parent.appendChild(this.end)
		} else {
			const range = document.createRange()
			range.setStartAfter(this.start)
			range.setEndBefore(this.end)
			range.deleteContents()
		}
		this.owner.reset()

		this.itemStartNodes = []
		this.itemEndNodes = []
		this.indexSignals = []
		this.itemOwners = []

		this.nItems = 0
	}

	splice(start: number, remove: number, insert: Iterable<T>): void {
		const listParent = this.start.parentNode! // TODO: can this ever be undefined?

		const firstIndexAfterDelete = start + remove
		if (remove > 0) {
			if (start === 0 && remove >= this.nItems) {
				this.clear()
			} else {
				if (start + remove > this.nItems) {
					remove = this.nItems - start
				}

				let deleteStartIndex = start
				while (this.itemStartNodes[deleteStartIndex] === null && deleteStartIndex < firstIndexAfterDelete) {
					deleteStartIndex++
				}

				if (deleteStartIndex === firstIndexAfterDelete) {
					// no nodes to delete, everything in the delete range was null
				} else {
					let deleteEndIndex = firstIndexAfterDelete - 1

					// we don't need a bounds check here because we know there must be something in
					// that range which isn't null
					while (this.itemStartNodes[deleteEndIndex] === null) {
						deleteEndIndex--
					}

					const deleteRangeStartNode = this.itemStartNodes[deleteStartIndex]!
					const deleteRangeEndNode = this.itemEndNodes[deleteEndIndex]!
					if (deleteRangeStartNode === deleteRangeEndNode) {
						// only one element, no need to create a Range
						listParent.removeChild(deleteRangeStartNode)
					} else {
						const range = document.createRange()
						range.setStartBefore(deleteRangeStartNode)
						range.setEndAfter(deleteRangeEndNode)
						range.deleteContents()
					}
				}

				for (let i = start; i < start + remove; i++) {
					this.itemOwners[i].destroy()
				}
			}
		}

		const newItemOwners: Owner[] = []
		const newItemStartNodes: (Node | null)[] = []
		const newItemEndNodes: (Node | null)[] = []
		const newItemIndexSignals: (Signal<number> | (() => number))[] = []

		// These are the indexes of the last and first items outside the range which rendered
		// at least one node
		let lastItemIndexBeforeModifyRange = start - 1
		while (lastItemIndexBeforeModifyRange >= 0 && this.itemStartNodes[lastItemIndexBeforeModifyRange] === null) {
			lastItemIndexBeforeModifyRange--
		}

		let firstItemIndexAfterModifyRange = firstIndexAfterDelete
		while (firstItemIndexAfterModifyRange < this.nItems && this.itemStartNodes[firstItemIndexAfterModifyRange] === null) {
			firstItemIndexAfterModifyRange++
		}

		const lastNodeBeforeModifyRange = lastItemIndexBeforeModifyRange >= 0 ? this.itemEndNodes[lastItemIndexBeforeModifyRange]! : this.start
		const firstNodeAfterModifyRange = firstItemIndexAfterModifyRange < this.nItems ? this.itemStartNodes[firstItemIndexAfterModifyRange]! : this.end

		let insertI = 0

		let iterator: Iterator<T> | null = null
		if (Array.isArray(insert)) {
			// no need for an iterator
		} else {
			iterator = insert[Symbol.iterator]()
		}

		let prevItemEndNode = lastNodeBeforeModifyRange
		while (true) {
			let item: T
			if (iterator) {
				const iteratorResult = iterator.next()
				if (iteratorResult.done) {
					break
				} else {
					item = iteratorResult.value
				}
			} else {
				if (insertI >= (insert as Array<T>).length) {
					break
				}
				item = (insert as Array<T>)[insertI]
			}

			// The parent scope was destroyed during rendering, so abort further rendering. (see dom.spec.js)
			if (this.owner.isDestroyed) {
				return
			}

			const itemOwner = new Owner(this.owner)

			newItemOwners.push(itemOwner)

			const itemIndexSignal = this.updateIndex ? createSignal(start + insertI) : returnNaN
			if (this.updateIndex) {
				newItemIndexSignals.push(itemIndexSignal)
			}

			setInsertionState(listParent, firstNodeAfterModifyRange, () => {
				runWithOwner(itemOwner, () => {
					try {
						this.render(item, itemIndexSignal)
					} catch (err) {
						console.warn("Caught error while rendering item", item, ":", err)
					}
				})
			})

			const itemStartNode = prevItemEndNode.nextSibling
			if (itemStartNode === firstNodeAfterModifyRange) {
				// Didn't actually render anything
				newItemStartNodes.push(null)
				newItemEndNodes.push(null)
			} else {
				const itemEndNode = firstNodeAfterModifyRange.previousSibling
				newItemStartNodes.push(itemStartNode)
				newItemEndNodes.push(itemEndNode)
				prevItemEndNode = itemEndNode!
			}

			insertI++
		}

		// FIXME: maybe short-circuit no spread for empty insert?
		this.itemStartNodes.splice(start, remove, ...newItemStartNodes)
		this.itemEndNodes.splice(start, remove, ...newItemEndNodes)
		this.itemOwners.splice(start, remove, ...newItemOwners)

		if (this.updateIndex) {
			this.indexSignals.splice(start, remove, ...newItemIndexSignals)

			if (remove === newItemIndexSignals.length) {
				// added just as many elements as removed, so the indexes of subsequent items didn't change
			} else {
				// Update all the index signals after the splice area.
				for (let i = start + newItemIndexSignals.length; i < this.indexSignals.length; i++) {
					//@ts-ignore
					this.indexSignals[i](i)
				}
			}
		}

		this.nItems = this.itemStartNodes.length
	}
}

export default function addFor<T>(list: WatchedArray<T>, render: (item: T, index: () => number) => void, updateIndex?: boolean): void
export default function addFor<T>(list: WatchedSet<T>, render: (item: T, index: () => number) => void, updateIndex?: boolean): void
export default function addFor<K, V>(list: WatchedMap<K, V>, render: (item: [K, V], index: () => number) => void, updateIndex?: boolean): void
export default function addFor(list: WatchedArray<any> | WatchedSet<any> | WatchedMap<any, any>, render: (item: any, index: () => number) => void, updateIndex: boolean = false): void {
	const hyp = new ForListArea(render, updateIndex)

	// WatchedSet should behave like a set being used like an array, and WatchedMap should behave
	// like an array of readonly tuples being used as a map. (So a value change will be equivalent
	// to an in-place splice/replace)
	if (list instanceof WatchedSet || list instanceof WatchedMap) {
		let renderedKeys: any[] = []
		let renderedKeysSet = new Set<any>()

		const isSet = list instanceof WatchedSet

		function reset() {
			const listVal = sample(list.value as Signal<Map<any, any> | Set<any>>)

			hyp.clear()
			//@ts-ignore
			hyp.splice(0, 0, listVal instanceof Set ? listVal.values() : listVal.entries())

			renderedKeys = []
			renderedKeysSet.clear()
			for (const key of listVal.keys()) {
				renderedKeys.push(key)
				renderedKeysSet.add(key)
			}
		}
		reset()

		onWrite(list.editEvent, (evt) => {
			if (!evt) {
				reset()
				return
			}

			const [key, val, add] = evt

			if (!renderedKeysSet.has(key)) {
				if (!add) {
					// ignore, delete called on non-existent key
					return
				}

				// Add to end
				hyp.splice(hyp.nItems, 0, [isSet ? key : [key, val]])
				renderedKeys.push(key)
				renderedKeysSet.add(key)
			} else {
				// FIXME: maybe find some way of making modifications and deletions better than O(n)?
				if (add) {
					if (isSet) {
						// ignore, value already in set
						return
					}

					const existingEntryIndex = renderedKeys.indexOf(key)
					// Must be a map, and since the node already exists, we must be changing
					// the value. Since item values are immutable in ForListAreas,
					// this means deleting the old tuple and adding the new one.
					hyp.splice(existingEntryIndex, 1, [[key, val]])
				} else {
					const existingEntryIndex = renderedKeys.indexOf(key)
					// node already exists and we're deleting it
					hyp.splice(existingEntryIndex, 1, [])
					renderedKeys.splice(existingEntryIndex, 1)
					renderedKeysSet.delete(key)
				}
			}
		})
	} else {
		// array

		function reset() {
			hyp.clear()
			const arr = sample(list.value as Signal<any[]>)
			hyp.splice(0, 0, arr)
		}
		reset()

		onWrite(list.spliceEvent, (evt) => {
			if (!evt) {
				reset()
				return
			}

			hyp.splice(evt[0], evt[2].length, evt[1])
		})
	}
}
