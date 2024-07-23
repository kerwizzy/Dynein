import hyperfor from "@dynein/hyperfor"
import * as D from "dynein"
import { WatchedArray, WatchedSet, WatchedMap } from "@dynein/watched-builtins"
import { assert } from "chai"

function mount(inner) {
	D.createRoot(() => {
		D.addPortal(document.body, inner)
	})
}

function sleep() {
	return new Promise((resolve) => {
		setTimeout(() => {
			resolve()
		}, 10)
	})
}

describe("hyperfor", () => {
	if (typeof process !== "undefined") {
		global.requestAnimationFrame = (fn) => {
			setImmediate(fn, 0)
			//fn()
		}
		beforeEach(() => {
			const dom = new JSDOM(`<body></body>`)
			global.window = dom.window
			global.document = dom.window.document
		})

		it("creates an element", () => {
			mount(() => {
				D.elements.div()
			})
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "<div></div>")
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

	describe("array hyperfor", () => {
		it("create elements", async () => {
			const arr = new WatchedArray([1, 2, 3])
			mount(() => {
				hyperfor(arr, (item) => {
					D.addText(item)
				})
			})
			await sleep()
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "123")
		})

		it("splices elements in the middle", async () => {
			const arr = new WatchedArray([1, 2, 3, 4])
			mount(() => {
				hyperfor(arr, (item) => {
					D.addText(item)
				})
				arr.splice(1, 2, "a", "b")
			})
			await sleep()
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "1ab4")
		})

		it("handles .startItem changing", async () => {
			const arr = new WatchedArray([1, 2, 3, 4])
			mount(() => {
				hyperfor(arr, (item) => {
					D.addText(item)
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
			mount(() => {
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

		it("does not reuse nodes when the entire array is replaced", async () => {
			const arr = new WatchedArray([1, 2, 3, 4])
			let twoNode1
			let twoNode2
			mount(() => {
				hyperfor(arr, (item) => {
					D.addText(item)
				})
				const nodes = Array.from(document.body.childNodes)
				twoNode1 = nodes.find(n => n.textContent === "2")
				arr.value([1, 2, 3, 4])
				twoNode2 = Array.from(document.body.childNodes).find(n => n.textContent === "2")
			})
			await sleep()
			assert.strictEqual(twoNode1 === twoNode2, false, "twoNode1 === twoNode2")
		})


		it("handles multiple splices inside a batch", async () => {
			const arr = new WatchedArray([1, 2, 3, 4])
			mount(() => {
				hyperfor(arr, (item) => {
					D.addText(item)
				})
				D.batch(() => {
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
			mount(() => {
				hyperfor(arr, (item) => {
					D.addText(item)
				})
				D.batch(() => {
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

		it("handles complete array replacent splices at the end of a batch", async () => {
			const arr = new WatchedArray([1, 2, 3, 4])
			mount(() => {
				hyperfor(arr, (item) => {
					D.addText(item)
				})
				D.batch(() => {
					arr.splice(0, 1) //234
					arr.splice(2, 1) //23
					arr.value([]) //
				})
			})
			await sleep()
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "")
		})

		it("renders indexes correctly (1)", async () => {
			const arr = new WatchedArray(["a", "b", "c", "d"])
			mount(() => {
				hyperfor(arr, (item, index) => {
					D.addText(() => item + index() + " ")
				})
			})
			await sleep()
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "a0 b1 c2 d3 ")
		})
		it("renders indexes correctly (2)", async () => {
			const arr = new WatchedArray(["a", "b", "c", "d"])
			mount(() => {
				hyperfor(arr, (item, index) => {
					D.addText(() => item + index() + " ")
				})
				D.batch(() => {
					arr.shift()
					arr.push("e")
				})
			})
			await sleep()
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "b0 c1 d2 e3 ")
		})

		it("handles errors in render (1)", async () => {
			const arr = new WatchedArray(["a", "b", "c"])
			mount(() => {
				hyperfor(arr, (item, index) => {
					if (item === "b") {
						throw new Error("Found a B!")
					}
					D.addText(() => item + index() + " ")
				})
			})
			await sleep()
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "a0 c2 ")
		})

		it("handles errors in render (2)", async () => {
			const arr = new WatchedArray(["a", "b"])
			mount(() => {
				hyperfor(arr, (item, index) => {
					if (item === "c") {
						throw new Error("Found a C!")
					}
					D.addText(() => item + index() + " ")
				})

				D.batch(() => {
					arr.push("c")
				})
			})
			await sleep()
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "a0 b1 ")
		})

		it("handles being in a D.addDynamic", async () => {
			const show = D.createSignal(true)
			const arr = new WatchedArray(["a", "b"])

			mount(() => {
				D.addDynamic(() => {
					if (show()) {
						hyperfor(arr, (item, index) => {
							D.addText(() => item + index() + " ")
						})
					} else {
						D.addText("nothing")
					}
				})
			})
			await sleep()

			D.batch(() => {
				arr.push("c")
				show(false)
			})
			await sleep()
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "nothing")
		})

		// fuzz for edge cases
		describe("passes randomly generated tests", () => {
			for (let i = 0; i < 1000; i++) {
				it("rand " + i, async () => {
					let pairList = []
					const actionsLog = []
					for (let addToInit = 0; addToInit < Math.random() * 5; addToInit++) {
						const v = Math.random().toString(16).substring(2, 4)
						pairList.push(v)
						actionsLog.push("push " + v)
					}

					actionsLog.push("init")

					let list = new WatchedArray(Array.from(pairList))

					mount(() => {
						hyperfor(list, (item) => {
							D.addText(item)
						})
					})

					for (let j = 0; j < Math.random() * 15; j++) {
						if (Math.random() < 0.1) {
							actionsLog.push("clear")
							pairList = []
							list.value([])
						} else {
							const startI = Math.floor(Math.random() * list.length)
							const remove = Math.floor((Math.random() * 3 - 1.5) * list.length)

							let toAdd = []
							for (let n = 0; n < Math.random() * 10; n++) {
								const v = Math.random().toString(16).substring(2, 4)
								toAdd.push(v)
							}

							list.splice(startI, remove, ...toAdd)
							pairList.splice(startI, remove, ...toAdd)
							actionsLog.push(`splice ${startI} ${remove} ${toAdd.join(" ")}`)
						}
					}

					await sleep()
					const hyperforOut = document.body.innerHTML.replace(/<\!--.*?-->/g, "")
					const expectedOut = Array.from(pairList).join("")
					if (hyperforOut !== expectedOut) {
						console.log(actionsLog.join("\n"))
					}

					assert.strictEqual(hyperforOut, expectedOut)
				})
			}
		})
	})


	describe("set hyperfor", () => {
		it("create elements", async () => {
			const list = new WatchedSet([1, 2, 3])
			mount(() => {
				hyperfor(list, (item) => {
					D.addText(item)
				})
			})
			await sleep()
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "123")
		})

		it("handles adding items", async () => {
			const list = new WatchedSet([1, 2, 3, 4])
			mount(() => {
				hyperfor(list, (item) => {
					D.addText(item)
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
			mount(() => {
				hyperfor(list, (item) => {
					D.addText(item)
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
			mount(() => {
				hyperfor(list, (item) => {
					D.addText(item)
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
			mount(() => {
				hyperfor(list, (item) => {
					D.addText(item)
				})
				list.delete(1)
			})
			await sleep()
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "234")
		})

		it("handles adding after endItem deleted", async () => {
			const list = new WatchedSet([1, 2, 3, 4])
			mount(() => {
				hyperfor(list, (item) => {
					D.addText(item)
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
			mount(() => {
				hyperfor(list, (item) => {
					D.addText(item)
				})
				twoNode1 = Array.from(document.body.childNodes).find(n => n.textContent === "2")
				list.delete(1)
				twoNode2 = Array.from(document.body.childNodes).find(n => n.textContent === "2")
			})
			await sleep()
			assert.strictEqual(twoNode1, twoNode2)
		})

		it("does not reuse nodes when the entire set is replaced", async () => {
			const list = new WatchedSet([1, 2, 3, 4])
			let twoNode1
			let twoNode2
			mount(() => {
				hyperfor(list, (item) => {
					D.addText(item)
				})
				const nodes = Array.from(document.body.childNodes)
				twoNode1 = nodes.find(n => n.textContent === "2")
				list.value(new Set([1, 2, 3, 4]))
				twoNode2 = Array.from(document.body.childNodes).find(n => n.textContent === "2")
			})
			await sleep()
			assert.strictEqual(twoNode1 === twoNode2, false, "twoNode1 === twoNode2")
		})


		it("handles multiple changes inside a batch", async () => {
			const list = new WatchedSet([1, 2, 3, 4])
			mount(() => {
				hyperfor(list, (item) => {
					D.addText(item)
				})
				D.batch(() => {
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
			mount(() => {
				hyperfor(list, (item) => {
					D.addText(item)
				})
				D.batch(() => {
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
			mount(() => {
				hyperfor(list, (item) => {
					D.addText(item)
				})
				D.batch(() => {
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
			mount(() => {
				hyperfor(list, (item, index) => {
					D.addText(() => item + index() + " ")
				})
			})
			await sleep()
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "a0 b1 c2 d3 ")
		})

		it("renders indexes correctly (2)", async () => {
			const list = new WatchedSet(["a", "b", "c", "d"])
			mount(() => {
				hyperfor(list, (item, index) => {
					D.addText(() => item + index() + " ")
				})
				D.batch(() => {
					list.delete("a")
					list.add("e")
				})
			})
			await sleep()
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "b0 c1 d2 e3 ")
		})

		it("handles errors in render (1)", async () => {
			const list = new WatchedSet(["a", "b", "c"])
			mount(() => {
				hyperfor(list, (item, index) => {
					if (item === "b") {
						throw new Error("Found a B!")
					}
					D.addText(() => item + index() + " ")
				})
			})
			await sleep()
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "a0 c2 ")
		})

		it("handles errors in render (2)", async () => {
			const list = new WatchedSet(["a", "b"])
			mount(() => {
				hyperfor(list, (item, index) => {
					if (item === "c") {
						throw new Error("Found a C!")
					}
					D.addText(() => item + index() + " ")
				})

				D.batch(() => {
					list.add("c")
				})
			})
			await sleep()
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "a0 b1 ")
		})

		it("handles being in a D.addDynamic", async () => {
			const show = D.createSignal(true)
			const list = new WatchedSet(["a", "b"])

			mount(() => {
				D.addDynamic(() => {
					if (show()) {
						hyperfor(list, (item, index) => {
							D.addText(() => item + index() + " ")
						})
					} else {
						D.addText("nothing")
					}
				})
			})
			await sleep()

			D.batch(() => {
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
						const v = Math.random().toString(16).substring(2, 4)
						pairList.add(v)
						actionsLog.push("add " + v)
					}

					actionsLog.push("init")

					const list = new WatchedSet(Array.from(pairList))

					mount(() => {
						hyperfor(list, (item) => {
							D.addText(item)
						})
					})

					for (let j = 0; j < Math.random() * 15; j++) {
						const n = Math.floor(Math.random() * 4)
						if (n === 0) {
							if (Math.random < 0.5) {
								list.clear()
								pairList.clear()
								actionsLog.push("clear")
							} else {
								pairList = new Set()
								list.value(new Set())
								actionsLog.push("reset")
							}
						} else if (n === 1) {
							if (actionsLog.at(-1) === "sleep") {
								continue
							}
							actionsLog.push("sleep")
							await sleep()
						} else if (n === 2) {
							if (Math.random() < 0.5) {
								const v = Array.from(pairList)[Math.floor(pairList.size * Math.random())] ?? "x"
								list.delete(v)
								pairList.delete(v)
								actionsLog.push("delete " + v)
							} else {
								const v = Math.random().toString(16).substring(2, 4)
								list.delete(v)
								pairList.delete(v)
								actionsLog.push("delete " + v)
							}
						} else {
							if (Math.random() < 0.5) {
								const v = Array.from(pairList)[Math.floor(pairList.size * Math.random())] ?? "x"
								list.add(v)
								pairList.add(v)
								actionsLog.push("add " + v)
							} else {
								const v = Math.random().toString(16).substring(2, 4)
								list.add(v)
								pairList.add(v)
								actionsLog.push("add " + v)
							}
						}
					}

					await sleep()
					const hyperforOut = document.body.innerHTML.replace(/<\!--.*?-->/g, "")
					const expectedOut = Array.from(pairList).join("")

					assert.strictEqual(hyperforOut, expectedOut, actionsLog.join(", "))
				})
			}
		})
	})


	describe("map hyperfor", () => {
		it("create elements", async () => {
			const list = new WatchedMap([[1, "a"], [2, "b"]])
			mount(() => {
				hyperfor(list, ([k, v]) => {
					D.addText(k + "=" + v + ";")
				})
			})
			await sleep()
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "1=a;2=b;")
		})

		it("handles adding items", async () => {
			const list = new WatchedMap([[1, "a"], [2, "b"]])
			mount(() => {
				hyperfor(list, ([k, v]) => {
					D.addText(k + "=" + v + ";")
				})
				list.set(3, "c")
			})
			await sleep()
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "1=a;2=b;3=c;")
		})


		it("handles deleting and re-adding items", async () => {
			const list = new WatchedMap([[1, "a"], [2, "b"]])
			mount(() => {
				hyperfor(list, ([k, v]) => {
					D.addText(k + "=" + v + ";")
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
			mount(() => {
				hyperfor(list, ([k, v]) => {
					D.addText(k + "=" + v + ";")
				})
				list.delete(1)
			})
			await sleep()
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "2=b;3=c;")
		})

		it("handles updating a value (1)", async () => {
			const list = new WatchedMap([[1, "a"], [2, "b"], [3, "c"]])
			mount(() => {
				hyperfor(list, ([k, v]) => {
					D.addText(k + "=" + v + ";")
				})
			})
			await sleep()
			list.set(1, "x")
			await sleep()
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "1=x;2=b;3=c;")
		})

		it("handles updating a value (2)", async () => {
			const list = new WatchedMap([[1, "a"], [2, "b"], [3, "c"]])
			mount(() => {
				hyperfor(list, ([k, v]) => {
					D.addText(k + "=" + v + ";")
				})
			})
			await sleep()
			list.set(3, "x")
			await sleep()
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "1=a;2=b;3=x;")
		})

		it("handles updating a value (3)", async () => {
			const list = new WatchedMap([[1, "a"]])
			mount(() => {
				hyperfor(list, ([k, v]) => {
					D.addText(k + "=" + v + ";")
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
			mount(() => {
				hyperfor(list, ([k, v]) => {
					D.addText(k + "=" + v + ";")
				})
				twoNode1 = Array.from(document.body.childNodes).find(n => n.textContent === "2=b;")
				list.delete(1)
				twoNode2 = Array.from(document.body.childNodes).find(n => n.textContent === "2=b;")
			})
			await sleep()
			assert.strictEqual(twoNode1, twoNode2)
		})

		it("does not reuse nodes when the entire set is replaced", async () => {
			const list = new WatchedMap([[1, "a"], [2, "b"], [3, "c"]])
			let twoNode1
			let twoNode2
			mount(() => {
				hyperfor(list, ([k, v]) => {
					D.addText(k + "=" + v + ";")
				})
				twoNode1 = Array.from(document.body.childNodes).find(n => n.textContent === "2=b;")
				list.value(new Map([[1, "a"], [2, "b"], [3, "c"]]))
				twoNode2 = Array.from(document.body.childNodes).find(n => n.textContent === "2=b;")
			})
			await sleep()
			assert.strictEqual(twoNode1 === twoNode2, false, "twoNode1 === twoNode2")
		})

		it("does not reuse nodes when an element value is set", async () => {
			const list = new WatchedMap([[1, "a"], [2, "b"], [3, "c"]])
			let twoNode1
			let twoNode2
			mount(() => {
				hyperfor(list, ([k, v]) => {
					D.addText(k + "=" + v + ";")
				})

			})
			twoNode1 = Array.from(document.body.childNodes).find(n => n.textContent === "2=b;")
			list.set(2, "b") // notice value is not changed
			await sleep()
			twoNode2 = Array.from(document.body.childNodes).find(n => n.textContent === "2=b;")
			await sleep()
			assert.strictEqual(twoNode1 === twoNode2, false, "twoNode1 === twoNode2")
		})

		it("handles multiple changes inside a batch", async () => {
			const list = new WatchedMap([[1, "a"], [2, "b"], [3, "c"]])
			mount(() => {
				hyperfor(list, ([k, v]) => {
					D.addText(k + "=" + v + ";")
				})
				D.batch(() => {
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
			mount(() => {
				hyperfor(list, ([k, v]) => {
					D.addText(k + "=" + v + ";")
				})
				D.batch(() => {
					list.delete(1)
					list.delete(10)
					list.value(new WatchedMap([[8, "x"]]))
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
			mount(() => {
				hyperfor(list, ([k, v]) => {
					D.addText(k + "=" + v + ";")
				})
				D.batch(() => {
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
			mount(() => {
				hyperfor(list, ([k, v], index) => {
					D.addText(() => k + index() + "=" + v + ";")
				})
			})
			await sleep()
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "a0=x;b1=y;c2=z;")
		})

		it("renders indexes correctly (2)", async () => {
			const list = new WatchedMap([["a", "x"], ["b", "y"], ["c", "z"]])
			mount(() => {
				hyperfor(list, ([k, v], index) => {
					D.addText(() => k + index() + "=" + v + ";")
				})
				D.batch(() => {
					list.delete("a")
					list.set("d", "w")
				})
			})
			await sleep()
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "b0=y;c1=z;d2=w;")
		})

		it("handles errors in render (1)", async () => {
			const list = new WatchedMap([["a", "x"], ["b", "y"], ["c", "z"]])
			mount(() => {
				hyperfor(list, ([k, v], index) => {
					if (k === "b") {
						throw new Error("Found a B!")
					}
					D.addText(() => k + index() + "=" + v + ";")
				})
			})
			await sleep()
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "a0=x;c2=z;")
		})

		it("handles errors in render (2)", async () => {
			const list = new WatchedMap([["a", "x"], ["b", "y"]])
			mount(() => {
				hyperfor(list, ([k, v], index) => {
					if (k === "c") {
						throw new Error("Found a C!")
					}
					D.addText(() => k + index() + "=" + v + ";")
				})

				D.batch(() => {
					list.set("c", "z")
				})
			})
			await sleep()
			assert.strictEqual(document.body.innerHTML.replace(/<\!--.*?-->/g, ""), "a0=x;b1=y;")
		})

		it("handles being in a D.addDynamic", async () => {
			const show = D.createSignal(true)
			const list = new WatchedMap([["a", "x"], ["b", "y"]])

			mount(() => {
				D.addDynamic(() => {
					if (show()) {
						hyperfor(list, ([k, v], index) => {
							D.addText(() => k + index() + "=" + v + ";")
						})
					} else {
						D.addText("nothing")
					}
				})
			})
			await sleep()

			D.batch(() => {
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
						const k = Math.random().toString(16).substring(2, 4)
						const v = Math.random().toString(16).substring(2, 4)
						pairList.set(k, v)
						actionsLog.push(`set ${k}=${v}`)
					}

					actionsLog.push("init")

					const list = new WatchedMap(Array.from(pairList))

					mount(() => {
						hyperfor(list, ([k, v], index) => {
							D.addText(k + "=" + v + ";")
						})
					})

					for (let j = 0; j < Math.random() * 15; j++) {
						const n = Math.floor(Math.random() * 4)
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
						} else if (n === 1) {
							if (actionsLog.at(-1) === "sleep") {
								continue
							}
							actionsLog.push("sleep")
							await sleep()
						} else if (n === 2) {
							if (Math.random() < 0.5) {
								const k = Array.from(pairList.keys())[Math.floor(pairList.size * Math.random())] ?? "x"
								list.delete(k)
								pairList.delete(k)
								actionsLog.push("delete " + k)
							} else {
								const k = Math.random().toString(16).substring(2, 4)
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
									const v = Math.random().toString(16).substring(2, 4)
									list.set(k, v)
									pairList.set(k, v)
									actionsLog.push(`set ${k}=${v}`)
								}
							} else {
								const k = Math.random().toString(16).substring(2, 4)
								const v = Math.random().toString(16).substring(2, 4)
								list.set(k, v)
								pairList.set(k, v)
								actionsLog.push(`set ${k}=${v}`)
							}
						}
					}

					await sleep()
					const hyperforOut = document.body.innerHTML.replace(/<\!--.*?-->/g, "")
					const expectedOut = Array.from(pairList).map(([k, v]) => k + "=" + v + ";").join("")

					assert.strictEqual(hyperforOut, expectedOut, actionsLog.join(", "))
				})
			}
		})
	})
})

