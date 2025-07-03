import { assertStatic, createEffect, createSignal, Owner, getOwner, onCleanup, onUpdate, runWithOwner, sample, Signal, onWrite, WatchedSet, WatchedMap, WatchedArray } from "@dynein/state"
import { addNode, setInsertionState } from "./dom.js"

const returnNaN = () => NaN

// const DEBUG = false

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

	// a = old, b = new
	//
	// For the sake of efficiency, ForListArea doesn't keep a copy of whole rendered array. It relies
	// on the caller to supply it with a list of what it has previously told ForListArea to render.
	// (Hence the need to pass `a`)
	replace(a: readonly T[], b: readonly T[]) {
		// if (DEBUG) console.log("REPLACE", a, b, "===================")

		const listParent = this.start.parentNode

		//@ts-ignore
		// if (DEBUG) console.log("initial", listParent.innerHTML)

		if (b.length === 0) {
			// clear
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
		} else {
			// do a diff and patch
			// Algorithm partially based on: https://github.com/ryansolid/dom-expressions/blob/main/packages/dom-expressions/src/reconcile.js (MIT License)

			// TODO: move all of these (and other variables below) outside the function so that they
			// aren't re-allocated every time this is called.
			const bLength = b.length

			let aEnd = a.length
			let bEnd = bLength
			let start = 0

			//Common prefix
			while (start < aEnd && start < bEnd && a[start] === b[start]) {
				start++
			}

			// Common suffix
			while (aEnd !== 0 && bEnd !== 0 && aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) {
				aEnd--
				bEnd--
			}

			// if (DEBUG) console.log("got", { aEnd, bEnd, start, aLength: a.length, bLength: b.length, this_nItems: this.nItems })

			if (start === aEnd) {
				// if (DEBUG) console.log("replace: found b only added")
				// b (the new list) only added items, specifically in the range from start to bEnd
				this.splice(start, 0, b.slice(start, bEnd))
			} else if (start === bEnd) {
				// if (DEBUG) console.log("replace: found b only removed")

				// b only removed items, specifically in the range from start to aEnd
				this.splice(start, aEnd - start, [])
			} else {
				// if (DEBUG) console.log("replace: fallback to map")
				// Fall back to adding, removing, or keeping individual items

				// Stage 1: Find matching old items and extract their (old) indexes
				const oldIndexes = new Map<T, number>()
				const oldStatuses = new Uint8Array(aEnd - start) // 1 = reused, 0 = not reused (should be destroyed)
				for (let aIndex = aEnd - 1; aIndex >= start; aIndex--) {
					// Walk backwards so the entries in the map are the earlier ones (if there are duplicate values)
					oldIndexes.set(a[aIndex], aIndex)
				}

				// if (DEBUG) console.log("replace: oldIndexes map", oldIndexes)

				// Stage 2: Now do the patch

				let lastItemIndexBeforeModifyRange = start - 1
				while (lastItemIndexBeforeModifyRange >= 0 && this.itemStartNodes[lastItemIndexBeforeModifyRange] === null) {
					lastItemIndexBeforeModifyRange--
				}

				let firstItemIndexAfterModifyRange = aEnd
				while (firstItemIndexAfterModifyRange < this.nItems && this.itemStartNodes[firstItemIndexAfterModifyRange] === null) {
					firstItemIndexAfterModifyRange++
				}

				// if (DEBUG) console.log("found", { lastItemIndexBeforeModifyRange, firstItemIndexAfterModifyRange, this_nItems: this.nItems })

				const lastNodeBeforeModifyRange = lastItemIndexBeforeModifyRange >= 0 ? this.itemEndNodes[lastItemIndexBeforeModifyRange]! : this.start
				const firstNodeAfterModifyRange = firstItemIndexAfterModifyRange < this.nItems ? this.itemStartNodes[firstItemIndexAfterModifyRange]! : this.end

				// if (DEBUG) console.log("lastNodeBeforeModifyRange", lastNodeBeforeModifyRange.textContent)
				// if (DEBUG) console.log("firstNodeAfterModifyRange", firstNodeAfterModifyRange.textContent)

				const listParent = this.start.parentNode! // TODO: can this ever be undefined?

				// (Some of these may be re-used, and so not really "new")
				const newItemOwners: Owner[] = []
				const newItemStartNodes: (Node | null)[] = []
				const newItemEndNodes: (Node | null)[] = []
				const newItemIndexSignals: (Signal<number> | (() => number))[] = []

				let prevItemEndNode: Node = firstNodeAfterModifyRange.previousSibling!
				// if (DEBUG) console.log("init prevItemEndNode = ", prevItemEndNode.textContent)

				let firstNodeOfModifyRange: Node | null = null
				for (let bIndex = start; bIndex < bEnd; bIndex++) {
					const bValue = b[bIndex]
					const oldIndex = oldIndexes.get(bValue)

					// if (DEBUG) console.log(`patching "${bValue}" to index ${bIndex}`)
					if (oldIndex !== undefined && oldStatuses[oldIndex - start] !== 1) {
						// We found an old item to re-use!

						// if (DEBUG) console.log(`found reuse item from ${oldIndex}`)

						// Make sure we don't reuse it again. This only allows a value to be swapped/re-used
						// *once*, but the caller can just wrap array items in an object to make sure
						// each item is unique.
						oldStatuses[oldIndex - start] = 1

						newItemOwners.push(this.itemOwners[oldIndex])
						newItemStartNodes.push(this.itemStartNodes[oldIndex])
						newItemEndNodes.push(this.itemEndNodes[oldIndex])

						if (this.updateIndex) {
							newItemIndexSignals.push(this.indexSignals[oldIndex])
						}

						const startNode = this.itemStartNodes[oldIndex]
						if (startNode === null) {
							// if (DEBUG) console.log("empty item")
							// empty item, nothing to do
						} else {
							const endNode = this.itemEndNodes[oldIndex]!

							if (endNode.nextSibling === firstNodeAfterModifyRange) {
								// Nothing to do, it's already in the right place
								// if (DEBUG) console.log("no move")

								firstNodeOfModifyRange ||= startNode
							} else {
								if (endNode === startNode) {
									// if (DEBUG) console.log("move single node")
									// only a single node to move forward

									firstNodeOfModifyRange ||= startNode
									listParent.insertBefore(startNode, firstNodeAfterModifyRange)

									//@ts-ignore
									// if (DEBUG) console.log("done move", listParent.innerHTML)

									prevItemEndNode = startNode
								} else {
									// if (DEBUG) console.log("move range")

									// move a range of nodes forward
									let walker = startNode
									while (true) {
										const next = walker.nextSibling

										firstNodeOfModifyRange ||= walker
										listParent.insertBefore(walker, firstNodeAfterModifyRange)

										if (walker === endNode) {
											break
										}
										walker = next!
									}

									//@ts-ignore
									// if (DEBUG) console.log("done move", listParent.innerHTML)

									prevItemEndNode = endNode
								}
							}
						}

						if (this.updateIndex) {
							(this.indexSignals[oldIndex] as Signal<number>)(bIndex)
						}
					} else {
						// if (DEBUG) console.log("replace: make new node")

						// we have to make a new item (eventually we'll delete the old one)

						// The parent scope was destroyed during rendering, so abort further rendering. (see dom.spec.js)
						if (this.owner.isDestroyed) {
							return
						}

						const itemOwner = new Owner(this.owner)

						newItemOwners.push(itemOwner)

						const itemIndexSignal = this.updateIndex ? createSignal(bIndex) : returnNaN
						if (this.updateIndex) {
							newItemIndexSignals.push(itemIndexSignal)
						}

						setInsertionState(listParent, firstNodeAfterModifyRange, () => {
							runWithOwner(itemOwner, () => {
								try {
									this.render(bValue, itemIndexSignal)
								} catch (err) {
									console.warn("Caught error while rendering item", bValue, ":", err)
								}
							})
						})

						//@ts-ignore
						// if (DEBUG) console.log("done add new node", listParent.innerHTML)

						const itemStartNode = prevItemEndNode.nextSibling
						if (itemStartNode === firstNodeAfterModifyRange) {
							// Didn't actually render anything
							newItemStartNodes.push(null)
							newItemEndNodes.push(null)
						} else {
							if (!firstNodeOfModifyRange) {
								// if (DEBUG) console.log("init firstNodeOfModifyRange = ", itemStartNode?.textContent)
							}
							firstNodeOfModifyRange ||= itemStartNode

							const itemEndNode = firstNodeAfterModifyRange.previousSibling
							newItemStartNodes.push(itemStartNode)
							newItemEndNodes.push(itemEndNode)
							prevItemEndNode = itemEndNode!
						}
					}
				}

				// Now go destroy the old items
				{
					for (let i = 0; i < oldStatuses.length; i++) {
						if (oldStatuses[i] !== 1) {
							// if (DEBUG) console.log(`destroying old item at old index ${i}`)
							this.itemOwners[start + i].destroy()
						}
					}

					// Both exclusive
					const oldItemsStart = lastNodeBeforeModifyRange
					const oldItemsEnd = firstNodeOfModifyRange || firstNodeAfterModifyRange

					//@ts-ignore
					// if (DEBUG) console.log("all items", listParent.innerHTML)
					// if (DEBUG) console.log("deleting between", oldItemsStart.textContent, oldItemsEnd.textContent)
					// if (DEBUG) console.log("check parents", oldItemsStart.parentNode, oldItemsEnd.parentNode, oldItemsStart.parentNode === listParent)
					const range = document.createRange()
					// if (DEBUG) console.log("setting start...")
					range.setStartAfter(oldItemsStart)
					// if (DEBUG) console.log("setting end...")
					range.setEndBefore(oldItemsEnd)
					// if (DEBUG) console.log("delete nodes")
					range.deleteContents()
				}

				// Splice in the new lists
				this.itemOwners.splice(start, aEnd - start, ...newItemOwners)
				this.itemStartNodes.splice(start, aEnd - start, ...newItemStartNodes)
				this.itemEndNodes.splice(start, aEnd - start, ...newItemEndNodes)

				if (this.updateIndex) {
					this.indexSignals.splice(start, aEnd - start, ...newItemIndexSignals)

					if (aEnd - start === newItemIndexSignals.length) {
						// added just as many elements as removed, so the indexes of subsequent items didn't change
					} else {
						// Update all the index signals after the modified area.
						for (let i = start + newItemIndexSignals.length; i < this.indexSignals.length; i++) {
							//@ts-ignore
							this.indexSignals[i](i)
						}
					}
				}

				this.nItems = this.itemStartNodes.length
			}

			for (let i = 0; i < this.itemStartNodes.length; i++) {
				const node = this.itemStartNodes[i]
				if (node) {
					if (node.parentNode !== listParent) {
						// if (DEBUG) console.log(`node ${i} "${node.textContent}"`)
						throw new Error("Unexpected state detached itemStartNode")
					}
				}
			}

			for (let i = 0; i < this.itemEndNodes.length; i++) {
				const node = this.itemEndNodes[i]
				if (node) {
					if (node.parentNode !== listParent) {
						// if (DEBUG) console.log(`node ${i} "${node.textContent}"`)
						throw new Error("Unexpected state detached itemEndNode")
					}
				}
			}
			// if (DEBUG) console.log("done checking final state")

			//@ts-ignore
			// if (DEBUG) console.log("replace done", listParent.innerHTML)
		}
	}

	splice(start: number, remove: number, insert: Iterable<T>): void {
		// if (DEBUG) console.log("splice", { start, remove, insert })

		const listParent = this.start.parentNode! // TODO: can this ever be undefined?

		const firstIndexAfterDelete = start + remove
		if (remove > 0) {
			if (start === 0 && remove >= this.nItems) {
				// clear
				// the `a` array in this case doesn't matter (see implementation above) so we can simply pass an empty array
				this.replace([], [])
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

		// if (DEBUG) console.log("got lastNodeBeforeModifyRange =", lastNodeBeforeModifyRange.textContent)
		// if (DEBUG) console.log("got firstNodeAfterModifyRange =", firstNodeAfterModifyRange.textContent)

		let insertI = 0

		let iterator: Iterator<T> | null = null
		if (Array.isArray(insert)) {
			// no need for an iterator
		} else {
			iterator = insert[Symbol.iterator]()
		}

		let prevItemEndNode = lastNodeBeforeModifyRange
		// if (DEBUG) console.log("init prevItemEndNode = ", prevItemEndNode)
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

			// if (DEBUG) console.log(`render item "${item}"`)
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
				// if (DEBUG) console.log(`didn't actually render`)
				// Didn't actually render anything
				newItemStartNodes.push(null)
				newItemEndNodes.push(null)
			} else {
				const itemEndNode = firstNodeAfterModifyRange.previousSibling
				// if (DEBUG) console.log("set prevItemEndNode = ", itemEndNode?.textContent)
				newItemStartNodes.push(itemStartNode)
				newItemEndNodes.push(itemEndNode)
				prevItemEndNode = itemEndNode!
			}

			// if (DEBUG) console.log(`done render item "${item}"`)

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

		// if (DEBUG) console.log("checking final splice state...")
		for (let i = 0; i < this.itemStartNodes.length; i++) {
			const node = this.itemStartNodes[i]
			if (node) {
				if (node.parentNode !== listParent) {
					// if (DEBUG) console.log(`node ${i} "${node.textContent}"`)
					throw new Error("Unexpected state detached itemStartNode")
				}
			}
		}

		for (let i = 0; i < this.itemEndNodes.length; i++) {
			const node = this.itemEndNodes[i]
			if (node) {
				if (node.parentNode !== listParent) {
					// if (DEBUG) console.log(`node ${i} "${node.textContent}"`)
					throw new Error("Unexpected state detached itemEndNode")
				}
			}
		}
		// if (DEBUG) console.log("done checking final state")

		this.nItems = this.itemStartNodes.length

		//@ts-ignore
		// if (DEBUG) console.log("splice done", listParent.innerHTML)
	}
}

