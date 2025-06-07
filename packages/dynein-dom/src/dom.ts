import { toSignal, onCleanup, assertStatic, createEffect, Owner, batch, untrack, isSignal, sample, retrack, getOwner, runWithOwner, createSignal, addCustomStateStasher, _updateState, Signal } from "@dynein/state"

type Primitive = string | number | boolean | undefined | null

export type EventsMap<TagMap extends Record<string, any>, ElName extends string> = {
	[EvName in keyof GlobalEventHandlersEventMap as `on${EvName}`]: (
		this: TagMap[ElName],
		ev: GlobalEventHandlersEventMap[EvName]
	) => void
}

export type AttrsAndEventsMap<TagMap extends Record<string, any>, ElName extends string> = Record<
	string,
	Primitive | ((...args: any[]) => any)
> & (Partial<EventsMap<TagMap, ElName>> & { style?: any })

const updateEventTable: Record<string, string> = {
	value: "input",
	checked: "input",
	selectedIndex: "input" //<select>
}

function replacementArea(start: Node, end: Node, setupReplacements: (replaceInner: <T>(inner: () => T) => T) => void) {
	let isFirst = true

	let destroyed = false
	onCleanup(() => {
		destroyed = true
	})

	const parentNode = start.parentNode

	setupReplacements(<T>(inner: () => T) => {
		if (!destroyed) {
			if (!start.parentNode) {
				throw new Error("Unexpected state")
			}
			if (!isFirst) {
				const range = document.createRange()
				range.setStartAfter(start)
				range.setEndBefore(end)
				range.deleteContents()
			}
		}

		isFirst = false
		return setInsertionState(parentNode, end, () => {
			return assertStatic(inner)
		})
	})
}

function setAttrOrProp(el: SVGElement | HTMLElement, name: string, val: any) {
	if (el.namespaceURI === "http://www.w3.org/2000/svg" || name.startsWith("data-") || name.startsWith("aria-")) {
		el.setAttribute(name, val)
	} else {
		if (name === "class") {
			name = "className"
		}
		//@ts-ignore
		el[name] = val
	}
}

type ElementNamespace = "xhtml" | "svg"
type ElementTagNameMapForNamespace = {
	xhtml: HTMLElementTagNameMap
	svg: SVGElementTagNameMap
}

// Internal variables and functions used when building DOM structures
let insertTarget: Node | null = null
let insertBeforeNode: Node | null = null

addCustomStateStasher(() => {
	const old_insertTarget = insertTarget
	const old_insertBeforeNode = insertBeforeNode

	return () => {
		insertTarget = old_insertTarget
		insertBeforeNode = old_insertBeforeNode
	}
})

export function addNode<T extends Node>(node: T): T {
	if (insertTarget === null) {
		throw new Error("not rendering")
	}
	if (insertBeforeNode && insertBeforeNode.parentNode !== insertTarget) {
		// Do nothing. The area we're in must have been destroyed since the end node is gone or moved
	} else {
		insertTarget.insertBefore(node, insertBeforeNode) // if insertBeforeNode is null, just added to end
	}

	return node
}

export function setInsertionState<T>(
	parentNode: Node | null,
	beforeNode: Node | null,
	inner: () => T
) {
	const old_insertTarget = insertTarget
	const old_insertBeforeNode = insertBeforeNode
	insertTarget = parentNode
	insertBeforeNode = beforeNode
	try {
		return inner()
	} finally {
		insertTarget = old_insertTarget
		insertBeforeNode = old_insertBeforeNode
	}
}

export function getTarget(): Node | null {
	return insertTarget
}

function stringify(val: Primitive): string {
	return val?.toString() ?? ""
}

// (void | undefined) forces you to not have return values, since that will almost always be a mistake.
type Inner<T> = ((parent: T) => (void | undefined)) | Primitive

function wrapEventListener(fn: any) {
	const owner = new Owner()
	return function wrappedListener() {
		owner.reset()
		_updateState(false, false, owner, undefined, () => {
			//@ts-ignore
			fn.apply(this, arguments)
		})
	}
}

function createSignalUpdateListener(el: any, attr: string, sig: Signal<any>) {
	return () => {
		sig(el[attr])
	}
}

function createAndInsertElement<
	Namespace extends ElementNamespace,
	TagName extends string & keyof ElementTagNameMapForNamespace[Namespace]
