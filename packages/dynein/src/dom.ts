import DyneinState from "dynein-state";

type Primitive = string | number | boolean | undefined | null;

export type EventsMap<TagMap extends Record<string, any>, ElName extends string> = {
	[EvName in keyof GlobalEventHandlersEventMap as `on${EvName}`]: (
		this: TagMap[ElName],
		ev: GlobalEventHandlersEventMap[EvName]
	) => void;
};

export type AttrsAndEventsMap<TagMap extends Record<string, any>, ElName extends string> = Record<
	string,
	Primitive | ((...args: any[]) => any)
> &
	Partial<EventsMap<TagMap, ElName>> | {style?: any, class?: any};

const updateEventTable: Record<string, string> = {
	//map of attribute:onchangeEventName
	innerHTML: "input", //for contentEditable:true
	value: "input",
	checked: "input",
	selectedIndex: "input" //<select>
};

function replacementVRange(start: Node, end: Node, setupReplacements: (replaceInner: (inner: () => void) => void) => void) {
	let isFirst = true;

	let destroyed = false;
	DyneinState.cleanup(() => {
		destroyed = true;
	});
	setupReplacements((inner: () => void) => {
		if (destroyed) {
			return;
		}
		if (!start.parentNode) {
			throw new Error("Unexpected state");
		}
		if (!isFirst) {
			const range = document.createRange();
			range.setStartAfter(start);
			range.setEndBefore(end);
			range.deleteContents();
		}

		isFirst = false;
		runInNodeContext(start.parentNode, end, ()=>{
			DyneinState.expectStatic(inner)
		});
	});
}

const customPropertyHandlers: Map<string, (el: SVGElement | HTMLElement, val: Primitive) => void> =
	new Map();

// from https://github.com/kangax/html-minifier/blob/gh-pages/src/htmlminifier.js#L202
const booleanAttributes = [
	"allowfullscreen",
	"async",
	"autofocus",
	"autoplay",
	"checked",
	"compact",
	"controls",
	"declare",
	"default",
	"defaultchecked",
	"defaultmuted",
	"defaultselected",
	"defer",
	"disabled",
	"enabled",
	"formnovalidate",
	"hidden",
	"indeterminate",
	"inert",
	"ismap",
	"itemscope",
	"loop",
	"multiple",
	"muted",
	"nohref",
	"noresize",
	"noshade",
	"novalidate",
	"nowrap",
	"open",
	"pauseonexit",
	"readonly",
	"required",
	"reversed",
	"scoped",
	"seamless",
	"selected",
	"sortable",
	"truespeed",
	"typemustmatch",
	"visible"
];

function setAttrOrProp(el: SVGElement | HTMLElement, name: string, val: any) {
	if (name.startsWith("on")) {
		throw new Error("Unexpected state")
	}

	if (customPropertyHandlers.has(name)) {
		let handler = customPropertyHandlers.get(name)!;
		handler(el, val);
		return;
	}

	/*
	if (name === "style") {
		el.style.cssText = stringifyForInner(val);
	} else if (booleanAttributes.includes(name.toLowerCase())) {
		if (val) {
			el.setAttribute(name, "true");
		} else {
			el.removeAttribute(name);
		}
	} else {
		// @ts-ignore
		el.setAttribute(name, val);
	}*/
	if (name === "class") {
		name = "className"
	}
	if (name === "style" && typeof val === "object") {
		for (const styleKey in val) {
			const styleVal = val[styleKey]
			if (typeof styleVal === "function") {
				DyneinState.watch(() => {
					const rawVal = styleVal() ?? ""
					el.style.setProperty(styleKey, rawVal)
				});
			} else {
				el.style.setProperty(styleKey, styleVal)
			}
		}
	} else {
		if (el.namespaceURI === "http://www.w3.org/2000/svg") {
			el.setAttribute(name, val)
		} else {
			//@ts-ignore
			el[name] = val
		}
	}
}

type ElementNamespace = "xhtml" | "svg";
type ElementTagNameMapForNamespace = {
	xhtml: HTMLElementTagNameMap;
	svg: SVGElementTagNameMap;
};

// Internal variables and functions used when building DOM structures
let currentNode: Node | null = null;
let currentEndNode: Node | null = null;

function insertNode<T extends Node>(node: T): T {
	if (currentNode === null) {
		throw new Error("not rendering");
	}
	currentNode.insertBefore(node, currentEndNode); // if currentEndNode is null, just added to end
	return node;
}

