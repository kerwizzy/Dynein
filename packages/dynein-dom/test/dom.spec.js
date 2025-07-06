import { createRoot, createSignal, toSignal, createEffect, batch, $s, Owner, runWithOwner, onCleanup, onUpdate, WatchedArray, WatchedSet, WatchedMap } from "@dynein/state"
import { addPortal, elements, addIf, addAsyncReplaceable, addAsync, addDynamic, addNode, addHTML, addText, addFor } from "@dynein/dom"

function mount(inner) {
	let fakeDocument
	createRoot(() => {
		addPortal(document.createElement("div"), null, () => {
			elements.div((divEl) => {
				fakeDocument = { body: divEl }
				inner(fakeDocument)
			})
		})
	})
	return fakeDocument
}

process.on('unhandledRejection', (reason) => {
	console.log("unhandled rejection", reason)
	throw reason
})

function sleep(ms = 10) {
	return new Promise((resolve) => {
		setTimeout(() => {
			resolve()
		}, ms)
	})
}

// Used for the addFor fuzzing code. Small list to make collisions and duplicates more likely.
const possibleEntries = "abcxyz"
function rand() {
	return possibleEntries[Math.floor(Math.random() * possibleEntries.length)]
}

function srand() {
	const options = [
		``,
		`${rand()}|${rand()} `,
		`${rand()}|${rand()}|${rand()} `,
		`${rand()} `,
		`${rand()} `,
		`${rand()} `
	]

	return options[Math.floor(Math.random() * options.length)]
}

/* Randomize array in-place using Durstenfeld shuffle algorithm */
// https://stackoverflow.com/a/12646864
function shuffleArray(array) {
	array = array.slice(0)
	for (var i = array.length - 1; i > 0; i--) {
		var j = Math.floor(Math.random() * (i + 1))
		var temp = array[i]
		array[i] = array[j]
		array[j] = temp
	}
	return array
}

