import { K, css, Color } from "@dynein/kroma"
import { default as D } from "dynein"

function mount(inner) {
	const test = document.createElement("div")
	D.dom.mountAt(test, inner)
	return {body: test}
}

describe("Color", ()=>{
	beforeEach(function() {
		if (null == sinon) {
			sinon = sinon.sandbox.create();
		} else {
			sinon.restore();
		}
	});

	it("creates a color", ()=>{
		const test = new Color("#ff0000")
		assert.strictEqual(test.toString(), "rgba(255,0,0,1)")
	})

})
