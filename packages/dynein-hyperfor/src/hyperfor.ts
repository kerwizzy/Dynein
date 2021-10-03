import D, {DataPort, DestructionContext} from "dynein"

enum RenderState {
	keep,
	add,
	remove
}

interface Render<T> {
	state: RenderState

	value: T

	start: Node | null
	end: Node | null

	prev: Render<T> | null
	next: Render<T> | null

	ctx: DestructionContext

	debugID: string
}

export default class Hyperfor<T> {
	startItem: Render<T> | null
	toPatch: Render<T>[]
	start: Node
	end: Node
	render: (item: T) => void
	boundPatch: ()=>void
	ctx: DestructionContext | null | undefined

	constructor(init: T[], render: (item: T) => void) {
		this.render = render
		this.start = D.dom.node(document.createComment("<hyperfor>"))
		this.toPatch = []
		this.startItem = null

		this.end = D.dom.node(document.createComment("</hyperfor>"))

		this.boundPatch = this.patch.bind(this)

		this.ctx = D.state.getContext()
		console.log("create hyperfor set ctx = ",this.ctx)

		this.set(init)
		this.patch()
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
		for (const render of this.toPatch) {
			render.ctx.destroy()
		}
		this.toPatch = []
	}

	set(val: T[]) {
		D.state.setContext(this.ctx, ()=>{
			this.clear()

			this.startItem = null
			D.dom.runInNodeContext(this.end.parentNode, this.end, ()=>{
				D.state.expectStatic(()=>{
					for (let i = 0; i<val.length; i++) {
						const value = val[i]

						const debugID = "dbg_"+Math.random().toString(16).substring(2, 8)
						const start = D.dom.node(document.createComment(debugID))
						const ctx = new D.state.DestructionContext()
						ctx.resume(()=>{
							this.render(value)
						})
						const end = D.dom.node(document.createComment(debugID))
						const render: Render<T> = {
							state: RenderState.keep,
							value,
							start,
							end,
							prev: null,
							next: null,
							ctx,
							debugID: debugID
						}
						if (i === 0) {
							this.startItem = render
						} else {
							render.prev = this.toPatch[i-1]
							render.prev.next = render
						}
						this.toPatch.push(render)
					}
				})
			})
		})
	}

	getItem(i: number) {
		return this.toPatch[i].value
	}

	splice(start: number, remove: number, ...insert: T[]) {
		return this.spliceArr(start, remove, insert)
	}

	spliceArr(start: number, remove: number, insert: T[]) {
		const values: T[] = []
		D.state.setContext(this.ctx, ()=>{
			for (let i = start; i<start+remove; i++) {
				values.push(this.toPatch[i].value)
				this.toPatch[i].state = RenderState.remove
			}
			const afterIndex = start+remove
			let prev = afterIndex >= 1 ? this.toPatch[afterIndex-1] : null

			const toInsert: Render<T>[] = []

			for (let j = 0; j<insert.length; j++) {
				const value = insert[j]

				const debugID = "dbg_"+Math.random().toString(16).substring(2, 8)
				const render: Render<T> = {
					state: RenderState.add,
					value,
					start: null,
					end: null,
					prev: prev,
					next: null,
					ctx: new D.state.DestructionContext(),
					debugID
				}
				if (prev === null) {
					this.startItem = render
				} else {
					prev.next = render
				}
				prev = render
				toInsert.push(render)
			}

			if (afterIndex < this.toPatch.length) {
				const afterRender = this.toPatch[afterIndex]
				if (prev) {
					prev.next = afterRender
					afterRender.prev = prev
				}
			}

			this.toPatch.splice(start, remove, ...toInsert)
		})
		return values
	}

	findIndex(fn: (item: T) => boolean) {
		for (let i = 0; i<this.toPatch.length; i++) {
			if (fn(this.toPatch[i].value)){
				return i
			}
		}
		return -1
	}

	get length() {
		return this.toPatch.length
	}

	patch() {
		const rendered: Render<T>[] = []
		let item = this.startItem
		let prevNode = this.start
		D.state.expectStatic(()=>{
			while (item) {
				if (item.state === RenderState.add) {
					D.dom.runInNodeContext(prevNode.parentNode, prevNode.nextSibling, ()=>{
						item!.start = D.dom.node(document.createComment(item!.debugID))
						item!.ctx.reset()
						item!.ctx.resume(()=>{
							this.render(item!.value)
						})
						item!.end = D.dom.node(document.createComment(item!.debugID))
					})

					prevNode = item.end!
					rendered.push(item)

					item.state = RenderState.keep
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
					item.ctx.destroy()

					// don't change prevNode
				} else {
					//nothing to do, continue
					prevNode = item.end!
					rendered.push(item)
				}

				item = item.next
			}
		})
		this.toPatch = rendered
	}
}

