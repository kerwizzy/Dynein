import hyperfor from "@dynein/hyperfor"
import * as D from "dynein"
import { WatchedArray } from "@dynein/watched-builtins"
import { assert } from "chai"

function mount(inner) {
	D.createRoot(()=>{
		D.addPortal(document.body, inner)
	})
}


function sleep() {
	return new Promise((resolve)=>{
		setTimeout(()=>{
			resolve()
		}, 10)
	})
}

describe("hyperfor", ()=>{
	if (typeof process !== "undefined") {
		global.requestAnimationFrame = (fn)=>{
			setImmediate(fn, 0)
			//fn()
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

	it("create elements", async ()=>{
		const arr = new WatchedArray([1,2,3])
		mount(()=>{
			hyperfor(arr, (item) => {
				D.addText(item)
			})
		})
		await sleep()
		assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "123")
	})

	it("splices elements in the middle", async ()=>{
		const arr = new WatchedArray([1,2,3,4])
		mount(()=>{
			hyperfor(arr, (item) => {
				D.addText(item)
			})
			arr.splice(1,2,"a","b")
		})
		await sleep()
		assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "1ab4")
	})

	it("handles .startItem changing", async ()=>{
		const arr = new WatchedArray([1,2,3,4])
		mount(()=>{
			hyperfor(arr, (item) => {
				D.addText(item)
			})
			arr.splice(0,1)
			arr.splice(2,1)
		})
		await sleep()
		assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "23")
	})

	it("reuses nodes", async ()=>{
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
		await sleep()
		assert.strictEqual(twoNode1, twoNode2)
	})

	it("does not reuse nodes when the entire array is replaced", async ()=>{
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
		await sleep()
		assert.strictEqual(twoNode1 === twoNode2, false, "twoNode1 === twoNode2")
	})


	it("handles multiple splices inside a batch", async ()=>{
		const arr = new WatchedArray([1,2,3,4])
		mount(()=>{
			hyperfor(arr, (item) => {
				D.addText(item)
			})
			D.batch(()=>{
				arr.splice(0,1) //234
				arr.splice(2,1) //23
				arr.push("a") //23a
				arr.push("w") //23aw
				arr.pop() //23a
				arr.unshift("b") //b23a
				arr.push("c") //b23ac
				arr.splice(2, 0, "x", "y") //b2xy3ac
				arr.splice(7, 10, "e", "f") //b2xy3acef
			})
		})
		await sleep()
		assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "b2xy3acef")
	})

	it("handles complete array replacent splices inside a batch", async ()=>{
		const arr = new WatchedArray([1,2,3,4])
		mount(()=>{
			hyperfor(arr, (item) => {
				D.addText(item)
			})
			D.batch(()=>{
				arr.splice(0,1) //234
				arr.splice(2,1) //23
				arr.value([]) //
				arr.push("a") //a
				arr.unshift("b") //ba
				arr.push("c") //bac
				arr.splice(1, 0, "x", "y") //bxyac
				arr.splice(2, 2, "e", "f") //bxefc
			})
		})
		await sleep()
		assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "bxefc")
	})

	it("handles complete array replacent splices at the end of a batch", async ()=>{
		const arr = new WatchedArray([1,2,3,4])
		mount(()=>{
			hyperfor(arr, (item) => {
				D.addText(item)
			})
			D.batch(()=>{
				arr.splice(0,1) //234
				arr.splice(2,1) //23
				arr.value([]) //
			})
		})
		await sleep()
		assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "")
	})

	it("renders indexes correctly (1)", async ()=>{
		const arr = new WatchedArray(["a", "b", "c", "d"])
		mount(()=>{
			hyperfor(arr, (item, index) => {
				D.addText(()=>item+index()+" ")
			})
		})
		await sleep()
		assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "a0 b1 c2 d3 ")
	})
	it("renders indexes correctly (2)", async ()=>{
		const arr = new WatchedArray(["a", "b", "c", "d"])
		mount(()=>{
			hyperfor(arr, (item, index) => {
				D.addText(()=>item+index()+" ")
			})
			D.batch(()=>{
				arr.shift()
				arr.push("e")
			})
		})
		await sleep()
		assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "b0 c1 d2 e3 ")
	})

	it("handles errors in render (1)", async ()=>{
		const arr = new WatchedArray(["a", "b"])
		mount(()=>{
			hyperfor(arr, (item, index) => {
				if (item === "b") {
					throw new Error("Found a B!")
				}
				D.addText(()=>item+index()+" ")
			})
		})
		await sleep()
		assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "a0 ")
	})

	it("handles errors in render (2)", async ()=>{
		const arr = new WatchedArray(["a", "b"])
		mount(()=>{
			hyperfor(arr, (item, index) => {
				if (item === "c") {
					throw new Error("Found a C!")
				}
				D.addText(()=>item+index()+" ")
			})

			D.batch(()=>{
				arr.push("c")
			})
		})
		await sleep()
		assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "a0 b1 ")
	})
})
