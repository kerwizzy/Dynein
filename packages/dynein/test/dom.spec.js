import { default as D } from "dynein"

function mount(inner) {
	let test
	D.state.root(()=>{
		D.dom.mount(document.createElement("div"), ()=>{
			test = D.dom.elements.div(inner)
		})
	})
	return {body: test}
}

describe("D.dom", ()=>{
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

	beforeEach(function() {
		sinon.spy(console, 'warn');
		sinon.spy(console, 'error');
	});

	describe("D.dom.elements", ()=>{
		describe("D.dom.elements (simple creation)", ()=>{
			it("creates an element", ()=>{
				const document = mount(()=>{
					D.dom.elements.div()
				})
				assert.strictEqual(document.body.innerHTML, "<div></div>")
			})

			it("creates nested elements", ()=>{
				const document = mount(()=>{
					D.dom.elements.div(()=>{
						D.dom.elements.span()
					})
				})
				assert.strictEqual(document.body.innerHTML, "<div><span></span></div>")
			})

			it("returns the created element", ()=>{
				const document = mount(()=>{
					const el = D.dom.elements.div()
					assert.ok(el instanceof window.Element)
				})
			})

			it("throws when out of context", ()=>{
				assert.throws(()=>{
					D.dom.elements.div()
				})
			})

			it("sets attrs", ()=>{
				const document = mount(()=>{
					D.dom.elements.a({href:"a"})
				})
				assert.strictEqual(document.body.innerHTML, `<a href="a"></a>`)
			})

			it("sets class", ()=>{
				const document = mount(()=>{
					D.dom.elements.div({class:"a"})
				})
				assert.strictEqual(document.body.innerHTML, `<div class="a"></div>`)
			})

			it("sets style", ()=>{
				const document = mount(()=>{
					D.dom.elements.div({style:"color: red"})
				})
				assert.strictEqual(document.body.innerHTML, `<div style="color: red;"></div>`)
			})

			it("supports string inner", ()=>{
				const document = mount(()=>{
					D.dom.elements.div("test")
				})
				assert.strictEqual(document.body.innerHTML, `<div>test</div>`)
			})

			it("escapes string inner", ()=>{
				const document = mount(()=>{
					D.dom.elements.div("<b>test</b>")
				})
				assert.strictEqual(document.body.innerHTML, `<div>&lt;b&gt;test&lt;/b&gt;</div>`)
			})

			it("escapes attr value", ()=>{
				const document = mount(()=>{
					D.dom.elements.a({href:`">escaped?!`})
				})
				assert.strictEqual(document.body.innerHTML, `<a href="&quot;>escaped?!"></a>`)
			})

			it("supports attrs and inner", ()=>{
				const document = mount(()=>{
					D.dom.elements.a({href:"a"}, ()=>{
						D.dom.elements.span({style:"color:red"}, "test")
					})
				})
				assert.strictEqual(document.body.innerHTML, `<a href="a"><span style="color: red;">test</span></a>`)
			})

			it("passes errors", ()=>{
				const document = mount(()=>{
					assert.throws(()=>{
						D.dom.elements.div(()=>{
							throw new Error("Err")
						})
					})
				})
			})

			it("restores state after errors", ()=>{
				const document = mount(()=>{
					try {
						D.dom.elements.div(()=>{
							throw new Error("test err")
						})
					} catch (err) {

					}
					D.dom.elements.span()
				})
				assert.strictEqual(document.body.innerHTML, `<span></span>`)
			})
		})

		describe("D.dom.elements (listeners)", ()=>{
			it("adds listeners", ()=>{
				let count = 0
				let el
				const document = mount(()=>{
					el = D.dom.elements.button({onclick:()=>{
						count++
					}})
				})

				el.dispatchEvent(new window.Event("click"))
				assert.strictEqual(count, 1)
			})

			it("ignores listener casing", ()=>{
				let count = 0
				let el
				const document = mount(()=>{
					el = D.dom.elements.button({onCLiCk:()=>{
						count++
					}})
				})

				el.dispatchEvent(new window.Event("click"))
				assert.strictEqual(count, 1)
			})

			it("passes `this` properly", ()=>{
				let el
				const document = mount(()=>{
					el = D.dom.elements.button({onclick: function() {
						assert.ok(this instanceof window.Element)
					}})
				})

				el.dispatchEvent(new window.Event("click"))
			})

			it("allows null listener", ()=>{
				const document = mount(()=>{
					assert.doesNotThrow(()=>{
						D.dom.elements.button({onclick: null})
					})
				})
			})

			it("destroys watchers inside listeners on listener reexecute", ()=>{
				let signal = D.state.value(0)
				let el
				let count = 0
				const document = mount(()=>{
					el = D.dom.elements.button({onclick: function() {
						D.state.watch(()=>{
							signal()
							count++
						})
					}})
				})

				assert.strictEqual(count, 0)
				el.dispatchEvent(new window.Event("click"))
				assert.strictEqual(count, 1)
				el.dispatchEvent(new window.Event("click"))
				assert.strictEqual(count, 2)
				signal(2)
				assert.strictEqual(count, 3)
			})
		})

		describe("D.dom.elements (bindings)", ()=>{
			it("inits from a read-only binding", ()=>{
				const document = mount(()=>{
					D.dom.elements.a({href:()=>"test"})
				})
				assert.strictEqual(document.body.innerHTML, `<a href="test"></a>`)
			})

			it("watches dependencies", ()=>{
				const signal = D.state.value(0)
				const document = mount(()=>{
					D.dom.elements.a({name:()=>signal()})
				})
				assert.strictEqual(document.body.innerHTML, `<a name="0"></a>`)
				signal(1)
				assert.strictEqual(document.body.innerHTML, `<a name="1"></a>`)
			})

			it("warns when passing a signal to a non-evented attr", ()=>{
				const signal = D.state.value(0)
				const document = mount(()=>{
					D.dom.elements.div({myattr:signal})
				})
				assert.ok( console.warn.calledWithMatch("No update event") )
			})

			it("updates the signal for evented attrs", ()=>{
				const signal = D.state.value("txt")
				let el
				const document = mount(()=>{
					el = D.dom.elements.input({value:signal})
				})
				assert.strictEqual(el.value, "txt")
				el.value = "test"
				el.dispatchEvent(new window.Event("input"))
				assert.strictEqual(signal(), "test")
			})
		})
	})

	describe("D.dom.text", ()=>{
		it("creates text", ()=>{
			const document = mount(()=>{
				D.dom.text("test")
			})
			assert.strictEqual(document.body.innerHTML, `test`)
		})

		it("allows numbers", ()=>{
			const document = mount(()=>{
				D.dom.text(123)
			})
			assert.strictEqual(document.body.innerHTML, `123`)
		})

		it("escapes html", ()=>{
			const document = mount(()=>{
				D.dom.text("<b>test</b>")
			})
			assert.strictEqual(document.body.innerHTML, `&lt;b&gt;test&lt;/b&gt;`)
		})

		it("allows functions", ()=>{
			const document = mount(()=>{
				D.dom.text(()=>"test")
			})
			assert.strictEqual(document.body.innerHTML, `test`)
		})

		it("updates on deps change", ()=>{
			let signal = D.state.value("test")
			const document = mount(()=>{
				D.dom.text(()=>signal())
			})
			assert.strictEqual(document.body.innerHTML, `test`)
			signal("1234")
			assert.strictEqual(document.body.innerHTML, `1234`)
		})

		it("passes errors", ()=>{
			const document = mount(()=>{
				assert.throws(()=>{
					D.dom.text(()=>{
						throw new Error("err")
					})
				})
			})
		})

		it("throws on dom inside", ()=>{
			const document = mount(()=>{
				assert.throws(()=>{
					D.dom.text(()=>{
						D.dom.elements.div();
					})
				})
			})
		})
	})

	describe("D.dom.html", ()=>{
		it("creates text", ()=>{
			const document = mount(()=>{
				D.dom.html("test")
			})
			assert.strictEqual(document.body.innerHTML, `test`)
		})

		it("does not escape html", ()=>{
			const document = mount(()=>{
				D.dom.html(`<b myattr="test">test</b>`)
			})
			assert.strictEqual(document.body.innerHTML, `<b myattr="test">test</b>`)
		})

		it("does not allow functions", ()=>{
			const document = mount(()=>{
				assert.throws(()=>{
					D.dom.html(()=>"test")
				})
			})
		})
	})

	describe("D.dom.node", ()=>{
		it("inserts a node into the DOM", ()=>{
			const node = document.createElement("div")
			node.textContent = "test"
			node.setAttribute("myattr", "test")
			const doc = mount(()=>{
				D.dom.node(node)
			})
			assert.strictEqual(doc.body.innerHTML, `<div myattr="test">test</div>`)
		})
	})

	describe("D.dom.if", ()=>{
		it("creates when truthy", ()=>{
			const document = mount(()=>{
				D.dom.if(()=>1, ()=>{
					D.dom.elements.div()
				})
			})
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div></div>`)
		})

		it("does not create when falsy", ()=>{
			const document = mount(()=>{
				D.dom.if(()=>0, ()=>{
					D.dom.elements.div()
				})
			})
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), ``)
		})

		it("cascades properly (1)", ()=>{
			const document = mount(()=>{
				D.dom.if(()=>1, ()=>{
					D.dom.elements.div()
				}).elseif(()=>1, ()=>{
					D.dom.elements.span()
				}).else(()=>{
					D.dom.elements.a()
				})
			})
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div></div>`)
		})

		it("cascades properly (2)", ()=>{
			const document = mount(()=>{
				D.dom.if(()=>0, ()=>{
					D.dom.elements.div()
				}).elseif(()=>1, ()=>{
					D.dom.elements.span()
				}).else(()=>{
					D.dom.elements.a()
				})
			})
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<span></span>`)
		})

		it("cascades properly (3)", ()=>{
			const document = mount(()=>{
				D.dom.if(()=>0, ()=>{
					D.dom.elements.div()
				}).elseif(()=>0, ()=>{
					D.dom.elements.span()
				}).else(()=>{
					D.dom.elements.a()
				})
			})
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<a></a>`)
		})

		it("renders nothing when all are false", ()=>{
			const document = mount(()=>{
				D.dom.if(()=>0, ()=>{
					D.dom.elements.div()
				}).elseif(()=>0, ()=>{
					D.dom.elements.span()
				})
			})
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), ``)
		})

		it("renders nothing when all are changed to be false", ()=>{
			const a = D.state.value(0)
			const b = D.state.value(0)
			const document = mount(()=>{
				D.dom.if(()=>a(), ()=>{
					D.dom.elements.div()
				}).elseif(()=>b(), ()=>{
					D.dom.elements.span()
				})
			})
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), ``)
			b(1)
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<span></span>`)
			a(1)
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div></div>`)
			b(0)
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div></div>`)
			a(0)
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), ``)
		})

		it("passes errors", ()=>{
			const document = mount(()=>{
				assert.throws(()=>{
					D.dom.if(()=>1, ()=>{
						throw new Error("err")
					})
				})
			})
		})

		it("rerenders on state change", ()=>{
			const signal = D.state.value(1)
			const document = mount(()=>{
				D.dom.if(()=>signal(), ()=>{
					D.dom.elements.div()
				}).else(()=>{
					D.dom.elements.span()
				})
			})
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div></div>`)
			signal(0)
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<span></span>`)
		})

		it("does not track inner dependencies", ()=>{
			const signal = D.state.value(1)
			const document = mount(()=>{
				D.dom.if(()=>1, ()=>{
					if (signal()) {
						D.dom.elements.div()
					}
				})
			})
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div></div>`)
			assert.ok( console.error.calledWithMatch("add a dependency but didn't") )
			signal(0)
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div></div>`) //shouldn't have changed
		})

		it("does not rerender inner when reaching the same condition", ()=>{
			const signal = D.state.value(1)
			let count = 0
			const document = mount(()=>{
				D.dom.if(signal, ()=>{
					count++
					D.dom.elements.div()
				}).else(()=>{
					D.dom.elements.span()
				})
			})
			assert.strictEqual(count, 1)
			signal(true)
			assert.strictEqual(count, 1)
		})

		it("does not keep-alive inner", ()=>{
			const signal = D.state.value(1)
			let count = 0
			const document = mount(()=>{
				D.dom.if(signal, ()=>{
					count++
					D.dom.elements.div()
				}).else(()=>{
					D.dom.elements.span()
				})
			})
			assert.strictEqual(count, 1)
			signal(false)
			signal(true)
			assert.strictEqual(count, 2)
		})
	})

	describe("D.dom.replacer", ()=>{
		it("creates", ()=>{
			const document = mount(()=>{
				D.dom.replacer(()=>{
					D.dom.elements.div()
				})
			})
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div></div>`)
		})

		it("rerenders on state change", ()=>{
			const signal = D.state.value(1)
			const document = mount(()=>{
				D.dom.replacer(()=>{
					if (signal()) {
						D.dom.elements.div()
					} else {
						D.dom.elements.span()
					}
				})
			})
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div></div>`)
			signal(0)
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<span></span>`)
		})

		it("passes errors", ()=>{
			const document = mount(()=>{
				assert.throws(()=>{
					D.dom.replacer(()=>{
						throw new Error("err")
					})
				})
			})
		})
	})
})