>(
	namespace: Namespace,
	tagName: TagName,
	attrs: AttrsAndEventsMap<ElementTagNameMapForNamespace[Namespace], TagName> | null,
	inner: Inner<Node>
): Node {
	// See https://stackoverflow.com/a/28734954
	let el: SVGElement | HTMLElement
	if (namespace === "svg") {
		el = document.createElementNS("http://www.w3.org/2000/svg", tagName)
	} else {
		el = document.createElement(tagName)
	}

	if (attrs) {
		for (const attributeName in attrs) {
			//@ts-ignore
			const val = attrs[attributeName]
			if (attributeName.startsWith("on")) {
				if (val === undefined || val === null) {
					continue
				}
				if (typeof val !== "function") {
					throw new Error("Listeners must be functions.")
				}
				el.addEventListener(attributeName.substring(2).toLowerCase(), wrapEventListener(val))
			} else if (typeof val === "function") {
				if (isSignal(val)) {
					const updateEventName: string | undefined = updateEventTable[attributeName]
					if (updateEventName) {
						el.addEventListener(updateEventName, createSignalUpdateListener(el, attributeName, val))
					} else {
						console.warn(
							`No update event in table for attribute "${attributeName}", so couldn't bind.`
						)
						//fallthrough to watch below
					}
				}
				createEffect(() => {
					// TODO: this will be re-run whenever the value signal changes, even if the signal
					// was updated by the addEventListener above and the signal is already in sync
					// with the DOM. There isn't a good way to stop this effect from running again,
					// but we can stop the redundant setAttrOrProp call by caching the last value we
					// got from the DOM. Would that be worth it? Might it cause unexpected behavior
					// if people manually assign to the element .value attribute?
					const rawVal = val() ?? ""
					setAttrOrProp(el, attributeName, rawVal)
				})
			} else {
				setAttrOrProp(el, attributeName, val)
			}
		}
	}

	if (inner !== null) {
		if (typeof inner === "function") {
			//console.log(`<${tagName}>`)
			setInsertionState(el, null, () => {
				inner(el)
			})
			//console.log(`</${tagName}>`)
		} else {
			el.appendChild(document.createTextNode(stringify(inner)))
		}
	}

	//special case to init selects properly. This has to be done after the options list has been
	// added by inner()
	if (tagName === "select" && attrs && namespace === "xhtml") {
		const specialSelectAttrs = ["value", "selectedIndex"]
		for (const attr of specialSelectAttrs) {
			if (attr in attrs) {
				//@ts-ignore
				const val = attrs[attr]
				if (typeof val === "function") {
					const rawVal = sample(val) ?? ""
					setAttrOrProp(el, attr, rawVal)
				} else {
					setAttrOrProp(el, attr, (val as any) ?? "")
				}
			}
		}
	}

	addNode(el)
	return el
}

type MakeBoundCreateFunc<TagNameMap extends Record<string, any>, TagName extends string & keyof TagNameMap> =
	((attrs: AttrsAndEventsMap<TagNameMap, TagName>) => TagNameMap[TagName]) &
	((attrs: AttrsAndEventsMap<TagNameMap, TagName>, inner: Inner<TagNameMap[TagName]>) => TagNameMap[TagName]) &
	((inner: Inner<TagNameMap[TagName]>) => TagNameMap[TagName]) &
	(() => TagNameMap[TagName])

export type BoundCreateFunc<
	Namespace extends ElementNamespace,
	TagName extends string & keyof ElementTagNameMapForNamespace[Namespace]
> = MakeBoundCreateFunc<ElementTagNameMapForNamespace[Namespace], TagName>

export type CreationProxy<Namespace extends ElementNamespace> = {
	[K in keyof ElementTagNameMapForNamespace[Namespace] & string]: BoundCreateFunc<Namespace, K>
}

function makeCreateElementsProxy<Namespace extends ElementNamespace>(namespace: Namespace) {
	return new Proxy(Object.create(null), {
		get(target, tagName, receiver) {
			if (typeof tagName !== "string") {
				throw new Error("tagName must be a string")
			}
			function boundCreate(a?: any, b?: any) { //implementation of the BoundCreate overload
				const aIsObject = typeof a === "object"
				if (a === undefined && b === undefined) {
					return createAndInsertElement(namespace, tagName as any, null, null)
				} else if (aIsObject && b === undefined) {
					return createAndInsertElement(namespace, tagName as any, a, null)
				} else if (b === undefined) {
					return createAndInsertElement(namespace, tagName as any, null, a)
				} else if (aIsObject) {
					return createAndInsertElement(namespace, tagName as any, a, b)
				} else {
					throw new Error("Unexpected state")
				}
			}
			return boundCreate
		}
	})
}

