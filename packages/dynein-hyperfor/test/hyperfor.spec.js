import Hyperfor from "@dynein/hyperfor"
import { default as D } from "dynein"

function mount(inner) {
	const test = document.createElement("div")
	D.dom.mountAt(test, inner)
	return {body: test}
}

describe("hyperfor", ()=>{
	if (typeof process !== "undefined") {
		beforeEach(()=>{
			const dom = new JSDOM(`<body></body>`)
			global.window = dom.window
			global.document = dom.window.document
		})

		it("creates an element", ()=>{
			const document = mount(()=>{
				D.dom.elements.div()
			})
			assert.strictEqual(document.body.innerHTML, "<div></div>")
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
		const document = mount(()=>{
			new Hyperfor([1,2,3], (item) => {
				D.dom.text(item)
			})
		})
		assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "123")
	})

	it("splices elements in the middle", ()=>{
		const document = mount(()=>{
			const h4 = new Hyperfor([1,2,3,4], (item) => {
				D.dom.text(item)
			})
			h4.splice(1,2,"a","b")
			h4.patch()
		})
		assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "1ab4")
	})
})
