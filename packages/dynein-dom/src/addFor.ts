import { assertStatic, createEffect, createSignal, Owner, getOwner, onCleanup, onUpdate, runWithOwner, sample, Signal, onWrite, WatchedSet, WatchedMap, WatchedArray } from "@dynein/state"
import { addNode, setInsertionState } from "./dom.js"

enum RenderState {
	keep,
	add,
	remove
}

interface ItemPatchState<T> {
	state: RenderState

	value: T

	start: Node | null
	end: Node | null

	prev: ItemPatchState<T> | null
	next: ItemPatchState<T> | null

	owner: Owner

	indexSignal: Signal<number>

	debugID: string
}

class ForListArea<T> {
	startItem: ItemPatchState<T> | null = null
	endItem: ItemPatchState<T> | null = null
	start: Node
	end: Node
	render: (item: T, index: () => number) => void
	owner: Owner

	patchScheduled: boolean = false

	constructor(render: (item: T, index: () => number) => void) {
		this.render = render
		this.start = addNode(document.createComment("<for>"))
		this.end = addNode(document.createComment("</for>"))

		this.owner = new Owner()
	}

	clear() {
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
		this.startItem = null
		this.endItem = null
	}

	schedulePatch() {
		if (this.patchScheduled) {
			return
		}
		this.patchScheduled = true
		requestAnimationFrame(() => {
			this.patch()
		})
	}

	patch() {
		if (this.owner.isDestroyed) {
			return
		}
		this.patchScheduled = false
		let itemIterator = this.startItem
		let prevNode = this.start
		const render = this.render // assign to a variable so the ForListArea isn't set as the `this` value inside `render()`
		assertStatic(() => {
			let index = 0
			while (itemIterator) {
				const item = itemIterator
				if (item.state === RenderState.add) {
					item.indexSignal(index)

					setInsertionState(prevNode.parentNode, prevNode.nextSibling, false, () => {
						item.start = addNode(document.createComment(item!.debugID))
						runWithOwner(item.owner, () => {
							try {
								render(item!.value, item.indexSignal)
							} catch (err) {
								console.warn("Caught error while rendering item", item.value, ": ", err)
							}
						})
						item.end = addNode(document.createComment(item!.debugID))
					})

					prevNode = item.end!

					item.state = RenderState.keep
					index++
				} else if (item.state === RenderState.remove) {
					const range = document.createRange()

					// If it was actually rendered, which it might not have been (if an item is added
					// and removed between patches)
					if (item.start) {
						range.setStartBefore(item.start!)
						range.setEndAfter(item.end!)
						range.deleteContents()
					}

					if (item.prev) {
						item.prev.next = item.next
					} else {
						this.startItem = item.next
					}

					if (item.next) {
						item.next.prev = item.prev
					} else {
						this.endItem = item.prev
					}
					item.owner.destroy()

					// don't change prevNode
				} else {
					item.indexSignal(index)

					//nothing to do, continue
					prevNode = item.end!

					index++
				}

				itemIterator = item.next
			}
		})
	}
}