export const elements = makeCreateElementsProxy("xhtml") as CreationProxy<"xhtml">
export const svgElements = makeCreateElementsProxy("svg") as CreationProxy<"svg">

let idCounter = 0
export function createUniqueId(): string {
	return "__d" + (idCounter++)
}

export function addHTML(html: string): void {
	if (typeof html !== "string" && typeof html !== "number") {
		throw new Error("HTML must be a string or number")
	}
	const tmp = document.createElement("template")
	tmp.innerHTML = html
	const frag = tmp.content
	addNode(frag)
}

export function addText(val: Primitive | (() => Primitive)): Node {
	const node = document.createTextNode("")
	setInsertionState(null, null, () => {
		if (typeof val === "function") {
			createEffect(() => {
				node.textContent = stringify(val())
			})
		} else {
			node.textContent = stringify(val)
		}
	})
	return addNode(node)
}

export function addPortal(parentNode: Node, inner: () => void): void
export function addPortal(parentNode: Node, beforeNode: Node | null, inner: () => void): void
export function addPortal(parentNode: Node, beforeOrInner: Node | null | (() => void), maybeInner?: () => void) {
	let inner: () => void
	let beforeNode: Node | null
	if (typeof beforeOrInner === "function") {
		inner = beforeOrInner
		beforeNode = null
	} else {
		inner = maybeInner!
		beforeNode = beforeOrInner
	}

	const startNode = document.createComment("<portal>")
	const endNode = document.createComment("</portal>")
	parentNode.insertBefore(startNode, beforeNode)
	parentNode.insertBefore(endNode, beforeNode)
	onCleanup(() => {
		const range = document.createRange()
		range.setStartBefore(startNode)
		range.setEndAfter(endNode)
		range.deleteContents()
	})

	assertStatic(() => {
		setInsertionState(parentNode, endNode, inner)
	})
}

export function mountBody(inner: () => void) {
	if (document.body) {
		addPortal(document.body, null, inner)
	} else {
		const savedOwner = getOwner()
		window.addEventListener("load", () => {
			runWithOwner(savedOwner, () => {
				addPortal(document.body, null, inner)
			})
		})
	}
}

export function addAsyncReplaceable(
	setupReplacements: (
		replaceInner: <T>(inner: () => T) => T,
		dependent: (inner: () => void) => void
	) => void
) {
	replacementArea(
		addNode(document.createComment("<async>")),
		addNode(document.createComment("</async>")),
		($r) => {
			const saved = getOwner()
			const owner = new Owner()
			setInsertionState(null, null, () => {
				setupReplacements((inner) => {
					owner.reset()
					return runWithOwner(owner, () => {
						return assertStatic(() => {
							return $r(inner)
						})
					})
				}, (inner: () => void) => {
					runWithOwner(saved, inner)
				})
			})
		}
	)
}

export function addDynamic(inner: () => void): void {
	replacementArea(
		addNode(document.createComment("<dynamic>")),
		addNode(document.createComment("</dynamic>")),
		($r) => {
			createEffect(() => {
				$r(() => {
					retrack(inner)
				})
			})
		}
	)
}

export function addAsync<T>(inner: () => T): T {
	let out: any
	replacementArea(
		addNode(document.createComment("<async-append>")),
		addNode(document.createComment("</async-append>")),
		($r) => {
			$r(() => {
				out = inner()
			})
		}
	)
	return out!
}

export function addIf(ifCond: () => any, inner: () => void) {
	const conds: (() => boolean)[] = []
	const inners: (() => void)[] = []
	const nConds = createSignal(conds.length)
	function addStage(cond: () => boolean, inner: () => void) {
		conds.push(cond)
		inners.push(inner)
		nConds(conds.length)
	}

	const ifStageMaker = {
		elseif(cond: () => any, inner: () => void) {
			addStage(cond, inner)
			return ifStageMaker
		},
		else(inner: () => void): void {
			addStage(() => true, inner)
		}
	}

	addStage(ifCond, inner)

	addAsyncReplaceable(($r) => {
		let oldI = -1
		createEffect(() => {
			for (let i = 0; i < nConds(); i++) {
				if (conds[i]()) {
					if (oldI !== i) {
						oldI = i
						$r(inners[i])
					}
					return
				}
			}
			oldI = -1
			$r(() => { })
		})
	})

	return ifStageMaker
}

export { default as addFor } from "./addFor.js"
