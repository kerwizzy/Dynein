import { assertStatic, createEffect, createSignal, Owner, getOwner, onCleanup, onUpdate, runWithOwner, sample, Signal } from "@dynein/state"
import { addNode, setInsertionState } from "@dynein/dom"
import { WatchedArray } from "@dynein/watched-builtins"

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

class Hyperfor<T> {
	private startItem: ItemPatchState<T> | null = null
	private desiredState: ItemPatchState<T>[] = []
	private arr: WatchedArray<T>
	private start: Node
	private end: Node
	private render: (item: T, index: ()=>number) => void
	private owner: Owner

	private patchScheduled: boolean = false

	constructor(arr: WatchedArray<T>, render: (item: T, index: ()=>number) => void) {
		this.render = render
		this.start = addNode(document.createComment("<hyperfor>"))
		this.end = addNode(document.createComment("</hyperfor>"))

		this.owner = new Owner()
		this.arr = arr

		this.reset()
		this.setupSpliceWatcher()
	}

	private clear() {
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
		this.desiredState = []
	}

	private reset() {
		this.clear()

		let prev: null | ItemPatchState<T> = null
		const arr = sample(this.arr.value)
		for (const item of arr) {
			const state: ItemPatchState<T> = {
				state: RenderState.add,
				value: item,
				prev: prev,
				next: null,
				start: null,
				end: null,
				indexSignal: createSignal(0),
				owner: new Owner(this.owner),
				debugID: "dbg_"+Math.random().toString(16).substring(2, 8)
			}
			if (prev) {
				prev.next = state
			} else {
				this.startItem = state
			}
			this.desiredState.push(state)
			prev = state
		}

		this.patch()
	}

	private setupSpliceWatcher() {
		onUpdate(this.arr.spliceEvent, (evt) => {
			if (!evt) {
				this.reset()
			} else {
				const [start, added, removed] = evt

				for (let i = start; i<start+removed.length; i++) {
					this.desiredState[i].state = RenderState.remove
				}
				const afterIndex = start+removed.length
				const lastRemoved = afterIndex >= 1 ? this.desiredState[afterIndex-1] : null
				let prev = lastRemoved

				const toInsert: ItemPatchState<T>[] = []

				for (let j = 0; j<added.length; j++) {
					const value = added[j]

					const debugID = "dbg_"+Math.random().toString(16).substring(2, 8)
					const state: ItemPatchState<T> = {
						state: RenderState.add,
						value,
						start: null,
						end: null,
						prev: prev,
						next: null,
						indexSignal: createSignal(0),
						owner: new Owner(this.owner),
						debugID
					}
					if (prev === null) {
						this.startItem = state
					} else {
						prev.next = state
					}
					prev = state
					toInsert.push(state)
				}

				if (afterIndex < this.desiredState.length) {
					const afterRender = this.desiredState[afterIndex]
					if (prev) {
						prev.next = afterRender
						afterRender.prev = prev
					}
				}

				this.desiredState.splice(start, removed.length, ...toInsert)

				this.schedulePatch()
			}
		})
	}

	private schedulePatch() {
		if (this.patchScheduled) {
			return
		}
		this.patchScheduled = true
		requestAnimationFrame(()=>{
			this.patch()
		})
	}

	private patch() {
		this.patchScheduled = false
		const rendered: ItemPatchState<T>[] = []
		let itemIterator = this.startItem
		let prevNode = this.start
		const render = this.render // assign to a variable so the Hyperfor isn't set as the `this` value inside `render()`
		assertStatic(()=>{
			let index = 0
			while (itemIterator) {
				const item = itemIterator
				if (item.state === RenderState.add) {
					item.indexSignal(index)

					setInsertionState(prevNode.parentNode, prevNode.nextSibling, ()=>{
						item.start = addNode(document.createComment(item!.debugID))
						runWithOwner(item.owner, ()=>{
							render(item!.value, item.indexSignal)
						})
						item.end = addNode(document.createComment(item!.debugID))
					})

					prevNode = item.end!
					rendered.push(item)

					item.state = RenderState.keep
					index++
				} else if (item.state === RenderState.remove) {
					const range = document.createRange()
					range.setStartBefore(item.start!)
					range.setEndAfter(item.end!)
					range.deleteContents()

					if (item.prev) {
						item.prev.next = item.next
					} else {
						this.startItem = item.next
					}
					if (item.next) {
						item.next.prev = item.prev
					}
					item.owner.destroy()

					// don't change prevNode
				} else {
					item.indexSignal(index)

					//nothing to do, continue
					prevNode = item.end!
					rendered.push(item)

					index++
				}

				itemIterator = item.next
			}
		})
		this.desiredState = rendered
	}
}

export default function hyperfor<T>(arr: WatchedArray<T>, render: (item: T, index: ()=>number) => void): void {
	new Hyperfor(arr, render)
}
