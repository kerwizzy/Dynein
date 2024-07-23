import { createRoot, createSignal, toSignal, createEffect, batch, $s, Owner, runWithOwner, onCleanup, onUpdate } from "@dynein/state"
import { addPortal, elements, addIf, addAsyncReplaceable, addAsync, addDynamic, addNode, addHTML, addText } from "@dynein/dom"

function mount(inner) {
	let test
	createRoot(() => {
		addPortal(document.createElement("div"), null, () => {
			test = elements.div(inner)
		})
	})
	return { body: test }
}

process.on('unhandledRejection', (reason) => {
	console.log("unhandled rejection", reason)
	throw reason
})

function sleep(ms = 1) {
	return new Promise((resolve) => {
		setTimeout(() => {
			resolve()
		}, ms)
	})
}

describe("@dynein/dom", () => {
	if (typeof process !== "undefined") {
		beforeEach(() => {
			const dom = new JSDOM(`<body></body>`)
			global.window = dom.window
			global.document = dom.window.document
		})

		it("creates an element", () => {
			const document = mount(() => {
				elements.div()
			})
			assert.strictEqual(document.body.innerHTML, "<div></div>")
		})
		it("doesn't do anything with no calls", () => {
			// This test is here to check that beforeEach resets stuff properly
			assert.strictEqual(document.body.innerHTML, "")
		})
	}

	beforeEach(function () {
		if (null == sinon) {
			sinon = sinon.sandbox.create()
		} else {
			sinon.restore()
		}
	})

	beforeEach(function () {
		sinon.spy(console, 'warn')
		sinon.spy(console, 'error')
	})

	describe("elements", () => {
		describe("elements (simple creation)", () => {
			it("creates an element", () => {
				const document = mount(() => {
					elements.div()
				})
				assert.strictEqual(document.body.innerHTML, "<div></div>")
			})

			it("creates nested elements", () => {
				const document = mount(() => {
					elements.div(() => {
						elements.span()
					})
				})
				assert.strictEqual(document.body.innerHTML, "<div><span></span></div>")
			})

			it("returns the created element", () => {
				const document = mount(() => {
					const el = elements.div()
					assert.ok(el instanceof window.Element)
				})
			})

			it("throws when out of context", () => {
				assert.throws(() => {
					elements.div()
				})
			})

			it("sets attrs", () => {
				const document = mount(() => {
					elements.a({ href: "a" })
				})
				assert.strictEqual(document.body.innerHTML, `<a href="a"></a>`)
			})

			it("sets class", () => {
				const document = mount(() => {
					elements.div({ class: "a" })
				})
				assert.strictEqual(document.body.innerHTML, `<div class="a"></div>`)
			})

			it("sets style", () => {
				const document = mount(() => {
					elements.div({ style: "color: red" })
				})
				assert.strictEqual(document.body.innerHTML, `<div style="color: red;"></div>`)
			})

			it("supports string inner", () => {
				const document = mount(() => {
					elements.div("test")
				})
				assert.strictEqual(document.body.innerHTML, `<div>test</div>`)
			})

			it("escapes string inner", () => {
				const document = mount(() => {
					elements.div("<b>test</b>")
				})
				assert.strictEqual(document.body.innerHTML, `<div>&lt;b&gt;test&lt;/b&gt;</div>`)
			})

			it("escapes attr value", () => {
				const document = mount(() => {
					elements.a({ href: `">escaped?!` })
				})
				assert.strictEqual(document.body.innerHTML, `<a href="&quot;>escaped?!"></a>`)
			})

			it("supports attrs and inner", () => {
				const document = mount(() => {
					elements.a({ href: "a" }, () => {
						elements.span({ style: "color:red" }, "test")
					})
				})
				assert.strictEqual(document.body.innerHTML, `<a href="a"><span style="color: red;">test</span></a>`)
			})

			it("passes errors", () => {
				const document = mount(() => {
					assert.throws(() => {
						elements.div(() => {
							throw new Error("Err")
						})
					})
				})
			})

			it("restores state after errors", () => {
				const document = mount(() => {
					try {
						elements.div(() => {
							throw new Error("test err")
						})
					} catch (err) {

					}
					elements.span()
				})
				assert.strictEqual(document.body.innerHTML, `<span></span>`)
			})
		})

		describe("elements (listeners)", () => {
			it("adds listeners", () => {
				let count = 0
				let el
				const document = mount(() => {
					el = elements.button({
						onclick: () => {
							count++
						}
					})
				})

				el.dispatchEvent(new window.Event("click"))
				assert.strictEqual(count, 1)
			})

			it("ignores listener casing", () => {
				let count = 0
				let el
				const document = mount(() => {
					el = elements.button({
						onCLiCk: () => {
							count++
						}
					})
				})

				el.dispatchEvent(new window.Event("click"))
				assert.strictEqual(count, 1)
			})

			it("passes `this` properly", () => {
				let el
				const document = mount(() => {
					el = elements.button({
						onclick: function () {
							assert.ok(this instanceof window.Element)
						}
					})
				})

				el.dispatchEvent(new window.Event("click"))
			})

			it("allows null listener", () => {
				const document = mount(() => {
					assert.doesNotThrow(() => {
						elements.button({ onclick: null })
					})
				})
			})

			it("destroys watchers inside listeners on listener reexecute", () => {
				let signal = createSignal(0)
				let el
				let count = 0
				const document = mount(() => {
					el = elements.button({
						onclick: function () {
							createEffect(() => {
								signal()
								count++
							})
						}
					})
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

		describe("elements (bindings)", () => {
			it("inits from a read-only binding", () => {
				const document = mount(() => {
					elements.a({ href: () => "test" })
				})
				assert.strictEqual(document.body.innerHTML, `<a href="test"></a>`)
			})

			it("watches dependencies", () => {
				const signal = createSignal(0)
				const document = mount(() => {
					elements.a({ name: () => signal() })
				})
				assert.strictEqual(document.body.innerHTML, `<a name="0"></a>`)
				signal(1)
				assert.strictEqual(document.body.innerHTML, `<a name="1"></a>`)
			})

			it("warns when passing a signal to a non-evented attr", () => {
				const signal = createSignal(0)
				const document = mount(() => {
					elements.div({ myattr: signal })
				})
				assert.ok(console.warn.calledWithMatch("No update event"))
			})

			it("updates the signal for evented attrs", () => {
				const signal = createSignal("txt")
				let el
				const document = mount(() => {
					el = elements.input({ value: signal })
				})
				assert.strictEqual(el.value, "txt")
				el.value = "test"
				el.dispatchEvent(new window.Event("input"))
				assert.strictEqual(signal(), "test")
			})
		})
	})

	describe("addText", () => {
		it("creates text", () => {
			const document = mount(() => {
				addText("test")
			})
			assert.strictEqual(document.body.innerHTML, `test`)
		})

		it("allows numbers", () => {
			const document = mount(() => {
				addText(123)
			})
			assert.strictEqual(document.body.innerHTML, `123`)
		})

		it("escapes html", () => {
			const document = mount(() => {
				addText("<b>test</b>")
			})
			assert.strictEqual(document.body.innerHTML, `&lt;b&gt;test&lt;/b&gt;`)
		})

		it("allows functions", () => {
			const document = mount(() => {
				addText(() => "test")
			})
			assert.strictEqual(document.body.innerHTML, `test`)
		})

		it("updates on deps change", () => {
			let signal = createSignal("test")
			const document = mount(() => {
				addText(() => signal())
			})
			assert.strictEqual(document.body.innerHTML, `test`)
			signal("1234")
			assert.strictEqual(document.body.innerHTML, `1234`)
		})

		it("passes errors", () => {
			const document = mount(() => {
				assert.throws(() => {
					addText(() => {
						throw new Error("err")
					})
				})
			})
		})

		it("throws on dom inside", () => {
			const document = mount(() => {
				assert.throws(() => {
					addText(() => {
						elements.div()
					})
				})
			})
		})
	})

	describe("addHTML", () => {
		it("creates text", () => {
			const document = mount(() => {
				addHTML("test")
			})
			assert.strictEqual(document.body.innerHTML, `test`)
		})

		it("does not escape html", () => {
			const document = mount(() => {
				addHTML(`<b myattr="test">test</b>`)
			})
			assert.strictEqual(document.body.innerHTML, `<b myattr="test">test</b>`)
		})

		it("does not allow functions", () => {
			const document = mount(() => {
				assert.throws(() => {
					addHTML(() => "test")
				})
			})
		})
	})

	describe("addNode", () => {
		it("inserts a node into the DOM", () => {
			const node = document.createElement("div")
			node.textContent = "test"
			node.setAttribute("myattr", "test")
			const doc = mount(() => {
				addNode(node)
			})
			assert.strictEqual(doc.body.innerHTML, `<div myattr="test">test</div>`)
		})
	})

	describe("addIf", () => {
		it("creates when truthy", () => {
			const document = mount(() => {
				addIf(() => 1, () => {
					elements.div()
				})
			})
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div></div>`)
		})

		it("does not create when falsy", () => {
			const document = mount(() => {
				addIf(() => 0, () => {
					elements.div()
				})
			})
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), ``)
		})

		it("cascades properly (1)", () => {
			const document = mount(() => {
				addIf(() => 1, () => {
					elements.div()
				}).elseif(() => 1, () => {
					elements.span()
				}).else(() => {
					elements.a()
				})
			})
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div></div>`)
		})

		it("cascades properly (2)", () => {
			const document = mount(() => {
				addIf(() => 0, () => {
					elements.div()
				}).elseif(() => 1, () => {
					elements.span()
				}).else(() => {
					elements.a()
				})
			})
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<span></span>`)
		})

		it("cascades properly (3)", () => {
			const document = mount(() => {
				addIf(() => 0, () => {
					elements.div()
				}).elseif(() => 0, () => {
					elements.span()
				}).else(() => {
					elements.a()
				})
			})
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<a></a>`)
		})

		it("renders nothing when all are false", () => {
			const document = mount(() => {
				addIf(() => 0, () => {
					elements.div()
				}).elseif(() => 0, () => {
					elements.span()
				})
			})
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), ``)
		})

		it("renders nothing when all are changed to be false", () => {
			const a = createSignal(0)
			const b = createSignal(0)
			const document = mount(() => {
				addIf(() => a(), () => {
					elements.div()
				}).elseif(() => b(), () => {
					elements.span()
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

		it("passes errors", () => {
			const document = mount(() => {
				assert.throws(() => {
					addIf(() => 1, () => {
						throw new Error("err")
					})
				})
			})
		})

		it("rerenders on state change", () => {
			const signal = createSignal(1)
			const document = mount(() => {
				addIf(() => signal(), () => {
					elements.div()
				}).else(() => {
					elements.span()
				})
			})
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div></div>`)
			signal(0)
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<span></span>`)
		})

		it("does not track inner dependencies", () => {
			const signal = createSignal(1)
			const document = mount(() => {
				addIf(() => 1, () => {
					if (signal()) {
						elements.div()
					}
				})
			})
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div></div>`)
			assert.ok(console.error.calledWithMatch("add a dependency but didn't"))
			signal(0)
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div></div>`) //shouldn't have changed
		})

		it("does not rerender inner when reaching the same condition", () => {
			const signal = createSignal(1)
			let count = 0
			const document = mount(() => {
				addIf(signal, () => {
					count++
					elements.div()
				}).else(() => {
					elements.span()
				})
			})
			assert.strictEqual(count, 1)
			signal(true)
			assert.strictEqual(count, 1)
		})

		it("does not keep-alive inner", () => {
			const signal = createSignal(1)
			let count = 0
			const document = mount(() => {
				addIf(signal, () => {
					count++
					elements.div()
				}).else(() => {
					elements.span()
				})
			})
			assert.strictEqual(count, 1)
			signal(false)
			signal(true)
			assert.strictEqual(count, 2)
		})

		it("updates in a single tick (1)", () => {
			const signal = createSignal(1)

			let err = false
			const document = mount(() => {
				addIf(() => signal(), () => {
					addDynamic(() => {
						if (!signal()) {
							err = true
						}
					})
				})
			})

			signal(0)
			assert.strictEqual(err, false)
		})

		it("updates in a single tick (2)", () => {
			const url = createSignal("abc")

			let err = false
			const document = mount(() => {
				addIf(() => false, () => {

				}).elseif(() => url() === "xyz", () => {

				}).elseif(() => /abc/.test(url()), () => {
					addDynamic(() => {
						if (!/abc/.exec(url())) {
							err = true
						}
					})
				})
			})

			url("xyz")
			assert.strictEqual(err, false)
		})

		// This obviously isn't the most preferable behavior, but there doesn't
		// seem to be an easy way to fix it. The problem is that @dynein/state runs effects
		// in order of last execution time, and the addIf() reruns when .else is called, after the
		// addDynamic has already been added. This causes the addDynamic to rerun first after
		// val(1) triggers an update of both.
		//
		// The reason we have these two tests here is just to record the behavior and make it easy
		// to notice if it changes in the future.
		it("doesn't update in a single tick (undefined behavior) (1)", () => {
			const val = createSignal(0)

			let err = false
			const document = mount(() => {
				addIf(() => val() === 0, () => {
					addDynamic(() => {
						if (val() !== 0) {
							err = true
						}
					})
				}).else(() => {

				})
			})

			val(1)
			assert.strictEqual(err, true)
		})

		it("doesn't update in a single tick (undefined behavior) (2)", () => {
			const a = createSignal(0)
			const val = createSignal(0)

			let err = false
			const document = mount(() => {
				addIf(() => !a() && (val() === 0), () => {
					addDynamic(() => {
						if (val() !== 0) {
							err = true
						}
					})
				})
			})

			// This causes the addIf to rerun, and although the condition is the same,
			// the addIf will now be executed after the addDynamic when val(1) is called.
			a(false)
			assert.strictEqual(err, false)
			val(1)
			assert.strictEqual(err, true)
		})
	})

	describe("addDynamic", () => {
		it("creates", () => {
			const document = mount(() => {
				addDynamic(() => {
					elements.div()
				})
			})
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div></div>`)
		})

		it("rerenders on state change", () => {
			const signal = createSignal(1)
			const document = mount(() => {
				addDynamic(() => {
					if (signal()) {
						elements.div()
					} else {
						elements.span()
					}
				})
			})
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div></div>`)
			signal(0)
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<span></span>`)
		})

		it("passes errors", () => {
			const document = mount(() => {
				assert.throws(() => {
					addDynamic(() => {
						throw new Error("err")
					})
				})
			})
		})

		// parallel to the addIf test case
		it("updates in a single tick", () => {
			const signal = createSignal(1)
			const document = mount(() => {
				addDynamic(() => {
					if (signal()) {
						addDynamic(() => {
							if (!signal()) {
								throw new Error("Got falsy in truthy branch")
							}
						})
					}
				})
			})

			assert.doesNotThrow(() => {
				signal(0)
			})
		})

		it("handles async functions", async () => {
			const document = mount(() => {
				addDynamic(async () => {
					elements.div("before")
					await $s(sleep(1))
					elements.div("after")
				})
			})

			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div>before</div>`)
			await sleep(20)
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div>before</div><div>after</div>`)
		})

		it("handles async deps", async () => {
			const signal = createSignal(0)

			const document = mount(() => {
				addDynamic(async () => {
					elements.div("before")
					await $s(sleep(1))
					elements.div("after = " + signal())
				})
			})

			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div>before</div>`)
			await sleep(20)
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div>before</div><div>after = 0</div>`)
			signal(1)
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div>before</div>`)
			await sleep(20)
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div>before</div><div>after = 1</div>`)
		})

		it("handles async destruction while rendering", async () => {
			const signal = createSignal(0)

			let order = ""
			const document = mount(() => {
				addDynamic(() => {
					order += "run outer "
					if (!signal()) {
						addDynamic(async () => {
							onCleanup(() => {
								order += "cleanup inner "
							})
							order += "before "
							elements.div("before")
							await $s(sleep(1))
							order += "after "
							elements.div("after")
						})
					}
				})
			})

			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div>before</div>`)
			order += "write signal "
			signal(1)
			await sleep(20)
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), ``)
			assert.strictEqual(order, "run outer before write signal cleanup inner run outer after ")
		})
	})

	describe("addAsync", () => {
		it("adds nodes asynchronously", async () => {
			const document = mount(() => {
				addAsync(async () => {
					elements.div("before")
					await $s(sleep(1))
					elements.div("after")
				})
			})

			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div>before</div>`)
			await sleep(20)
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div>before</div><div>after</div>`)
		})

		it("handles async destruction while rendering", async () => {
			const signal = createSignal(0)

			let order = ""
			const document = mount(() => {
				addDynamic(() => {
					order += "run outer "
					if (!signal()) {
						addAsync(async () => {
							onCleanup(() => {
								order += "cleanup inner "
							})
							order += "before "
							elements.div("before")
							await $s(sleep(1))
							order += "after "
							elements.div("after")
						})
					}
				})
			})

			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div>before</div>`)
			order += "write signal "
			signal(1)
			await sleep(20)
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), ``)
			assert.strictEqual(order, "run outer before write signal cleanup inner run outer after ")
		})

		it("returns the result of inner", () => {
			let val
			mount(() => {
				val = addAsync(() => {
					return 5
				})
			})

			assert.strictEqual(val, 5)
		})
	})

	describe("addAsyncReplaceable", () => {
		it("creates", () => {
			const document = mount(() => {
				addAsyncReplaceable(($r) => {
					$r(() => {
						elements.div()
					})
				})
			})
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div></div>`)
		})

		it("replaces", () => {
			const document = mount(() => {
				addAsyncReplaceable(($r) => {
					$r(() => {
						elements.div()
					})
					$r(() => {
						elements.span()
					})
				})
			})
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<span></span>`)
		})

		it("destroys previous subcontexts", () => {
			const signal = createSignal(true, true)
			let count = 0
			const document = mount(() => {
				addAsyncReplaceable(($r) => {
					$r(() => {
						createEffect(() => {
							signal()
							count++
						})
						elements.div()
					})
					assert.strictEqual(count, 1, "init")
					signal(true)
					assert.strictEqual(count, 2, "update after watcher active")
					$r(() => {
						elements.span()
					})
					signal(true)
					assert.strictEqual(count, 2, "update after watcher should be destroyed")
				})
			})
		})

		it("calls inner but does not add to the dom when destroyed", () => {
			const signal = createSignal(0)

			let ranShouldntShowUp = false
			const document = mount(() => {
				addDynamic(() => {
					if (!signal()) {
						addAsyncReplaceable(($r) => {
							$r(() => {
								elements.div("init")
							})
							createRoot(() => {
								onUpdate(signal, (newVal) => {
									if (newVal === 2) {
										$r(() => {
											elements.div("shouldn't show up")
											ranShouldntShowUp = true
										})
									}
								})
							})
						})
					}
				})
			})

			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div>init</div>`)
			signal(1)
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), ``)
			signal(2)
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), ``)
			assert.strictEqual(ranShouldntShowUp, true)
		})
	})

})