function runInNodeContext(
	nodeForInner: Node | null,
	endNodeForInner: Node | null,
	inner: () => void
) {
	const oldCurrentNode = currentNode;
	const oldEndNode = currentEndNode;
	currentNode = nodeForInner;
	currentEndNode = endNodeForInner;
	try {
		inner();
	} finally {
		currentNode = oldCurrentNode;
		currentEndNode = oldEndNode;
	}
}

function stringifyForInner(val: Primitive): string {
	return val?.toString() ?? "";
}

// TODO: is (void | undefined) what we want here? It seems to help force you to not have return values, since that will almost always be a mistake, but it doesn't force you to have return undefined.
type Inner<T> = ((parent: T) => (void | undefined)) | Primitive;
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
	let el: SVGElement | HTMLElement;
	if (namespace === "svg") {
		el = document.createElementNS("http://www.w3.org/2000/svg", tagName);
	} else {
		el = document.createElement(tagName);
	}

	if (attrs) {
		for (const attributeName in attrs) {
			//@ts-ignore
			const val = attrs[attributeName];
			if (attributeName.startsWith("on")) {
				if (val === undefined || val === null) {
					continue;
				}
				if (typeof val !== "function") {
					throw new Error("Listeners must be functions.");
				}
				const ctx = new DyneinState.DestructionContext();
				el.addEventListener(attributeName.substring(2).toLowerCase(), function () {
					ctx.reset();
					ctx.resume(() => {
						DyneinState.batch(()=>{
							DyneinState.ignore(()=>{
								//@ts-ignore
								val.apply(this, arguments);
							})
						})
					});
				});
			} else if (typeof val === "function") {
				//@ts-ignore
				if (DyneinState.isDataSignal(val)) {
					const updateEventName: string | undefined = updateEventTable[attributeName];
					if (updateEventName) {
						el.addEventListener(updateEventName, () => {
							//@ts-ignore
							let newVal = el[attributeName];
							val(newVal);
						});
					} else {
						console.warn(
							`No update event in table for attribute "${attributeName}", so couldn't bind.`
						);
						//fallthrough to watch below
					}
				}
				DyneinState.watch(() => {
					const rawVal =  val() ?? ""
					setAttrOrProp(el, attributeName, rawVal);
				});
			} else {
				setAttrOrProp(el, attributeName, (val as any) ?? ""); //TODO: Would be nice if this wasn't necessary
			}
		}
	}

	if (inner !== null) {
		if (typeof inner === "function") {
			//console.log(`<${tagName}>`)
			runInNodeContext(el, null, () => {
				inner(el);
			});
			//console.log(`</${tagName}>`)
		} else {
			el.appendChild(document.createTextNode(stringifyForInner(inner)));
		}
	}

	//special case to init selects properly. has to be done after options list added
	if (namespace === "xhtml" && tagName === "select" && attrs && "value" in attrs) {
		const val = attrs.value
		if (typeof val === "function") {
			const rawVal = DyneinState.sample(val) ?? ""
			setAttrOrProp(el, "value", rawVal);
		} else {
			setAttrOrProp(el, "value", (val as any) ?? "")
		}
	}

	insertNode(el);
	return el;
}

type MakeBoundCreateFunc<TagNameMap, TagName extends string & keyof TagNameMap> =
	((attrs: AttrsAndEventsMap<TagNameMap, TagName>) => TagNameMap[TagName]) &
	((attrs: AttrsAndEventsMap<TagNameMap, TagName>, inner: Inner<TagNameMap[TagName]>) => TagNameMap[TagName]) &
	((inner: Inner<TagNameMap[TagName]>) => TagNameMap[TagName]) &
	(() => TagNameMap[TagName]);

export type BoundCreateFunc<
	Namespace extends ElementNamespace,
	TagName extends string & keyof ElementTagNameMapForNamespace[Namespace]
> = MakeBoundCreateFunc<ElementTagNameMapForNamespace[Namespace], TagName>;

export type CreationProxy<Namespace extends ElementNamespace> = {
	[K in keyof ElementTagNameMapForNamespace[Namespace] & string]: BoundCreateFunc<Namespace, K>;
};