const EMPTY_ARRAY: readonly any[] = []

export default function addFor<T>(list: WatchedArray<T>, render: (item: T, index: () => number) => void, updateIndex?: boolean): void
export default function addFor<T>(list: WatchedSet<T>, render: (item: T, index: () => number) => void, updateIndex?: boolean): void
export default function addFor<K, V>(list: WatchedMap<K, V>, render: (item: [K, V], index: () => number) => void, updateIndex?: boolean): void
export default function addFor(list: WatchedArray<any> | WatchedSet<any> | WatchedMap<any, any>, render: (item: any, index: () => number) => void, updateIndex: boolean = false): void {
	const area = new ForListArea(render, updateIndex)

	// WatchedSet should behave like a set being used like an array, and WatchedMap should behave
	// like an array of readonly tuples being used as a map. (So a value change will be equivalent
	// to an in-place splice/replace)
	if (list instanceof WatchedSet || list instanceof WatchedMap) {
		const isSet = list instanceof WatchedSet

		// init
		area.splice(0, 0, sample(() => isSet ? list.values() : list.entries()))

		// FIXME: maybe find some way of making Map and Set modifications and deletions better than O(n)?
		if (isSet) {
			let renderedKeys = Array.from(sample(() => list.keys()))
			let renderedKeysSet = new Set(renderedKeys)
			list.onEdit((value, add) => {
				if (add) {
					if (renderedKeysSet.has(value)) {
						// already rendered, ignore
					} else {
						// add to end
						area.splice(renderedKeys.length, 0, [value])
						renderedKeys.push(value)
						renderedKeysSet.add(value)
					}
				} else {
					// delete
					const existingEntryIndex = renderedKeys.indexOf(value)
					if (existingEntryIndex === -1) {
						// if (DEBUG) console.log("UNEXPECTED STATE: in renderedKeysSet but not renderedKeys array")
						return // Unexpected state TODO: should we have a message or some other response?
					}

					area.splice(existingEntryIndex, 1, EMPTY_ARRAY)
					renderedKeys.splice(existingEntryIndex, 1)
					renderedKeysSet.delete(value)
				}
			})

			list.onReplace((oldSet, newSet) => {
				const newRenderedKeys = newSet ? Array.from(newSet.keys()) : []
				area.replace(renderedKeys, newRenderedKeys)
				renderedKeys = newRenderedKeys
				renderedKeysSet = new Set(renderedKeys)
			})
		} else {
			let renderedTuples: (readonly [any, any])[] = Array.from(sample(() => list.entries()))

			let renderedKeysSet = new Set(renderedTuples.map(([k]) => k))

			list.onEdit((key, value, setting) => {
				// if (DEBUG) console.log("map onEdit", key, value, setting)
				if (renderedKeysSet.has(key)) {
					let existingEntryIndex = -1
					for (let i = 0; i < renderedTuples.length; i++) {
						if (renderedTuples[i][0] === key) {
							existingEntryIndex = i
							break
						}
					}

					// if (DEBUG) console.log("got existingEntryIndex", existingEntryIndex)

					if (existingEntryIndex === -1) {
						// if (DEBUG) console.log("UNEXPECTED STATE: in renderedKeysSet but not renderedTuples array")
						return // Unexpected state TODO: should we have a message or some other response?
					}

					if (setting) {
						const existingTuple = renderedTuples[existingEntryIndex]
						// if (DEBUG) console.log("existing tuple =", existingTuple)
						if (existingTuple[1] !== value) {
							// if (DEBUG) console.log("update via remove/insert")
							const newTuple = [key, value] as const
							renderedTuples[existingEntryIndex] = newTuple
							// Since item values are immutable in ForListAreas,
							// this means deleting the old tuple and adding the new one.
							area.splice(existingEntryIndex, 1, [newTuple])
						} else {
							// if (DEBUG) console.log("value not modified, ignore")
							// value not modified, don't do anything
						}
					} else {
						// deleting
						// if (DEBUG) console.log("deleting entry")
						area.splice(existingEntryIndex, 1, EMPTY_ARRAY)
						renderedTuples.splice(existingEntryIndex, 1)
						renderedKeysSet.delete(key)
					}
				} else {
					if (setting) {
						// if (DEBUG) console.log("adding new entry")
						// adding a new entry -> add to rendered end
						const newTuple = [key, value] as const
						area.splice(renderedTuples.length, 0, [newTuple])
						renderedTuples.push(newTuple)
						renderedKeysSet.add(key)
					} else {
						// if (DEBUG) console.log("deleting non-existent key, ignore")
						// deleting something which isn't in the map to begin with, ignore
					}
				}
			})


			list.onReplace((oldMap, newMap) => {
				let newTuples: (readonly [any, any])[] = []
				if (newMap) {
					for (const tuple of newMap) {
						if (oldMap.has(tuple[0])) {
							let existingEntryIndex = -1
							for (let i = 0; i < renderedTuples.length; i++) {
								if (renderedTuples[i][0] === tuple[0]) {
									existingEntryIndex = i
									break
								}
							}

							if (existingEntryIndex === -1) {
								// if (DEBUG) console.log("UNEXPECTED STATE: in oldMap but not renderedTuples array")
								newTuples.push(tuple)
							} else {
								// push old tuple so that replace algorithm will preserve old entries
								newTuples.push(renderedTuples[existingEntryIndex])
							}
						} else {
							newTuples.push(tuple)
						}
					}
				}

				area.replace(renderedTuples, newTuples)
				renderedTuples = newTuples
				renderedKeysSet = new Set(newTuples.map(([k]) => k))
			})
		}
	} else {
		// init
		area.splice(0, 0, sample(list.value))

		list.onReplace((oldArray, newArray) => {
			area.replace(oldArray, newArray)
		})

		list.onSplice((start, added, removed) => {
			area.splice(start, removed.length, added)
		})
	}
}
