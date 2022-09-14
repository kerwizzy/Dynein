import hyperfor from "@dynein/hyperfor"
import * as D from "dynein"
import { WatchedArray } from "@dynein/watched-builtins"
import { assert } from "chai"

function mount(inner) {
	D.createRoot(()=>{
		D.addPortal(document.body, inner)
	})
}

describe("hyperfor", ()=>{
	if (typeof process !== "undefined") {
		global.requestAnimationFrame = (fn)=>{
			fn()
		}
		beforeEach(()=>{
			const dom = new JSDOM(`<body></body>`)
			global.window = dom.window
			global.document = dom.window.document
		})

		it("creates an element", ()=>{
			mount(()=>{
				D.elements.div()
			})
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "<div></div>")
		})
		it("doesn't do anything with no calls", ()=>{
			// This test is here to check that beforeEach resets stuff properly
			assert.strictEqual(document.body.innerHTML, "")
		})
	}

	beforeEach(function() {
		if (null == sinon) {
			sinon = sinon.sandbox.create();
		} else {
			sinon.restore();
		}
	});

	it("create elements", ()=>{
		const arr = new WatchedArray([1,2,3])
		mount(()=>{
			hyperfor(arr, (item) => {
				D.addText(item)
			})
		})
		assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "123")
	})

	it("splices elements in the middle", ()=>{
		const arr = new WatchedArray([1,2,3,4])
		mount(()=>{
			hyperfor(arr, (item) => {
				D.addText(item)
			})
			arr.splice(1,2,"a","b")
		})
		assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "1ab4")
	})

	it("handles .startItem changing", ()=>{
		const arr = new WatchedArray([1,2,3,4])
		mount(()=>{
			hyperfor(arr, (item) => {
				D.addText(item)
			})
			arr.splice(0,1)
			arr.splice(2,1)
		})
		assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "23")
	})

	it("reuses nodes", ()=>{
		const arr = new WatchedArray([1,2,3,4])
		let twoNode1
		let twoNode2
		mount(()=>{
			hyperfor(arr, (item) => {
				D.addText(item)
			})
			twoNode1 = Array.from(document.body.childNodes).find(n => n.textContent === "2")
			arr.shift()
			twoNode2 = Array.from(document.body.childNodes).find(n => n.textContent === "2")
		})
		assert.strictEqual(twoNode1, twoNode2)
	})

	it("does not reuse nodes when the entire array is replaced", ()=>{
		const arr = new WatchedArray([1,2,3,4])
		let twoNode1
		let twoNode2
		mount(()=>{
			hyperfor(arr, (item) => {
				D.addText(item)
			})
			const nodes = Array.from(document.body.childNodes)
			twoNode1 = nodes.find(n => n.textContent === "2")
			arr.value([1,2,3,4])
			twoNode2 = Array.from(document.body.childNodes).find(n => n.textContent === "2")
		})
		assert.strictEqual(twoNode1 === twoNode2, false, "twoNode1 === twoNode2")
	})

	it("handles multiple splices inside a batch", ()=>{
		const arr = new WatchedArray([1,2,3,4])
		mount(()=>{
			hyperfor(arr, (item) => {
				D.addText(item)
			})
			D.batch(()=>{
				arr.splice(0,1) //234
				arr.splice(2,1) //23
				arr.push("a") //23a
				arr.unshift("b") //b23a
				arr.push("c") //b23ac
				arr.splice(2, 0, "x", "y") //b2xy3ac
				arr.splice(7, 10, "e", "f") //b2xy3acef
			})
		})
		assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "b2xy3acef")
	})

})