function makeCreateElementsProxy<Namespace extends ElementNamespace>(namespace: Namespace) {
	return new Proxy(Object.create(null), {
		get(target, tagName, receiver) {
			if (typeof tagName !== "string") {
				throw new Error("tagName must be a string");
			}
			function boundCreate(a?: any, b?: any) { //implementation of the BoundCreate overload
				if (typeof a === "undefined" && typeof b === "undefined") {
					return createAndInsertElement(namespace, tagName as any, null, null);
				} else if (typeof a === "object" && typeof b === "undefined") {
					return createAndInsertElement(namespace, tagName as any, a, null);
				} else if (typeof b === "undefined") {
					return createAndInsertElement(namespace, tagName as any, null, a);
				} else if (typeof a === "object") {
					return createAndInsertElement(namespace, tagName as any, a, b);
				} else {
					throw new Error("Unexpected state");
				}
			}
			return boundCreate;
		}
	});
}

let idCounter = 0
const DyneinDOM = {
	elements: makeCreateElementsProxy("xhtml") as CreationProxy<"xhtml">,
	svgElements: makeCreateElementsProxy("svg") as CreationProxy<"svg">,
	node<T extends Node>(node: T): T {
		return insertNode(node);
	},
	id(): string {
		return "__d"+(idCounter++)
	},
	html(html: string): void {
		if (typeof html !== "string" && typeof html !== "number") {
			throw new Error("HTML must be a string or number");
		}
		const tmp = document.createElement("template");
		tmp.innerHTML = html;
		const frag = tmp.content;
		insertNode(frag);
	},
	text(val: Primitive | (() => Primitive)): Node {
		const node = document.createTextNode("");
		runInNodeContext(null, null, () => {
			if (typeof val === "function") {
				DyneinState.watch(() => {
					node.textContent = stringifyForInner(val());
				});
			} else {
				node.textContent = stringifyForInner(val);
			}
		});
		return insertNode(node);
	},
	mount(el: Element, inner: () => void) {
		const startNode = document.createComment("<portal>")
		const endNode = document.createComment("</portal>")
		el.appendChild(startNode);
		el.appendChild(endNode);
		DyneinState.cleanup(() => {
			let range = document.createRange();
			range.setStartBefore(startNode);
			range.setEndAfter(endNode);
			range.deleteContents();
		});

		DyneinState.expectStatic(()=>{
			runInNodeContext(el, endNode, inner);
		})
	},
	mountBody(inner: () => void) {
		if (document.body) {
			DyneinDOM.mount(document.body, inner);
		} else {
			window.addEventListener("load", () => {
				DyneinDOM.mount(document.body, inner);
			});
		}
	},
	async(
		setupReplacements: (
			replaceInner: (inner: () => void) => void,
			dependent: (inner: () => void) => void
		) => void
	) {
		replacementVRange(
			insertNode(document.createComment("<async>")),
			insertNode(document.createComment("</async>")),
			($r) => {
				const saved = DyneinState.getContext()
				setupReplacements($r, (inner)=>{
					DyneinState.setContext(saved, inner)
				});
			}
		);
	},
	replacer(inner: () => void) {
		replacementVRange(
			insertNode(document.createComment("<replacer>")),
			insertNode(document.createComment("</replacer>")),
			($r) => {
				DyneinState.watch(() => {
					$r(() => {
						DyneinState.unignore(inner);
					});
				});
			}
		);
	},
	if(ifCond: () => any, inner: () => void) {
		const conds: (() => boolean)[] = [];
		const inners: (() => void)[] = []
		const nConds = DyneinState.value(conds.length);
		function addStage(cond: () => boolean, inner: () => void) {
			conds.push(cond);
			inners.push(inner)
			nConds(conds.length)
		}

		const ifStageMaker = {
			elseif(cond: () => any, inner: () => void) {
				addStage(cond, inner);
				return ifStageMaker;
			},
			else(inner: () => void): void {
				addStage(() => true, inner);
			}
		};

		addStage(ifCond, inner);

		const currentInner = DyneinState.value(()=>{})

		DyneinState.watch(()=>{
			for (let i = 0; i < nConds(); i++) {
				if (conds[i]()) {
					currentInner(inners[i])
					return;
				}
			}
			currentInner(()=>{})
		});

		const saved = DyneinState.getContext()
		DyneinDOM.replacer(() => {
			const inner = currentInner()
			DyneinState.setContext(saved, ()=>{
				DyneinState.expectStatic(()=>{
					inner()
				})
			})
		})

		return ifStageMaker;
	},
	customProperty(prop: string, handler: (el: SVGElement | HTMLElement, val: Primitive) => void) {
		if (customPropertyHandlers.has(prop)) {
			throw new Error("Custom handler already defined for property ." + prop);
		}
		customPropertyHandlers.set(prop, handler);
	},
	runInNodeContext: runInNodeContext
};

export default DyneinDOM;