export default function addFor<T>(list: WatchedArray<T>, render: (item: T, index: () => number) => void): void
export default function addFor<T>(list: WatchedSet<T>, render: (item: T, index: () => number) => void): void
export default function addFor<K, V>(list: WatchedMap<K, V>, render: (item: [K, V], index: () => number) => void): void
export default function addFor(list: WatchedArray<any> | WatchedSet<any> | WatchedMap<any, any>, render: (item: any, index: () => number) => void): void {
	const hyp = new ForListArea(render)

	// WatchedSet should behave like a set being used like an array, and WatchedMap should behave
	// like an array of readonly tuples being used as a map. (So a value change will be equivalent
	// to an in-place splice/replace)
	if (list instanceof WatchedSet || list instanceof WatchedMap) {
		const keyToNodeMap = new Map<any, ItemPatchState<any>>()
		const isSet = list instanceof WatchedSet

		function reset() {
			const listVal = sample(list.value as Signal<Map<any, any> | Set<any>>)

			hyp.clear()
			keyToNodeMap.clear()

			let prev: null | ItemPatchState<any> = null

			for (const key of listVal.keys()) {
				const state: ItemPatchState<any> = {
					state: RenderState.add,
					value: listVal instanceof Set ? key : [key, listVal.get(key)],
					prev: prev,
					next: null,
					start: null,
					end: null,
					indexSignal: createSignal(0),
					owner: new Owner(hyp.owner),
					debugID: "dbg_" + Math.random().toString(16).substring(2, 8)
				}
				hyp.endItem = state // TODO is there some more efficient way to figure out endItem?
				if (prev) {
					prev.next = state
				} else {
					hyp.startItem = state
				}
				keyToNodeMap.set(key, state)
				prev = state
			}

			hyp.patch()
		}
		reset()

		onWrite(list.editEvent, (evt) => {
			if (!evt) {
				reset()
				return
			}
			const [key, val, add] = evt
			const existingNode = keyToNodeMap.get(key)
			if (!existingNode) {
				if (!add) {
					// ignore, delete called on non-existent key
					return
				}

				// adding to end then
				const state: ItemPatchState<any> = {
					state: RenderState.add,
					value: isSet ? key : [key, val],
					prev: hyp.endItem,
					next: null,
					start: null,
					end: null,
					indexSignal: createSignal(0),
					owner: new Owner(hyp.owner),
					debugID: "dbg_" + Math.random().toString(16).substring(2, 8)
				}
				keyToNodeMap.set(key, state)
				if (!hyp.startItem) {
					hyp.startItem = state
				}
				if (hyp.endItem) {
					hyp.endItem.next = state
				}
				hyp.endItem = state
			} else {
				if (add) {
					if (isSet) {
						// ignore, value already in set
						return
					}

					// Must be a map, and since the node already exists, we must be changing
					// the value. Since item values are immutable in ForListAreas,
					// this means deleting the old tuple and adding the new one.

					const newNode: ItemPatchState<any> = {
						state: RenderState.add,
						value: [key, val],
						prev: existingNode,
						next: existingNode.next,
						start: null,
						end: null,
						indexSignal: createSignal(0),
						owner: new Owner(hyp.owner),
						debugID: "dbg_" + Math.random().toString(16).substring(2, 8)
					}

					if (!existingNode.next) {
						hyp.endItem = newNode
					}

					existingNode.state = RenderState.remove
					if (existingNode.next) {
						existingNode.next.prev = newNode
					}
					existingNode.next = newNode
					keyToNodeMap.set(key, newNode)
				} else {
					// node already exists and we're deleting it

					existingNode.state = RenderState.remove
					keyToNodeMap.delete(key)
				}
			}
			hyp.schedulePatch()
		})
	} else {
		let desiredState: ItemPatchState<any>[] = []

		function reset() {
			hyp.clear()
			desiredState = []

			const arr = sample(list.value as Signal<any[]>)

			let prev: null | ItemPatchState<any> = null
			for (const item of arr) {
				const state: ItemPatchState<any> = {
					state: RenderState.add,
					value: item,
					prev: prev,
					next: null,
					start: null,
					end: null,
					indexSignal: createSignal(0),
					owner: new Owner(hyp.owner),
					debugID: "dbg_" + Math.random().toString(16).substring(2, 8)
				}
				if (prev) {
					prev.next = state
				} else {
					hyp.startItem = state
				}
				desiredState.push(state)
				prev = state
			}

			hyp.patch()
		}
		reset()

		// array
		onWrite(list.spliceEvent, (evt) => {
			if (!evt) {
				reset()
				return
			}

			const [start, added, removed] = evt

			for (let i = start; i < start + removed.length; i++) {
				desiredState[i].state = RenderState.remove
			}
			const afterIndex = start + removed.length
			const lastRemoved = afterIndex >= 1 ? desiredState[afterIndex - 1] : null
			let prev = lastRemoved
			const afterInsert = prev ? prev.next : hyp.startItem

			const toInsert: ItemPatchState<any>[] = []

			for (let j = 0; j < added.length; j++) {
				const value = added[j]

				const debugID = "dbg_" + Math.random().toString(16).substring(2, 8)
				const state: ItemPatchState<any> = {
					state: RenderState.add,
					value,
					start: null,
					end: null,
					prev: prev,
					next: null,
					indexSignal: createSignal(0),
					owner: new Owner(hyp.owner),
					debugID
				}
				if (prev === null) {
					hyp.startItem = state
				} else {
					prev.next = state
				}
				prev = state
				toInsert.push(state)
			}

			if (prev) {
				prev.next = afterInsert
			}
			if (afterInsert) {
				afterInsert.prev = prev
			}

			desiredState.splice(start, removed.length, ...toInsert)

			hyp.schedulePatch()
		})
	}
}