describe("@dynein/dom", () => {
	if (typeof process !== "undefined") {
		global.requestAnimationFrame = (fn) => {
			setImmediate(fn, 0)
		}

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
				}, "not rendering")
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

			it("converts undefined to empty string", () => {
				const document = mount(() => {
					elements.div(undefined)
				})
				assert.strictEqual(document.body.innerHTML, `<div></div>`)
			})

			it("converts null to empty string", () => {
				const document = mount(() => {
					elements.div(null)
				})
				assert.strictEqual(document.body.innerHTML, `<div></div>`)
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
					}, "Err")
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
				}, "err")
			})
		})

		it("throws on dom inside", () => {
			const document = mount(() => {
				assert.throws(() => {
					addText(() => {
						elements.div()
					})
				}, "not rendering")
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
				}, "HTML must be a string or number")
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
				}, "err")
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
			// the addIf will now be executed after the addDynamic when val(1) is called
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
				}, "err")
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

		it("handles async destruction while rendering (1)", async () => {
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
							order += "done "
						})
					}
				})
			})

			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div>before</div>`)
			order += "write signal "
			signal(1)
			await sleep(20)
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), ``)
			assert.strictEqual(order, "run outer before write signal cleanup inner run outer ")
		})

		it("handles async destruction while rendering (2)", async () => {
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
							addAsyncReplaceable(($r) => {
								order += "NOT RUN 1 "
								$r(() => {
									order += "NOT RUN 2 "
									elements.div("after")
								})
							})
							order += "done "
						})
					}
				})
			})

			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div>before</div>`)
			order += "write signal "
			signal(1)
			await sleep(20)
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), ``)
			assert.strictEqual(order, "run outer before write signal cleanup inner run outer ")
		})

		it("handles async destruction while rendering (3)", async () => {
			const show = createSignal(true)

			let order = ""
			const document = mount(() => {
				addDynamic(async () => {
					order += "run (show = " + show() + ") "
					if (!show()) {
						return
					}

					onCleanup(() => {
						order += "cleanup "
					})
					order += "before "
					elements.div("before")
					await $s(sleep(1))
					order += "after "
					addAsyncReplaceable(($r) => {
						order += "NOT RUN 1 "
						$r(() => {
							order += "NOT RUN 2 "
							elements.div("after")
						})
					})
					order += "done "
				})
			})

			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `<div>before</div>`)
			order += "write signal "
			show(false)
			await sleep(20)
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), ``)
			assert.strictEqual(order, "run (show = true) before write signal cleanup run (show = false) ")
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
			assert.strictEqual(order, "run outer before write signal cleanup inner run outer ")
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

		it("handles sequential addAsync", async () => {
			const document = mount(() => {
				addAsync(async () => {
					await $s(sleep(10))
					addText("1")
					await $s(sleep(20))
					addText("2")
				})
				addAsync(async () => {
					addText("a")
					await $s(sleep(20))
					addText("b")
				})
			})

			/*
			Sequence of states should be:

			t	first		second
			0				a
			10	1			a
			20	1			ab
			30	12			ab

			*/

			await sleep(100)

			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), `12ab`)
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


		it("throws on attempting element creation outside of $r", () => {
			assert.throws(() => {
				const document = mount(() => {
					addAsyncReplaceable(() => {
						elements.div()
					})
				})
			}, "not rendering")
		})

		it("does not track dependencies outside of $r", () => {
			mount(() => {
				const log = []
				sinon.spy(console, "error")

				const sig = createSignal(0)

				addDynamic(() => {
					log.push("in addDynamic")
					addAsyncReplaceable(($r) => {
						log.push("sig = " + sig())
					})
					log.push("after addAsyncReplaceable")
				})

				log.push("writing to sig")
				sig(1)
				log.push("end")

				assert.strictEqual(log.join("; "), "in addDynamic; sig = 0; after addAsyncReplaceable; writing to sig; end")

				assert.strictEqual(console.error.getCall(0).args[0], "Looks like you might have wanted to add a dependency but didn't.")
			})
		})

		it("does not track dependencies inside of $r", () => {
			mount(() => {
				const log = []
				sinon.spy(console, "error")

				const sig = createSignal(0)
				addDynamic(() => {
					log.push("in addDynamic")
					addAsyncReplaceable(($r) => {
						$r(() => {
							log.push("sig = " + sig())
						})
					})
					log.push("after addAsyncReplaceable")
				})

				log.push("writing to sig")
				sig(1)
				log.push("end")

				assert.strictEqual(log.join("; "), "in addDynamic; sig = 0; after addAsyncReplaceable; writing to sig; end")
				assert.strictEqual(console.error.getCall(0).args[0], "Looks like you might have wanted to add a dependency but didn't.")
			})
		})

		it("runs $r inside a batch", async () => {
			const log = []

			mount(() => {
				const sig1 = createSignal("a")
				const sig2 = createSignal("x")

				createEffect(() => {
					log.push(`sig1 = ${sig1()}`)
				})

				createEffect(() => {
					log.push(`sig2 = ${sig2()}`)
				})

				addAsyncReplaceable(async ($r) => {
					await sleep(1)

					$r(() => {
						log.push("$r start")
						log.push("set sig1 = b")
						sig1("b")
						log.push("set sig2 = y")
						sig2("y")
						log.push("$r end")
					})
				})
			})

			await sleep(10)

			assert.strictEqual(log.join("; "), "sig1 = a; sig2 = x; $r start; set sig1 = b; set sig2 = y; $r end; sig1 = b; sig2 = y")
		})
	})

	describe("addFor", () => {
		describe("arrays", () => {
			it("create elements", async () => {
				const arr = new WatchedArray([1, 2, 3])
				const document = mount(() => {
					addFor(arr, (item) => {
						addText(item)
					})
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "123")
			})

			it("splices elements in the middle", async () => {
				const arr = new WatchedArray([1, 2, 3, 4])
				const document = mount(() => {
					addFor(arr, (item) => {
						addText(item)
					})
					arr.splice(1, 2, "a", "b")
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "1ab4")
			})

			it("handles .startItem changing", async () => {
				const arr = new WatchedArray([1, 2, 3, 4])
				const document = mount(() => {
					addFor(arr, (item) => {
						addText(item)
					})
					arr.splice(0, 1)
					arr.splice(2, 1)
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "23")
			})

			it("reuses nodes", async () => {
				const arr = new WatchedArray([1, 2, 3, 4])
				let twoNode1
				let twoNode2
				mount((document) => {
					addFor(arr, (item) => {
						addText(item)
					})
					twoNode1 = Array.from(document.body.childNodes).find(n => n.textContent === "2")
					arr.shift()
					twoNode2 = Array.from(document.body.childNodes).find(n => n.textContent === "2")
				})
				await sleep()
				assert.strictEqual(twoNode1 === twoNode2, true)
			})

			it("does not reuse nodes when the entire array is replaced", async () => {
				const arr = new WatchedArray([1, 2, 3, 4])
				let twoNode1
				let twoNode2
				mount((document) => {
					addFor(arr, (item) => {
						addText(item)
					})
					const nodes = Array.from(document.body.childNodes)
					twoNode1 = nodes.find(n => n.textContent === "2")
					arr.value([1, 2, 3, 4])
					twoNode2 = Array.from(document.body.childNodes).find(n => n.textContent === "2")
				})
				await sleep()
				assert.strictEqual(twoNode1, twoNode2, "twoNode1 === twoNode2")
			})

			it("handles multiple splices inside a batch", async () => {
				const arr = new WatchedArray([1, 2, 3, 4])
				const document = mount(() => {
					addFor(arr, (item) => {
						addText(item)
					})
					batch(() => {
						arr.splice(0, 1) //234
						arr.splice(2, 1) //23
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

			it("handles complete array replacement splices inside a batch", async () => {
				const arr = new WatchedArray([1, 2, 3, 4])
				const document = mount(() => {
					addFor(arr, (item) => {
						addText(item)
					})
					batch(() => {
						arr.splice(0, 1) //234
						arr.splice(2, 1) //23
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

			it("handles complete array replacement splices at the end of a batch", async () => {
				const arr = new WatchedArray([1, 2, 3, 4])
				const document = mount(() => {
					addFor(arr, (item) => {
						addText(item)
					})
					batch(() => {
						arr.splice(0, 1) //234
						arr.splice(2, 1) //23
						arr.value([]) //
					})
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "")
			})

			it("passes NaN index by default", async () => {
				const arr = new WatchedArray(["a", "b", "c", "d"])
				const document = mount(() => {
					addFor(arr, (item, index) => {
						addText(() => item + index() + " ")
					})
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "aNaN bNaN cNaN dNaN ")
			})

			it("renders indexes correctly (1)", async () => {
				const arr = new WatchedArray(["a", "b", "c", "d"])
				const document = mount(() => {
					addFor(arr, (item, index) => {
						addText(() => item + index() + " ")
					}, true)
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "a0 b1 c2 d3 ")
			})
			it("renders indexes correctly (2)", async () => {
				const arr = new WatchedArray(["a", "b", "c", "d"])
				const document = mount(() => {
					addFor(arr, (item, index) => {
						addText(() => item + index() + " ")
					}, true)
					batch(() => {
						arr.shift()
						arr.push("e")
					})
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "b0 c1 d2 e3 ")
			})

			it("handles errors in render (1)", async () => {
				const arr = new WatchedArray(["a", "b", "c"])
				const document = mount(() => {
					addFor(arr, (item, index) => {
						if (item === "b") {
							throw new Error("Found a B!")
						}
						addText(() => item + index() + " ")
					}, true)
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "a0 c2 ")
			})

			it("handles errors in render (2)", async () => {
				const arr = new WatchedArray(["a", "b"])
				const document = mount(() => {
					addFor(arr, (item, index) => {
						if (item === "c") {
							throw new Error("Found a C!")
						}
						addText(() => item + index() + " ")
					}, true)

					batch(() => {
						arr.push("c")
					})
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "a0 b1 ")
			})

			it("handles being in a addDynamic (1)", async () => {
				const show = createSignal(true)
				const arr = new WatchedArray(["a", "b"])

				const document = mount(() => {
					addDynamic(() => {
						if (show()) {
							addFor(arr, (item, index) => {
								addText(() => item + index() + " ")
							})
						} else {
							addText("nothing")
						}
					})
				})
				await sleep()

				batch(() => {
					arr.push("c")
					show(false)
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "nothing")
			})

			it("handles being in a addDynamic (2)", async () => {
				const show = createSignal(true)
				const arr = new WatchedArray(["a", "b"])

				const document = mount(() => {
					addDynamic(() => {
						if (show()) {
							addFor(arr, (item, index) => {
								addText(() => item + index() + " ")
							})
						} else {
							addText("nothing")
						}
					})
				})
				await sleep()

				batch(() => {
					show(false)
					arr.push("c")
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "nothing")
			})

			it("handles being destroyed during rendering (at init)", async () => {
				const show = createSignal(true)
				const arr = new WatchedArray(["a", "b", "c"])

				const document = mount(() => {
					addDynamic(() => {
						if (show()) {
							addFor(arr, (item, index) => {
								if (item === "b") {
									show(false)
								}
								addText(() => item + index() + " ")
							})
						} else {
							addText("nothing")
						}
					})
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "nothing")
			})

			it("handles being destroyed during rendering (during update)", async () => {
				const show = createSignal(true)
				const arr = new WatchedArray(["a", "d", "e"])

				const document = mount(() => {
					addDynamic(() => {
						if (show()) {
							addFor(arr, (item, index) => {
								if (item === "b") {
									show(false)
								}
								addText(() => item + index() + " ")
							})
						} else {
							addText("nothing")
						}
					})
				})
				await sleep()
				arr.splice(1, 0, "b", "c")
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "nothing")
			})

			/* // Uncomment for testing a particular test failure found by the fuzzer
			it("extracted rand", () => {
				const addAsyncMode = true
				const renderIndexes = false

				let pairList = []
				const arr = new WatchedArray(pairList.slice(0))
				const document = mount(() => {
					addFor(arr, async (item, index) => {
						if (!item) {
							// don't add anything for empty string
						} else {
							if (addAsyncMode) {
								addAsync(async () => {
									if (Math.random() < 0.5) {
										for (const c of item.split("|")) {
											await $s(sleep(Math.random() * 10))
											if (renderIndexes) {
												addText(() => index() + c)
											} else {
												addText(c)
											}
										}
									} else {
										for (const c of item.split("|")) {
											if (renderIndexes) {
												addText(() => index() + c)
											} else {
												addText(c)
											}
											await $s(sleep(Math.random() * 10))
										}
									}
								})
							} else {
								for (const c of item.split("|")) {
									if (renderIndexes) {
										addText(() => index() + c)
									} else {
										addText(c)
									}
								}
							}
						}
					}, renderIndexes)
				})

				console.log("PAIR LIST = ", pairList)

				const forOut = document.body.innerHTML.replace(/<\!--.*?-->/g, "")

				let expectedOut = ""
				for (let index = 0; index < pairList.length; index++) {
					const item = pairList[index]
					if (!item) {
						// don't add anything for empty string
					} else {
						for (const c of item.split("|")) {
							if (renderIndexes) {
								expectedOut += (index + c)
							} else {
								expectedOut += c
							}
						}
					}
				}

				assert.strictEqual(forOut, expectedOut)
			})
			*/


			// fuzz for edge cases
			describe("passes randomly generated tests", () => {
				for (let i = 0; i < 1000; i++) {
					it("rand " + i, async () => {
						const actionsLog = []
						let pairList = []
						let document
						let initialPairList

						const renderIndexes = Math.random() < 0.2
						try {
							const addAsyncMode = Math.random() < 0.05

							if (addAsyncMode) {
								actionsLog.push("async")
							}

							if (renderIndexes) {
								actionsLog.push("indexes")
							}

							for (let addToInit = 0; addToInit < Math.random() * 5; addToInit++) {
								if (Math.random() < 0.2) {
									pairList.push("")
									actionsLog.push(`push ""`)
								} else {
									const v = srand()
									pairList.push(v)
									actionsLog.push("push " + JSON.stringify(v))
								}
							}

							actionsLog.push("init")

							initialPairList = Array.from(pairList)
							let list = new WatchedArray(Array.from(pairList))

							document = mount(() => {
								addFor(list, async (item, index) => {
									if (!item) {
										// don't add anything for empty string
									} else {
										if (addAsyncMode) {
											addAsync(async () => {
												if (Math.random() < 0.5) {
													for (const c of item.split("|")) {
														await $s(sleep(1))
														if (renderIndexes) {
															addText(() => index() + c)
														} else {
															addText(c)
														}
													}
												} else {
													for (const c of item.split("|")) {
														if (renderIndexes) {
															addText(() => index() + c)
														} else {
															addText(c)
														}
														await $s(sleep(1))
													}
												}
											})
										} else {
											for (const c of item.split("|")) {
												if (renderIndexes) {
													addText(() => index() + c)
												} else {
													addText(c)
												}
											}
										}
									}
								}, renderIndexes)
							})

							const nOps = Math.random() * 12
							for (let j = 0; j < nOps; j++) {
								if (addAsyncMode && Math.random() < 0.05) {
									actionsLog.push("sleep")
									await $s(sleep(Math.random() * 5))
								} else if (Math.random() < 0.3) {
									if (Math.random() < 0.2) {
										actionsLog.push("clear")
										pairList = []
										list.value([])
									} else {
										const replaceOptions = [
											[""],
											["", "", "", "", ""],
											[srand()],
											["", srand(), "", srand()],
											["", srand(), "", srand(), ""],
											Array(pairList.length).fill(0).map(() => srand()),
											shuffleArray(pairList)
										]
										const newList = replaceOptions[Math.floor(Math.random() * replaceOptions.length)]
										actionsLog.push("replace " + JSON.stringify(newList))

										let canTestReordering = true
										for (let i = 0; i < pairList.length; i++) {
											const item = pairList[i]
											if (!newList.includes(item)) {
												canTestReordering = false
												break
											}
										}

										let oldNodes = Array.from(document.body.childNodes)

										pairList = newList
										list.value(Array.from(newList))

										if (canTestReordering) {
											if (addAsyncMode) {
												await sleep(50)
											}

											const foundSomePreservation = new Map()
											for (const oldNode of oldNodes) {
												const key = oldNode.textContent.replace(/\d/g, "") // remove index markers
												foundSomePreservation.set(key, false)
											}

											const newNodes = Array.from(document.body.childNodes)
											for (const newNode of newNodes) {
												const key = newNode.textContent.replace(/\d/g, "") // remove index markers
												if (foundSomePreservation.has(key)) {
													foundSomePreservation.set(key, true)
												}
											}

											for (const [key, preservation] of foundSomePreservation) {
												if (!preservation) {
													actionsLog.push(`NOT PRESERVED ${key}`)
												}
											}
										}
									}
								} else {
									let startI = Math.floor((Math.random() * 2 - 1) * 1.5 * list.length)
									let remove = Math.floor((Math.random() * 2 - 1) * 1.5 * list.length)

									let toAdd = []
									for (let n = 0; n < Math.random() * 4; n++) {
										if (Math.random() < 0.2) {
											toAdd.push("")
										} else {
											const v = srand()
											toAdd.push(v)
										}
									}

									if (Math.random() < 0.05) {
										if (Math.random() < 0.5) {
											startI = Infinity
										} else {
											startI = undefined
										}
									}
									if (Math.random() < 0.05) {
										if (Math.random() < 0.5) {
											remove = Infinity
										} else {
											remove = undefined
										}
									}

									if (Math.random() < 0.05) {
										// Pass odd argument lengths
										const r = Math.random()
										if (r < 0.3) {
											actionsLog.push(`splice ()`)
											pairList.splice()
											list.splice()
										} else if (r < 0.6) {
											actionsLog.push(`splice (${startI})`)
											pairList.splice(startI)
											list.splice(startI)
										} else {
											actionsLog.push(`splice (${startI} ${remove})`)
											pairList.splice(startI, remove)
											list.splice(startI, remove)
										}
									} else {
										actionsLog.push(`splice ${startI} ${remove} ${JSON.stringify(toAdd)}`)
										pairList.splice(startI, remove, ...toAdd)
										list.splice(startI, remove, ...toAdd)
									}
								}
							}

							if (addAsyncMode) {
								await sleep(50)
							}
						} catch (err) {
							const forOut = document.body.innerHTML.replace(/<\!--.*?-->/g, "")
							const expectedOut = Array.from(pairList).join("")
							console.log(`rand ${i} state at throw:`, { forOut, expectedOut, actionsLog })
							throw err
						}

						const forOut = document.body.innerHTML.replace(/<\!--.*?-->/g, "")

						let expectedOut = ""
						for (let index = 0; index < pairList.length; index++) {
							const item = pairList[index]
							if (!item) {
								// don't add anything for empty string
							} else {
								for (const c of item.split("|")) {
									if (renderIndexes) {
										expectedOut += (index + c)
									} else {
										expectedOut += c
									}
								}
							}
						}

						//console.log(expectedOut, actionsLog.join("; "))
						assert.strictEqual(forOut, expectedOut, actionsLog.join("; "))
						assert.strictEqual(actionsLog.join("; ").includes("NOT"), false, actionsLog.join("; "))
					})
				}
			})
		})

		describe("set", () => {
			it("create elements", async () => {
				const list = new WatchedSet([1, 2, 3])
				const document = mount(() => {
					addFor(list, (item) => {
						addText(item)
					})
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "123")
			})

			it("handles adding items", async () => {
				const list = new WatchedSet([1, 2, 3, 4])
				const document = mount(() => {
					addFor(list, (item) => {
						addText(item)
					})
					list.add("a")
					list.add("b")
					list.add("a")
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "1234ab")
			})

			it("handles deleting items", async () => {
				const list = new WatchedSet([1, 2, 3, 4])
				const document = mount(() => {
					addFor(list, (item) => {
						addText(item)
					})
					list.delete(3)
					list.delete(10)

					list.add("b")
					list.add("c")
					list.add("b")
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "124bc")
			})

			it("handles deleting and re-adding items", async () => {
				const list = new WatchedSet([1, 2, 3, 4])
				const document = mount(() => {
					addFor(list, (item) => {
						addText(item)
					})
					list.delete(3)
					list.delete(10)

					list.add(3)
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "1243")
			})

			it("handles .startItem changing", async () => {
				const list = new WatchedSet([1, 2, 3, 4])
				const document = mount(() => {
					addFor(list, (item) => {
						addText(item)
					})
					list.delete(1)
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "234")
			})

			it("handles adding after endItem deleted", async () => {
				const list = new WatchedSet([1, 2, 3, 4])
				const document = mount(() => {
					addFor(list, (item) => {
						addText(item)
					})
				})
				list.delete(4)
				await sleep()

				list.add(5)
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "1235")
			})

			it("reuses nodes", async () => {
				const list = new WatchedSet([1, 2, 3, 4])
				let twoNode1
				let twoNode2
				const document = mount((document) => {
					addFor(list, (item) => {
						addText(item)
					})
					twoNode1 = Array.from(document.body.childNodes).find(n => n.textContent === "2")
					list.delete(1)
					twoNode2 = Array.from(document.body.childNodes).find(n => n.textContent === "2")
				})
				await sleep()
				assert.strictEqual(twoNode1 === twoNode2, true)
			})

			it("reuses nodes even when the entire set is replaced", async () => {
				const list = new WatchedSet([1, 2, 3, 4])
				let twoNode1
				let twoNode2
				mount((document) => {
					addFor(list, (item) => {
						addText(item)
					})
					const nodes = Array.from(document.body.childNodes)
					twoNode1 = nodes.find(n => n.textContent === "2")
					list.value(new Set([3, 4, 2, 1]))
					twoNode2 = Array.from(document.body.childNodes).find(n => n.textContent === "2")
				})
				await sleep()
				assert.strictEqual(twoNode1 === twoNode2, true, "twoNode1 === twoNode2")
			})

			it("handles multiple changes inside a batch", async () => {
				const list = new WatchedSet([1, 2, 3, 4])
				const document = mount(() => {
					addFor(list, (item) => {
						addText(item)
					})
					batch(() => {
						list.delete(1) // 234
						list.delete(4) // 23
						list.add("a")  // 23a
						list.add("a")  // 23a
						list.add("b")  // 23ab
						list.add("c")  // 23abc
						list.delete(1) // 23abc
						list.delete("a") // 23bc
						list.delete("b") // 23c
						list.add("a")    // 23ca
					})
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "23ca")
			})

			it("handles complete set replacement inside a batch", async () => {
				const list = new WatchedSet([1, 2, 3, 4])
				const document = mount(() => {
					addFor(list, (item) => {
						addText(item)
					})
					batch(() => {
						list.delete(1) // 234
						list.delete(4) // 23
						list.value(new Set(["a", "b"]))
						list.add("a")  // ab
						list.add(1)  // ab1
						list.delete("a")  // b1
						list.add("c")  // b1c
					})
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "b1c")
			})

			it("handles complete set clearing inside a batch", async () => {
				const list = new WatchedSet([1, 2, 3, 4])
				const document = mount(() => {
					addFor(list, (item) => {
						addText(item)
					})
					batch(() => {
						list.delete(1) // 234
						list.delete(4) // 23
						list.clear()
						list.add("a")  // a
						list.add(1)  // a1
						list.delete("a")  // 1
						list.add("c")  // 1c
					})
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "1c")
			})

			it("renders indexes correctly (1)", async () => {
				const list = new WatchedSet(["a", "b", "c", "d"])
				const document = mount(() => {
					addFor(list, (item, index) => {
						addText(() => item + index() + " ")
					}, true)
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "a0 b1 c2 d3 ")
			})

			it("renders indexes correctly (2)", async () => {
				const list = new WatchedSet(["a", "b", "c", "d"])
				const document = mount(() => {
					addFor(list, (item, index) => {
						addText(() => item + index() + " ")
					}, true)
					batch(() => {
						list.delete("a")
						list.add("e")
					})
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "b0 c1 d2 e3 ")
			})

			it("handles errors in render (1)", async () => {
				const list = new WatchedSet(["a", "b", "c"])
				const document = mount(() => {
					addFor(list, (item, index) => {
						if (item === "b") {
							throw new Error("Found a B!")
						}
						addText(() => item + index() + " ")
					}, true)
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "a0 c2 ")
			})

			it("handles errors in render (2)", async () => {
				const list = new WatchedSet(["a", "b"])
				const document = mount(() => {
					addFor(list, (item, index) => {
						if (item === "c") {
							throw new Error("Found a C!")
						}
						addText(() => item + index() + " ")
					}, true)

					batch(() => {
						list.add("c")
					})
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "a0 b1 ")
			})

			it("handles being in a addDynamic", async () => {
				const show = createSignal(true)
				const list = new WatchedSet(["a", "b"])

				const document = mount(() => {
					addDynamic(() => {
						if (show()) {
							addFor(list, (item, index) => {
								addText(() => item + index() + " ")
							})
						} else {
							addText("nothing")
						}
					})
				})
				await sleep()

				batch(() => {
					list.add("c")
					show(false)
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "nothing")
			})

			// fuzz for edge cases
			describe("passes randomly generated tests", () => {
				for (let i = 0; i < 1000; i++) {
					it("rand " + i, async () => {
						let pairList = new Set()
						const actionsLog = []
						for (let addToInit = 0; addToInit < Math.random() * 5; addToInit++) {
							const v = rand()
							pairList.add(v)
							actionsLog.push("add " + v)
						}

						actionsLog.push("init")

						const list = new WatchedSet(Array.from(pairList))

						const document = mount(() => {
							addFor(list, (item) => {
								addText(item)
							})
						})

						for (let j = 0; j < Math.random() * 15; j++) {
							const n = Math.floor(Math.random() * 3)
							if (n === 0) {
								if (Math.random < 0.6) {
									list.clear()
									pairList.clear()
									actionsLog.push("clear")
								} else if (Math.random() < 0.6) {
									pairList = new Set()
									list.value(new Set())
									actionsLog.push("reset")
								} else {
									const replaceOptions = [
										[""],
										["", "", "", "", ""],
										["", rand()],
										[rand(), ""],
										["", rand(), ""],
										[rand(), rand(), rand(), rand(), rand()],
									]
									const newList = new Set(replaceOptions[Math.floor(Math.random() * replaceOptions.length)])
									actionsLog.push("replace " + JSON.stringify(Array.from(newList)))

									let canTestReordering = true
									for (const item of pairList) {
										if (!newList.has(item)) {
											canTestReordering = false
										}
									}

									let oldNodes = Array.from(document.body.childNodes)

									pairList = newList
									list.value(newList)

									if (canTestReordering) {
										const newNodes = Array.from(document.body.childNodes)
										for (const oldNode of oldNodes) {
											if (!newNodes.includes(oldNode)) {
												actionsLog.push("NOT PRESERVED " + oldNode.textContent)
											}
										}
									}
								}
							} else if (n === 2) {
								if (Math.random() < 0.5) {
									const v = Array.from(pairList)[Math.floor(pairList.size * Math.random())] ?? rand()
									list.delete(v)
									pairList.delete(v)
									actionsLog.push("delete " + v)
								} else {
									const v = rand()
									list.delete(v)
									pairList.delete(v)
									actionsLog.push("delete " + v)
								}
							} else {
								if (Math.random() < 0.5) {
									const v = Array.from(pairList)[Math.floor(pairList.size * Math.random())] ?? rand()
									list.add(v)
									pairList.add(v)
									actionsLog.push("add " + v)
								} else {
									const v = rand()
									list.add(v)
									pairList.add(v)
									actionsLog.push("add " + v)
								}
							}
						}

						await sleep()
						const forOut = document.body.innerHTML.replace(/<\!--.*?-->/g, "")
						const expectedOut = Array.from(pairList).join("")

						assert.strictEqual(forOut, expectedOut, actionsLog.join(", "))
						assert.strictEqual(actionsLog.join("; ").includes("NOT"), false, actionsLog.join("; "))
					})
				}
			})
		})

		describe("map", () => {
			it("create elements", async () => {
				const list = new WatchedMap([[1, "a"], [2, "b"]])
				const document = mount(() => {
					addFor(list, ([k, v]) => {
						addText(k + "=" + v + ";")
					})
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "1=a;2=b;")
			})

			it("handles adding items", async () => {
				const list = new WatchedMap([[1, "a"], [2, "b"]])
				const document = mount(() => {
					addFor(list, ([k, v]) => {
						addText(k + "=" + v + ";")
					})
					list.set(3, "c")
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "1=a;2=b;3=c;")
			})


			it("handles deleting and re-adding items", async () => {
				const list = new WatchedMap([[1, "a"], [2, "b"]])
				const document = mount(() => {
					addFor(list, ([k, v]) => {
						addText(k + "=" + v + ";")
					})
					list.set(3, "c")
					list.delete(1)
					list.delete(1)
					list.set(1, "a")
					list.set(2, "b")
					list.delete(10)
					list.set(3, "x")

				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "2=b;3=x;1=a;")
			})

			it("handles .startItem changing", async () => {
				const list = new WatchedMap([[1, "a"], [2, "b"], [3, "c"]])
				const document = mount(() => {
					addFor(list, ([k, v]) => {
						addText(k + "=" + v + ";")
					})
					list.delete(1)
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "2=b;3=c;")
			})

			it("handles updating a value (1)", async () => {
				const list = new WatchedMap([[1, "a"], [2, "b"], [3, "c"]])
				const document = mount(() => {
					addFor(list, ([k, v]) => {
						addText(k + "=" + v + ";")
					})
				})
				await sleep()
				list.set(1, "x")
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "1=x;2=b;3=c;")
			})

			it("handles updating a value (2)", async () => {
				const list = new WatchedMap([[1, "a"], [2, "b"], [3, "c"]])
				const document = mount(() => {
					addFor(list, ([k, v]) => {
						addText(k + "=" + v + ";")
					})
				})
				await sleep()
				list.set(3, "x")
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "1=a;2=b;3=x;")
			})

			it("handles updating a value (3)", async () => {
				const list = new WatchedMap([[1, "a"]])
				const document = mount(() => {
					addFor(list, ([k, v]) => {
						addText(k + "=" + v + ";")
					})
				})
				list.set(1, "x")
				list.set(2, "b")
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "1=x;2=b;")
			})

			it("reuses nodes", async () => {
				const list = new WatchedMap([[1, "a"], [2, "b"], [3, "c"]])
				let twoNode1
				let twoNode2
				mount((document) => {
					addFor(list, ([k, v]) => {
						addText(k + "=" + v + ";")
					})
					twoNode1 = Array.from(document.body.childNodes).find(n => n.textContent === "2=b;")
					list.delete(1)
					twoNode2 = Array.from(document.body.childNodes).find(n => n.textContent === "2=b;")
				})
				await sleep()
				assert.strictEqual(twoNode1 === twoNode2, true)
			})

			it("reuses nodes even when the entire map is replaced", async () => {
				const list = new WatchedMap([[1, "a"], [2, "b"], [3, "c"]])
				let twoNode1
				let twoNode2
				mount((document) => {
					addFor(list, ([k, v]) => {
						addText(k + "=" + v + ";")
					})
					twoNode1 = Array.from(document.body.childNodes).find(n => n.textContent === "2=b;")
					list.value(new Map([[2, "b"], [1, "a"], [3, "c"]]))
					twoNode2 = Array.from(document.body.childNodes).find(n => n.textContent === "2=b;")

				})

				assert.strictEqual(twoNode1 === twoNode2, true, "twoNode1 === twoNode2")
			})

			it("reuses nodes when an element value is set but not modified", async () => {
				const list = new WatchedMap([[1, "a"], [2, "b"], [3, "c"]])
				let twoNode1
				let twoNode2
				const document = mount(() => {
					addFor(list, ([k, v]) => {
						addText(k + "=" + v + ";")
					})

				})
				twoNode1 = Array.from(document.body.childNodes).find(n => n.textContent === "2=b;")
				list.set(2, "b") // notice value is not changed
				await sleep()
				twoNode2 = Array.from(document.body.childNodes).find(n => n.textContent === "2=b;")
				await sleep()
				assert.strictEqual(twoNode1 === twoNode2, true, "twoNode1 === twoNode2")
			})

			it("handles multiple changes inside a batch", async () => {
				const list = new WatchedMap([[1, "a"], [2, "b"], [3, "c"]])
				const document = mount(() => {
					addFor(list, ([k, v]) => {
						addText(k + "=" + v + ";")
					})
					batch(() => {
						list.delete(1)
						list.delete(10)
						list.set(4, "d")
						list.set(3, "x")
						list.delete(2)
						list.set(2, "b")
					})
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "3=x;4=d;2=b;")
			})

			it("handles complete map replacement inside a batch", async () => {
				const list = new WatchedMap([[1, "a"], [2, "b"], [3, "c"]])
				const document = mount(() => {
					addFor(list, ([k, v]) => {
						addText(k + "=" + v + ";")
					})
					batch(() => {
						list.delete(1)
						list.delete(10)
						list.value(new Map([[8, "x"]]))
						list.set(2, "d")
						list.set(3, "x")
						list.delete(2)
						list.set(2, "b")
					})
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "8=x;3=x;2=b;")
			})

			it("handles complete map clearing inside a batch", async () => {
				const list = new WatchedMap([[1, "a"], [2, "b"], [3, "c"]])
				const document = mount(() => {
					addFor(list, ([k, v]) => {
						addText(k + "=" + v + ";")
					})
					batch(() => {
						list.delete(1)
						list.delete(10)
						list.clear()
						list.set(2, "d")
						list.set(3, "x")
						list.delete(2)
						list.set(2, "b")
					})
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "3=x;2=b;")
			})

			it("renders indexes correctly (1)", async () => {
				const list = new WatchedMap([["a", "x"], ["b", "y"], ["c", "z"]])
				const document = mount(() => {
					addFor(list, ([k, v], index) => {
						addText(() => k + index() + "=" + v + ";")
					}, true)
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "a0=x;b1=y;c2=z;")
			})

			it("renders indexes correctly (2)", async () => {
				const list = new WatchedMap([["a", "x"], ["b", "y"], ["c", "z"]])
				const document = mount(() => {
					addFor(list, ([k, v], index) => {
						addText(() => k + index() + "=" + v + ";")
					}, true)
					batch(() => {
						list.delete("a")
						list.set("d", "w")
					})
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "b0=y;c1=z;d2=w;")
			})

			it("handles errors in render (1)", async () => {
				const list = new WatchedMap([["a", "x"], ["b", "y"], ["c", "z"]])
				const document = mount(() => {
					addFor(list, ([k, v], index) => {
						if (k === "b") {
							throw new Error("Found a B!")
						}
						addText(() => k + index() + "=" + v + ";")
					}, true)
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "a0=x;c2=z;")
			})

			it("handles errors in render (2)", async () => {
				const list = new WatchedMap([["a", "x"], ["b", "y"]])
				const document = mount(() => {
					addFor(list, ([k, v], index) => {
						if (k === "c") {
							throw new Error("Found a C!")
						}
						addText(() => k + index() + "=" + v + ";")
					}, true)

					batch(() => {
						list.set("c", "z")
					})
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "a0=x;b1=y;")
			})

			it("handles being in a addDynamic", async () => {
				const show = createSignal(true)
				const list = new WatchedMap([["a", "x"], ["b", "y"]])

				const document = mount(() => {
					addDynamic(() => {
						if (show()) {
							addFor(list, ([k, v], index) => {
								addText(() => k + index() + "=" + v + ";")
							})
						} else {
							addText("nothing")
						}
					})
				})
				await sleep()

				batch(() => {
					list.set("c", "z")
					show(false)
				})
				await sleep()
				assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "nothing")
			})

			// fuzz for edge cases
			describe("passes randomly generated tests", () => {
				for (let i = 0; i < 1000; i++) {
					it("rand " + i, async () => {
						let pairList = new Map()
						const actionsLog = []
						for (let addToInit = 0; addToInit < Math.random() * 5; addToInit++) {
							const k = rand()
							const v = rand()
							pairList.set(k, v)
							actionsLog.push(`set ${k}=${v}`)
						}

						actionsLog.push("init")

						const list = new WatchedMap(Array.from(pairList))

						const document = mount(() => {
							addFor(list, ([k, v], index) => {
								addText(k + "=" + v + ";")
							})
						})

						for (let j = 0; j < Math.random() * 15; j++) {
							const n = Math.floor(Math.random() * 3)
							if (n === 0) {
								if (Math.random < 0.5) {
									list.clear()
									pairList.clear()
									actionsLog.push("clear")
								} else {
									pairList = new Map()
									list.value(new Map())
									actionsLog.push("reset")
								}
							} else if (n === 2) {
								if (Math.random() < 0.5) {
									const k = Array.from(pairList.keys())[Math.floor(pairList.size * Math.random())] ?? "x"
									list.delete(k)
									pairList.delete(k)
									actionsLog.push("delete " + k)
								} else {
									const k = rand()
									list.delete(k)
									pairList.delete(k)
									actionsLog.push("delete " + k)
								}
							} else {
								if (Math.random() < 0.5) {
									const k = Array.from(pairList.keys())[Math.floor(pairList.size * Math.random())] ?? "x"
									if (list.has(k) && Math.random() < 0.5) {
										const v = list.get(k)
										list.set(k, v)
										pairList.set(k, v)
										actionsLog.push(`set ${k}=${v}`)
									} else {
										const v = rand()
										list.set(k, v)
										pairList.set(k, v)
										actionsLog.push(`set ${k}=${v}`)
									}
								} else {
									const k = rand()
									const v = rand()
									list.set(k, v)
									pairList.set(k, v)
									actionsLog.push(`set ${k}=${v}`)
								}
							}
						}

						await sleep()
						const forOut = document.body.innerHTML.replace(/<\!--.*?-->/g, "")
						const expectedOut = Array.from(pairList).map(([k, v]) => k + "=" + v + ";").join("")

						assert.strictEqual(forOut, expectedOut, actionsLog.join(", "))
					})
				}
			})
		})
	})
})
