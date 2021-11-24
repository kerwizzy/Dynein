import D from "dynein"
import Color from "./Color.js"
import Gradient from "./Gradient.js"

let idCounter = 0
function id() {
	return idCounter++
}

class KromaSymbol {
	temporary: boolean
	id: number

	constructor() {
		this.temporary = true
		this.id = id()
	}

	toString() {
		if (this.temporary) {
			throw new Error("Temporary KromaSymbol stringified")
		} else {
			return "__K"+this.id
		}
	}
}

function K() {
	return new KromaSymbol()
}

interface KromaCSSRecord {
	refs: number,
	el: HTMLStyleElement
	symbolIDs: number[]
}

const addedCSS = new Map<string, KromaCSSRecord>() // key is flattened CSS with temp symbols



function css(strs: TemplateStringsArray, ...values: any): void {
	let tmpCounter = 0

	function getFlattened(useTmp: boolean) {
		const temporarySymbols = new Map<KromaSymbol, number>()
		let flattened = ""

		for (let i = 0; i<strs.length; i++) {
			flattened += strs[i]
			if (i < values.length) {
				const val = values[i]
				if (val instanceof KromaSymbol) {
					if (val.temporary) {
						if (!useTmp) {
							throw new Error("Tmp in !useTmp")
						}
						if (!temporarySymbols.has(val)) {
							temporarySymbols.set(val, tmpCounter++)
						}
						flattened += ".__Kt"+temporarySymbols.get(val)
					} else {
						flattened += "."+val
					}
				} else {
					flattened += val
				}
			}
		}

		return { flattened, temporarySymbols }
	}
	const { flattened, temporarySymbols } = getFlattened(true)

	let rec: KromaCSSRecord
	if (addedCSS.has(flattened)) {
		rec = addedCSS.get(flattened)!

		const symbols = Array.from(temporarySymbols.keys())
		if (symbols.length !== rec.symbolIDs.length) {
			throw new Error("Unexpected state")
		}
		for (let i = 0; i<symbols.length; i++) {
			const symbol = symbols[i]
			symbol.temporary = false
			symbol.id = rec.symbolIDs[i]
		}
		rec.refs++
	} else {
		let ids: number[] = []
		for (let symbol of temporarySymbols.keys()) {
			symbol.temporary = false
			ids.push(symbol.id)
		}

		const el = document.createElement("style")

		const ruleText = getFlattened(false).flattened

		el.textContent = ruleText
		rec = {
			refs: 1,
			el,
			symbolIDs: ids
		}
		addedCSS.set(flattened, rec)

		console.log("adding ",ruleText)
		document.head.appendChild(el)
	}
	D.state.cleanup(()=>{
		rec.refs--
		if (rec.refs === 0) {
			console.log("can remove",rec)
			//TODO: remove
		}
	})
}

export { K, css, Color, Gradient }
