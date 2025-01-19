import { createSignal, toSignal, createEffect, stashState, $s, createMemo, onUpdate, onWrite, onCleanup, createRoot, untrack, sample, retrack, batch, assertStatic, subclock, _getInternalState, runWithOwner, Owner, getOwner, createContext, useContext, runWithContext, ReactiveArray } from "../built/state.js"

process.on('unhandledRejection', (reason) => {
	console.log("unhandled rejection", reason)
	throw reason
})

function serializer(target, load, store) {
	const silencedData = silenceEcho(target)

	createEffect(() => {
		const data = silencedData()
		batch(() => {
			untrack(() => {
				load(data)
			})
		})

		let firstTime = true
		createEffect(() => {
			const out = store()
			if (!firstTime) {
				silencedData(out)
			}
			firstTime = false
		})
	})
}

function silenceEcho(signal) {
	const fire = createSignal(true, true)

	let updateFromHere = false
	createEffect(() => {
		signal()
		if (!updateFromHere) {
			fire(true)
		}
	})

	return toSignal(() => {
		fire()
		return sample(signal)
	}, (val) => {
		updateFromHere = true
		subclock(() => {
			signal(val)
		})
		updateFromHere = false
	})
}

function sleep(ms = 1) {
	return new Promise((resolve) => {
		setTimeout(() => {
			resolve()
		}, ms)
	})
}

describe("@dynein/state", () => {
	describe("createSignal", () => {
		it("disallows multiple arguments to set", () => {
			const signal = createSignal(1)
			assert.throws(() => signal(2, 3, 4))
		})

		it("returns the initial value", () => {
			assert.strictEqual(createSignal(1)(), 1)
		})

		it("sets the value", () => {
			const signal = createSignal(1)
			signal(2)
			assert.strictEqual(signal(), 2)
		})

		it("sets the value for sample", () => {
			const signal = createSignal(1)
			signal(2)
			assert.strictEqual(sample(signal), 2)
		})
	})

	describe("createRoot", () => {
		it("passes errors", () => {
			assert.throws(() => {
				createRoot(() => {
					throw new Error("err")
				})
			})
		})

		it("restores current computation after throw", () => {
			const before = _getInternalState().currentOwnerOwner
			try {
				createRoot(() => {
					throw new Error("err")
				})
			} catch (err) { }
			assert.strictEqual(_getInternalState().currentOwnerOwner, before)
		})
	})

	describe("createEffect", () => {
		it("disallows 0 arguments", () => {
			createRoot(() => {
				assert.throws(() => createEffect())
			})
		})

		it("creates a watcher", () => {
			createRoot(() => {
				assert.doesNotThrow(() => {
					const signal = createSignal(0)
					createEffect(() => {
						signal()
					})
				})
			})
		})

		it("reexecutes on dependency update", () => {
			const signal = createSignal(0)
			let count = 0
			createRoot(() => {
				createEffect(() => {
					count++
					signal()
				})
			})
			assert.strictEqual(count, 1)
			signal(1)
			assert.strictEqual(count, 2)
		})

		it("reexecutes for each dependency update", () => {
			const a = createSignal(0)
			const b = createSignal(0)
			let count = 0
			createRoot(() => {
				createEffect(() => {
					count++
					a()
					b()
				})
			})
			assert.strictEqual(count, 1)
			a(1)
			assert.strictEqual(count, 2)
			b(1)
			assert.strictEqual(count, 3)
		})

		it("does not reexecute on equal value update", () => {
			const signal = createSignal(0)
			let count = 0
			createRoot(() => {
				createEffect(() => {
					count++
					signal()
				})
			})
			assert.strictEqual(count, 1)
			signal(0)
			assert.strictEqual(count, 1)
		})

		it("does reexecute on equal data update", () => {
			const signal = createSignal(0, true)
			let count = 0
			createRoot(() => {
				createEffect(() => {
					count++
					signal()
				})
			})
			assert.strictEqual(count, 1)
			signal(0)
			assert.strictEqual(count, 2)
		})

		it("resets dependencies on recompute", () => {
			let phase = createSignal(false)
			const a = createSignal(0)
			const b = createSignal(0)
			let count = 0
			createRoot(() => {
				createEffect(() => {
					count++
					if (!phase()) {
						a()
					} else {
						b()
					}
				})
			})
			assert.strictEqual(count, 1)
			a(1)
			assert.strictEqual(count, 2)
			b(1)
			assert.strictEqual(count, 2)
			phase(true)
			assert.strictEqual(count, 3)
			a(2)
			assert.strictEqual(count, 3)
			b(2)
			assert.strictEqual(count, 4)
		})

		it("encapsulates dependencies", () => {
			let signal = createSignal(0)
			let outerCount = 0
			let innerCount = 0
			createRoot(() => {
				createEffect(() => {
					outerCount++
					createEffect(() => {
						innerCount++
						signal()
					})
				})
			})
			assert.strictEqual(outerCount, 1)
			assert.strictEqual(innerCount, 1)
			signal(1)
			assert.strictEqual(outerCount, 1)
			assert.strictEqual(innerCount, 2)
		})

		it("destroys subwatchers on recompute", () => {
			let innerWatch = createSignal(true)
			let signal = createSignal(0)
			let outerCount = 0
			let innerCount = 0
			createRoot(() => {
				createEffect(() => {
					outerCount++
					if (innerWatch()) {
						createEffect(() => {
							innerCount++
							signal()
						})
					}
				})
			})
			assert.strictEqual(outerCount, 1)
			assert.strictEqual(innerCount, 1)
			signal(1)
			assert.strictEqual(outerCount, 1)
			assert.strictEqual(innerCount, 2)
			innerWatch(false)
			assert.strictEqual(outerCount, 2)
			assert.strictEqual(innerCount, 2)
			signal(2)
			assert.strictEqual(outerCount, 2)
			assert.strictEqual(innerCount, 2)
		})

		it("handles signal-triggered destruction of parent within child (1)", () => {
			let order = ""
			const a = createSignal("")
			createRoot(() => {
				createEffect(() => {
					order += "outer{"
					const b = createSignal("")
					createEffect(() => {
						order += "inner{"
						b(a())

						createEffect(() => {

						})
						order += "}inner "
					})
					b()
					order += "}outer "
				})
			})
			order = ""
			assert.doesNotThrow(() => {
				a("a")
			})
			assert.strictEqual(order, "inner{}inner outer{inner{}inner }outer ")
		})

		it("handles signal-triggered destruction of parent within child (2)", () => {
			const signal = createSignal(0)
			const owner = new Owner(null)

			let order = ""
			runWithOwner(owner, () => {
				createEffect(() => {
					onCleanup(() => {
						order += "cleanup outer "
					})
					order += `run outer(${signal()}) `

					if (signal() === 0) {
						createEffect(() => {
							onCleanup(() => {
								order += "cleanup inner 1 "
							})
							order += "run inner 1 "

							order += "outer destroy{"
							signal(1)
							order += "}outer destroy "
						})

						createEffect(() => {
							onCleanup(() => {
								order += "cleanup inner 2 "
							})
							order += "run inner 2 "
						})
						order += "outer done "
					}
				})
			})

			// Notice this is basically identical to the below test
			assert.strictEqual(order, "run outer(0) run inner 1 outer destroy{cleanup outer cleanup inner 1 }outer destroy run inner 2 outer done cleanup inner 2 run outer(1) ")
		})

		it("handles forced destruction of parent within child", () => {
			const owner = new Owner(null)

			let order = ""
			runWithOwner(owner, () => {
				createEffect(() => {
					onCleanup(() => {
						order += "cleanup outer "
					})
					order += `run outer `

					createEffect(() => {
						onCleanup(() => {
							order += "cleanup inner 1 "
						})
						order += "run inner 1 "

						order += "outer destroy{"
						owner.destroy()
						order += "}outer destroy "
					})

					createEffect(() => {
						onCleanup(() => {
							order += "cleanup inner 2 "
						})
						order += "run inner 2 "
					})
					order += "outer done "
				})
			})

			// Notice this is basically identical to the above test
			assert.strictEqual(order, "run outer run inner 1 outer destroy{cleanup outer cleanup inner 1 }outer destroy run inner 2 outer done cleanup inner 2 ")
		})

		it("calls cleanup", () => {
			let innerWatch = createSignal(true)
			let signal = createSignal(0)
			let cleanupACount = 0
			let cleanupBCount = 0
			createRoot(() => {
				createEffect(() => {
					if (innerWatch()) {
						createEffect(() => {
							signal()
							onCleanup(() => {
								cleanupACount++
							})
						})
						onCleanup(() => {
							cleanupBCount++
						})
					}
				})
			})
			assert.strictEqual(cleanupACount, 0)
			assert.strictEqual(cleanupBCount, 0)
			signal(1)
			assert.strictEqual(cleanupACount, 1)
			assert.strictEqual(cleanupBCount, 0)
			signal(2)
			assert.strictEqual(cleanupACount, 2)
			assert.strictEqual(cleanupBCount, 0)
			innerWatch(false)
			assert.strictEqual(cleanupACount, 3)
			assert.strictEqual(cleanupBCount, 1)
			innerWatch(0)
			assert.strictEqual(cleanupACount, 3)
			assert.strictEqual(cleanupBCount, 1)
		})

		it("can be manually destroyed", () => {
			const signal = createSignal(0)
			let count = 0
			let watcher
			createRoot(() => {
				watcher = createEffect(() => {
					count++
					signal()
				})
			})
			assert.strictEqual(count, 1)
			signal(1)
			assert.strictEqual(count, 2)
			watcher.destroy()
			signal(2)
			assert.strictEqual(count, 2)
		})

		it("does not leak the internal Computation instance", () => {
			createRoot(() => {
				createEffect(function () {
					assert.strictEqual(this, undefined)
				})
			})
		})

		it("passes errors", () => {
			createRoot(() => {
				assert.throws(() => {
					createEffect(() => {
						throw new Error("err")
					})
				})
			})
		})

		it("restores current computation after throw", () => {
			createRoot(() => {
				const before = _getInternalState().currentOwner
				try {
					createEffect(() => {
						throw new Error("err")
					})
				} catch (err) { }
				assert.strictEqual(_getInternalState().currentOwner, before)
			})
		})

		it("keeps running if there are more changes", () => {
			const signal = createSignal(0)
			let count = 0
			createRoot(() => {
				createEffect(() => {
					count++
					if (signal() >= 1 && signal() < 5) {
						signal(signal() + 1)
					}
				})
			})
			assert.strictEqual(count, 1)
			signal(1)
			assert.strictEqual(count, 6)
			assert.strictEqual(signal(), 5)
		})

		it("executes in order (test 1)", () => {
			const p1 = createSignal(0)
			const p2 = createSignal(0)
			const p3 = createSignal(0)
			const p4 = createSignal(0)

			/*


			  1
			/   \
			A    B
			|    |
			2	 3
			|    |
			C    |
			|    |
			4    |
			\   /
			  D

			Tick 0
				Set 1
					Add A, B to Tick 1
			Tick 1
				Exec A
					Set 2
						Add C to Tick 2
				Exec B
					Set 3
						Add D to Tick 2
			Tick 2
				Exec C
					Set 4
						Try add D to Tick 3, but cancelled since already in Tick 2
				Exec D
			Tick 3
				[nothing]
			*/

			let order = ""
			createRoot(() => {
				createEffect(() => {
					order += "D{"
					p3()
					p4()
					order += "}D "
				})
				createEffect(() => {
					order += "C{"
					p4(p2() + Math.random())
					order += "}C "
				})

				createEffect(() => {
					order += "A{"
					p2(p1() + Math.random())
					order += "}A "
				})
				createEffect(() => {
					order += "B{"
					p3(p1() + Math.random())
					order += "}B "
				})
			})
			assert.strictEqual(order, "D{}D C{}C D{}D A{}A C{}C D{}D B{}B D{}D ", "init")
			order = ""
			p1(1)
			assert.strictEqual(order, "A{}A B{}B C{}C D{}D ", "after set")
		})

		it("executes in order (test 2)", () => {
			const p1 = createSignal(0)
			const p2 = createSignal(0)
			const p3 = createSignal(0)
			const p4 = createSignal(0)

			/*


				1
			/   \
			A      B
			|      |
			2	   3
			|      |
			C      |
			|      |
			4      |
			\   /
				D
			*/

			let order = ""
			createRoot(() => {
				createEffect(() => {
					order += "C{"
					p4(p2() + 1)
					order += "}C "
				})
				createEffect(() => {
					order += "D{"
					p3()
					p4()
					order += "}D "
				})

				createEffect(() => {
					order += "A{"
					p2(p1() + 1)
					order += "}A "
				})
				createEffect(() => {
					order += "B{"
					p3(p1() + 5)
					order += "}B "
				})
			})
			assert.strictEqual(order, "C{}C D{}D A{}A C{}C D{}D B{}B D{}D ", "init")
			order = ""
			p1(1)
			assert.strictEqual(order, "A{}A B{}B C{}C D{}D ", "after set")
		})

		it("executes in order (test 3)", () => {
			const p1 = createSignal(0)
			const p2 = createSignal(0)
			const p3 = createSignal(0)
			const p4 = createSignal(0)

			/*


				1
			/   \
			A      B
			|      |
			2	   3
			|      |
			C      |
			|      |
			4      |
			\   /
				D
			*/

			let order = ""
			createRoot(() => {
				createEffect(() => {
					order += "C{"
					p4(p2() + 1)
					order += "}C "
				})
				createEffect(() => {
					order += "D{"
					p3()
					p4()
					order += "}D "
				})
				createEffect(() => {
					order += "B{"
					p3(p1() + 5)
					order += "}B "
				})
				createEffect(() => {
					order += "A{"
					p2(p1() + 1)
					order += "}A "
				})
			})
			assert.strictEqual(order, "C{}C D{}D B{}B D{}D A{}A C{}C D{}D ", "init")
			order = ""
			p1(1)
			assert.strictEqual(order, "B{}B A{}A D{}D C{}C D{}D ", "after set")
		})

		it("executes nested effects in order", () => {
			const signal = createSignal(0)
			let order = ""
			createRoot(() => {
				createEffect(() => {
					onCleanup(() => {
						order += "!A1 "
					})

					order += "A{" + signal() + " "
					createEffect(() => {
						order += "B{" + signal() + " "
						order += "}B "

						onCleanup(() => {
							order += "!B "
						})
					})
					order += "}A "
					onCleanup(() => {
						order += "!A2 "
					})
				})
			})

			assert.strictEqual(order, "A{0 B{0 }B }A ", "init")
			order = ""
			signal(1)
			assert.strictEqual(order, "!A1 !B !A2 A{1 B{1 }B }A ", "after set")
		})


		it("delays execution when in watch init", () => {
			const signal = createSignal(0)
			let order = ""
			createRoot(() => {
				createEffect(() => {
					order += "A{"
					signal()
					order += "}A "
				})
				createEffect(() => {
					order += "B{"
					signal(1)
					order += "}B "
				})
			})
			assert.strictEqual(order, "A{}A B{}B A{}A ")
		})

		it("delays execution when in watch execute", () => {
			const a = createSignal(1)
			const signal = createSignal(0)
			let order = ""
			createRoot(() => {
				createEffect(() => {
					order += "A{"
					signal()
					order += "}A "
				})
				createEffect(() => {
					order += "B{"
					signal(a())
					order += "}B "
				})
			})
			order = ""
			a(2)
			assert.strictEqual(order, "B{}B A{}A ")
		})

		it("batches second stage changes", () => {
			const a = createSignal(0)
			const b = createSignal(0)
			let order = ""
			createRoot(() => {
				createEffect(() => {
					order += "A{" + a()
					order += "}A "
				})
				createEffect(() => {
					order += "B{" + b()
					order += "}B "
				})
				createEffect(() => {
					order += "s{" + a() + " "
					if (a() >= 1 && a() < 3) {
						order += "a++{"
						a(a() + 1)
						order += "}a++ "

						order += "b++{"
						b(b() + 1)
						order += "}b++ "
					}
					order += "}s "
				})
			})
			assert.strictEqual(order, "A{0}A B{0}B s{0 }s ")
			order = ""
			a(1)
			assert.strictEqual(order, "A{1}A s{1 a++{}a++ b++{}b++ }s A{2}A s{2 a++{}a++ b++{}b++ }s B{2}B A{3}A s{3 }s ")
		})

		it("subclock (test 1)", () => {
			const a = createSignal(0)
			const b = createSignal(0)
			let order = ""
			createRoot(() => {
				createEffect(() => {
					order += "A{" + a()
					order += "}A "
				})
				createEffect(() => {
					order += "B{" + b()
					order += "}B "
				})
				createEffect(() => {
					order += "s{" + a() + " "
					if (a() >= 1 && a() < 3) {
						order += "a++{"
						a(a() + 1)
						order += "}a++ "

						order += "b++{"
						subclock(() => {
							b(sample(b) + 1)
						})
						order += "}b++ "
					}
					order += "}s "
				})
			})
			assert.strictEqual(order, "A{0}A B{0}B s{0 }s ")
			order = ""
			a(1)
			assert.strictEqual(order, "A{1}A s{1 a++{}a++ b++{B{1}B }b++ }s A{2}A s{2 a++{}a++ b++{B{2}B }b++ }s A{3}A s{3 }s ")
		})

		it("subclock (test 2)", () => {
			const a = createSignal(0)
			const b = createSignal(0)
			let order = ""

			let level = 0
			const log = (v) => {
				if (v.includes("}")) {
					level--
				}
				//console.log("    ".repeat(level)+v)
				if (v.includes("{")) {
					level++
				}
				order += v
				return v
			}


			createRoot(() => {
				createEffect(() => {
					log("A{" + a())
					log("}A ")
				})
				createEffect(() => {
					log("B{" + b())
					log("}B ")
				})
				createEffect(() => {
					log("s{" + a() + " ")
					if (a() >= 1 && a() < 3) {
						log("a++{")
						a(a() + 1)
						log("}a++ ")

						log("b++{")
						const newB = sample(b) + 1
						b(Math.random()) //schedule to fire
						subclock(() => {
							subclock(() => {
								subclock(() => {
									log("subclock{")
									subclock(() => {
										log("inner{" + newB + " ")
										b(newB) //this should cancel refiring
										log("}inner ")
									})
									log("}subclock ")
								})
							})
						})
						log("}b++ ")
					}
					log("}s ")
				})
			})
			assert.strictEqual(order, "A{0}A B{0}B s{0 }s ")
			order = ""
			a(1)
			assert.strictEqual(order, "A{1}A s{1 a++{}a++ b++{subclock{inner{1 B{1}B }inner }subclock }b++ }s A{2}A s{2 a++{}a++ b++{subclock{inner{2 B{2}B }inner }subclock }b++ }s A{3}A s{3 }s ")
		})

		it("subclock passes errors without breaking parent update", () => {
			const a = createSignal(0)
			const b = createSignal(0)
			let order = ""
			createRoot(() => {
				createEffect(() => {
					order += "A{" + a()
					order += "}A "
				})
				createEffect(() => {
					order += "B{" + b()
					order += "}B "
				})
				createEffect(() => {
					order += "s{" + a() + " "
					if (a() >= 1 && a() < 3) {
						order += "a++{"
						a(a() + 1)
						order += "}a++ "

						order += "b++{"
						subclock(() => {
							order += "Sclock{"
							b(sample(b) + 1)
							throw new Error("test")
						})
						order += "}b++ "
					}
					order += "}s "
				})
			})
			assert.strictEqual(order, "A{0}A B{0}B s{0 }s ")
			order = ""
			a(1)
			assert.strictEqual(order, "A{1}A s{1 a++{}a++ b++{Sclock{B{1}B A{2}A s{2 a++{}a++ b++{Sclock{B{2}B A{3}A s{3 }s ")
		})

		// See https://github.com/adamhaile/S/issues/32
		// Basically, the data().length shouldn't be run when data() is null
		it("Sjs issue 32", () => {
			let log = ""
			createRoot(() => {
				const data = createSignal(null, true)
				const cache = createSignal(sample(() => !!data()))
				const child = data => {
					createEffect(() => {
						log += "nested " + data().length + " "
					})
					return "Hi"
				}
				createEffect(() => {
					cache(!!data())
				})
				const memo = createMemo(() => (cache() ? child(data) : undefined))
				createEffect(() => {
					log += "view " + memo() + " "
				})
				log += "ON "
				data("name")
				log += "OFF "
				data(undefined)
			})

			assert.strictEqual(log, "view undefined ON nested 4 view Hi OFF view undefined ")
		})

		it("effect created inside an exec-pending effect", () => {
			const a = createSignal(0)
			const b = createSignal(0)

			let idCounter = 0
			let order = ""
			createRoot(() => {
				createEffect(() => {
					const id = (idCounter++)
					onCleanup(() => {
						order += `cleanup outer(${id}) `
					})
					order += `outer(${id}) { `
					if (!a()) {
						order += "set a { "
						a(true)
						order += "} set a "
					}

					order += `create inner(${id}) `
					createEffect(() => {
						onCleanup(() => {
							order += `cleanup inner(${id}) `
						})
						b()
						order += `run inner(${id}) `
					})
					order += `} outer(${id}) `
				})
			})
			assert.strictEqual(order, "outer(0) { set a { cleanup outer(0) } set a create inner(0) run inner(0) } outer(0) cleanup inner(0) outer(1) { create inner(1) run inner(1) } outer(1) ")
			order = ""
			b(1)
			assert.strictEqual(order, "cleanup inner(1) run inner(1) ")
		})

		// This test maybe isn't the most preferable behavior, but its an edge case and
		// there doesn't seem to be an easy way to fix it. In real world-scenarios where you have
		// a self-triggering effect like this (e.g., effect checks a precondition and then
		// fixes it), you should probably return at the end of the `if (!a()) {` block and then
		// the inner effect wouldn't be created twice.
		//
		// Maybe I'll revisit this in the future, but for now this case is undefined behavior,
		// and tested here to document it and make it easy to notice if some future edit to Dynein
		// changes it.
		it("executes but doesn't create an effect created inside an exec-pending effect (subclock) (undefined behavior)", () => {
			const a = createSignal(0)
			const b = createSignal(0)

			let idCounter = 0
			let order = ""
			createRoot(() => {
				createEffect(() => {
					const id = (idCounter++)
					onCleanup(() => {
						order += `cleanup outer(${id}) `
					})
					order += `outer(${id}) { `
					if (!a()) {
						order += "set a { "
						subclock(() => {
							a(true)
						})
						order += "} set a "
					}

					order += `create inner(${id}) `
					createEffect(() => {
						b()
						order += `run inner(${id}) `
					})
					order += `} outer(${id}) `
				})
			})
			assert.strictEqual(order, "outer(0) { set a { cleanup outer(0) outer(1) { create inner(1) run inner(1) } outer(1) } set a create inner(0) run inner(0) } outer(0) ")
			order = ""
			b(1)
			assert.strictEqual(order, "run inner(1) run inner(0) ")
		})

		it("doesn't reexecute a destroy-pending watcher", () => {
			const a = createSignal(false)
			const b = createSignal(false)

			let order = ""
			createRoot(() => {
				createEffect(() => {
					order += "outer "
					if (!a()) {
						createEffect(() => {
							order += "inner "
							b()
						})
					}
				})
			})
			order = ""
			batch(() => {
				order += "set b "
				b(true)
				order += "set a "
				a(true)
			})
			assert.strictEqual(order, "set b set a outer ")
		})

		it("doesn't execute a watcher forcibly destroyed during a run", () => {
			const signal = createSignal(0)
			let order = ""

			let secondEffect
			createRoot(() => {
				createEffect(() => {
					order += "A{" + signal() + " "
					if (signal() === 1) {
						secondEffect.destroy()
					}
					onCleanup(() => {
						order += "!A "
					})
					order += "}A "
				})

				secondEffect = createEffect(() => {
					order += "B{" + signal() + " "
					onCleanup(() => {
						order += "!B "
					})
					order += "}B "
				})
			})

			assert.strictEqual(order, "A{0 }A B{0 }B ", "init")
			order = ""
			signal(1)
			assert.strictEqual(order, "!A !B A{1 }A ", "after set")
		})

		it("restores own context values on re-execute", () => {
			let ctx = createContext(undefined)
			const signal = createSignal(0)

			let order = ""
			createRoot(() => {
				runWithContext(ctx, 1, () => {
					order += "init "
					createEffect(() => {
						signal()
						order += `run ${useContext(ctx)} `
					})
				})
			})

			order += `update (undefined) { `
			signal(5)
			order += `} `

			order += `update (2) { `
			runWithContext(ctx, 2, () => {
				signal(10)
			})
			order += `} `

			assert.strictEqual(order, "init run 1 update (undefined) { run 1 } update (2) { run 1 } ")
		})
	})

	describe("createEffect (async)", () => {

		it("handles synchronous deps", async () => {
			const signal = createSignal(0)
			let order = ""

			createRoot(() => {
				createEffect(async () => {
					order += "run " + signal()
				})
			})
			assert.strictEqual(order, "run 0")
			order = ""
			await sleep(5)
			signal(1)
			assert.strictEqual(order, "run 1")
		})


		it("handles async deps", async () => {
			const a = createSignal(0)
			const b = createSignal(0)
			let order = ""

			createRoot(() => {
				createEffect(async () => {
					order += "a = " + a()
					await $s(sleep(0))
					order += " b = " + b()
				})
			})

			assert.strictEqual(order, "a = 0")
			await sleep(30)
			assert.strictEqual(order, "a = 0 b = 0")
			order = ""
			b(1)
			assert.strictEqual(order, "a = 0")
			await sleep(5)
			assert.strictEqual(order, "a = 0 b = 1")
		})

		it("doesn't re-run when triggered while running", async () => {
			const a = createSignal(0)

			let order = ""
			createRoot(() => {
				createEffect(async () => {
					order += "a = " + a()
					await $s(sleep(20))
					order += " done "
				})
			})

			assert.strictEqual(order, "a = 0")
			a(1)
			assert.strictEqual(order, "a = 0")
			await sleep(5)
			a(2)
			assert.strictEqual(order, "a = 0")
			await sleep(20)
			assert.strictEqual(order, "a = 0 done a = 2")
			await sleep(20)
			assert.strictEqual(order, "a = 0 done a = 2 done ")
		})

		it("calls onCleanup as expected", async () => {
			const a = createSignal(0)

			let order = ""
			createRoot(() => {
				createEffect(async () => {
					onCleanup(() => {
						order += "onCleanup "
					})
					order += "a = " + a() + " "
					await $s(sleep(20))
					order += "done "
				})
			})

			assert.strictEqual(order, "a = 0 ")
			a(1)
			assert.strictEqual(order, "a = 0 onCleanup ")
			await sleep(5)
			a(2)
			assert.strictEqual(order, "a = 0 onCleanup ")
			await sleep(20)
			assert.strictEqual(order, "a = 0 onCleanup done a = 2 ")
			await sleep(20)
			assert.strictEqual(order, "a = 0 onCleanup done a = 2 done ")
		})

		it("handles forced destruction of parent within child", async () => {
			const owner = new Owner(null)

			let order = ""
			runWithOwner(owner, () => {
				createEffect(async () => {
					onCleanup(() => {
						order += "cleanup outer "
					})
					order += `run outer `
					await $s(sleep(5))

					createEffect(() => {
						onCleanup(() => {
							order += "cleanup inner 1 "
						})
						order += "run inner 1 "

						order += "outer destroy{"
						owner.destroy()
						order += "}outer destroy "
					})
					await $s(sleep(5))

					createEffect(() => {
						onCleanup(() => {
							order += "cleanup inner 2 "
						})
						order += "run inner 2 "
					})
					order += "outer done "
				})
			})

			assert.strictEqual(order, "run outer ")
			await sleep(30)
			assert.strictEqual(order, "run outer run inner 1 outer destroy{cleanup outer cleanup inner 1 }outer destroy run inner 2 outer done cleanup inner 2 ")
		})
	})

	describe("$s (state stashing)", () => {
		it("batches changes between awaits (1)", async () => {
			let order = ""

			const a = createSignal(0)
			const b = createSignal(0)

			createRoot(() => {
				createEffect(() => {
					order += `a = ${a()} b = ${b()} `
				})

				createEffect(async () => {
					order += "start "
					await $s(sleep(0))
					a(1)
					b(1)
					order += "unblock "
					await $s(sleep(0))
					order += "done "
				})
			})

			await sleep(30)
			assert.strictEqual(order, "a = 0 b = 0 start unblock a = 1 b = 1 done ")
		})

		it("batches changes between awaits (2)", async () => {
			let order = ""

			const a = createSignal(0)
			const b = createSignal(0)

			createRoot(() => {
				createEffect(() => {
					order += `a = ${a()} b = ${b()} `
				})

				createEffect(async () => {
					order += "start "
					await $s(sleep(5))
					a(1)
					b(1)
					order += "done "
				})
			})

			await sleep(10)
			assert.strictEqual(order, "a = 0 b = 0 start done a = 1 b = 1 ")
		})

		it("restores base values with no awaits", async () => {
			createRoot(() => {
				createEffect(async () => {

				})
			})

			assert.strictEqual(getOwner(), undefined)
		})

		it("restores base values while awaiting (1)", async () => {
			createRoot(() => {
				createEffect(async () => {
					await $s(sleep(20))
				})
			})

			assert.strictEqual(getOwner(), undefined)
			await sleep(0)
			assert.strictEqual(getOwner(), undefined)
		})

		it("restores base values while awaiting (2)", async () => {
			let order = ""
			createRoot(() => {
				createEffect(async () => {
					await $s(sleep(0))
					await $s(sleep(20))
				})
			})

			assert.strictEqual(getOwner(), undefined)
			await sleep(10)
			assert.strictEqual(getOwner(), undefined)
		})

		it("restores context values", async () => {
			const ctx = createContext(undefined)

			let order = ""
			createRoot(() => {
				createEffect(async () => {
					await $s(runWithContext(ctx, 0, async () => {
						await $s(sleep(1))
						order += `before = ${useContext(ctx)} `

						await $s(runWithContext(ctx, 1, async () => {
							await $s(sleep(1))
							order += `inside = ${useContext(ctx)} `
							await $s(sleep(1))
						}))
						order += `after = ${useContext(ctx)} `
					}))
					order += `outside = ${useContext(ctx)} `
				})
			})

			await sleep(50)
			assert.strictEqual(order, "before = 0 inside = 1 after = 0 outside = undefined ")
		})

		it("restores context values outside of owners", async () => {
			const ctx = createContext(undefined)

			let order = ""
			await $s(runWithContext(ctx, 0, async () => {
				await $s(sleep(1))
				order += `before = ${useContext(ctx)} `

				await $s(runWithContext(ctx, 1, async () => {
					await $s(sleep(1))
					order += `inside = ${useContext(ctx)} `
					await $s(sleep(1))
				}))
				order += `after = ${useContext(ctx)} `
			}))
			order += `outside = ${useContext(ctx)} `

			await sleep(50)
			assert.strictEqual(order, "before = 0 inside = 1 after = 0 outside = undefined ")
		})

		it("handles rejected promises", async () => {
			const ctx = createContext(undefined)
			let gotOwner = "NOT RUN"
			let gotCtx = "NOT RUN"
			let expectedOwner
			createRoot(() => {
				createEffect(async () => {
					expectedOwner = getOwner()
					try {
						await $s(sleep(1))

						await $s(runWithContext(ctx, 1, async () => {
							await $s(new Promise((resolve, reject) => {
								setTimeout(() => {
									reject(new Error("Test err"))
								}, 1)
							}))
						}))
					} catch (err) {
						gotOwner = getOwner()
						gotCtx = useContext(ctx)
					}
				})
			})
			await sleep(50)
			assert.strictEqual(gotOwner, expectedOwner)
			assert.strictEqual(gotCtx, undefined)
		})
	})

	describe("stashState", () => {
		it("saves and restores all state", () => {
			const ctx = createContext("a")
			const owner = new Owner(null)

			let stashN = 1
			function logState(expectStr) {
				const out = `ctx = ${useContext(ctx)}, owner eq ${getOwner() === owner}, collecting = ${_getInternalState().collectingDependencies}, assertStatic = ${_getInternalState().assertedStatic}`

				assert.strictEqual(out, expectStr, `stash${stashN++} str`)
				return out
			}

			function checkRestore(restore, checkStr) {
				restore(() => {
					logState(checkStr)
				})
			}

			const stash1Str = logState(`ctx = a, owner eq false, collecting = false, assertStatic = false`)
			const stash1 = stashState()

			let stash2Str
			let stash2
			runWithContext(ctx, "b", () => {
				stash2Str = logState(`ctx = b, owner eq false, collecting = false, assertStatic = false`)
				stash2 = stashState()
			})

			let stash3Str
			let stash3
			runWithOwner(owner, () => {
				stash3Str = logState(`ctx = a, owner eq true, collecting = false, assertStatic = false`)
				stash3 = stashState()
			})

			let stash4Str
			let stash4
			assertStatic(() => {
				stash4Str = logState(`ctx = a, owner eq false, collecting = false, assertStatic = true`)
				stash4 = stashState()
			})

			let stash5Str
			let stash5
			createRoot(() => {
				createEffect(() => {
					stash5Str = logState(`ctx = a, owner eq false, collecting = true, assertStatic = false`)
					stash5 = stashState()
				})
			})

			checkRestore(stash1, stash1Str)
			checkRestore(stash2, stash2Str)
			checkRestore(stash3, stash3Str)
			checkRestore(stash4, stash4Str)
			checkRestore(stash5, stash5Str)

			stash1(() => {
				stashN = 1
				checkRestore(stash1, stash1Str)
				checkRestore(stash2, stash2Str)
				checkRestore(stash3, stash3Str)
				checkRestore(stash4, stash4Str)
				checkRestore(stash5, stash5Str)
			})

			stash2(() => {
				stashN = 1
				checkRestore(stash1, stash1Str)
				checkRestore(stash2, stash2Str)
				checkRestore(stash3, stash3Str)
				checkRestore(stash4, stash4Str)
				checkRestore(stash5, stash5Str)
			})

			stash3(() => {
				stashN = 1
				checkRestore(stash1, stash1Str)
				checkRestore(stash2, stash2Str)
				checkRestore(stash3, stash3Str)
				checkRestore(stash4, stash4Str)
				checkRestore(stash5, stash5Str)
			})

			stash4(() => {
				stashN = 1
				checkRestore(stash1, stash1Str)
				checkRestore(stash2, stash2Str)
				checkRestore(stash3, stash3Str)
				checkRestore(stash4, stash4Str)
				checkRestore(stash5, stash5Str)
			})

			stash5(() => {
				stashN = 1
				checkRestore(stash1, stash1Str)
				checkRestore(stash2, stash2Str)
				checkRestore(stash3, stash3Str)
				checkRestore(stash4, stash4Str)
				checkRestore(stash5, stash5Str)
			})
		})

		it("doesn't freeze state popping", () => {
			const ctx = createContext()

			let log = ""

			log += useContext(ctx) + " " // undefined
			runWithContext(ctx, "a", () => {
				log += useContext(ctx) + " " // a
				runWithContext(ctx, "b", () => {
					log += useContext(ctx) + " " // b
					runWithContext(ctx, "c", () => {
						log += useContext(ctx) + " " // c
						stashState()
						log += useContext(ctx) + " " // c
					})
					log += useContext(ctx) + " " // b
					runWithContext(ctx, "d", () => {
						log += useContext(ctx) + " " // d
					})
					log += useContext(ctx) + " " // b
					stashState()
					log += useContext(ctx) + " " // b
					runWithContext(ctx, "e", () => {
						log += useContext(ctx) + " " // e
					})
					log += useContext(ctx) + " " // b
				})
				log += useContext(ctx) + " " // a
			})
			log += useContext(ctx) + " " // undefined

			assert.strictEqual(log, "undefined a b c c b d b b e b a undefined ")
		})
	})

	describe("onUpdate", () => {
		it("calls inner only after the first update after setup", () => {
			const signal = createSignal(0)
			let count = 0
			createRoot(() => {
				onUpdate(signal, () => {
					count++
				})
			})
			assert.strictEqual(count, 0)
			stashState()
			signal(1)
			assert.strictEqual(count, 1)
		})

		it("does reexecute on equal data update", () => {
			const signal = createSignal(0, true)
			let count = 0
			createRoot(() => {
				onUpdate(signal, () => {
					count++
				})
			})
			assert.strictEqual(count, 0)
			signal(0)
			assert.strictEqual(count, 1)
			signal(0)
			assert.strictEqual(count, 2)
		})

		it("does not track inner deps", () => {
			const signal = createSignal(0)
			const b = createSignal(0)
			let count = 0
			createRoot(() => {
				onUpdate(signal, () => {
					b()
					count++
				})
			})
			assert.strictEqual(count, 0)
			signal(1)
			assert.strictEqual(count, 1)
			b(1)
			assert.strictEqual(count, 1)
		})

		it("calls inner with the latest value", () => {
			const signal = createSignal(0)
			let count = 0
			let calledWithVal = -1
			createRoot(() => {
				onUpdate(signal, (val) => {
					count++
					calledWithVal = val
				})
			})
			assert.strictEqual(count, 0)
			signal(12)
			assert.strictEqual(count, 1)
			assert.strictEqual(calledWithVal, 12)
		})

		it("does not execute till batch end", () => {
			const signal = createSignal(0)
			let order = ""
			createRoot(() => {
				order += "init "
				onUpdate(signal, (val) => {
					order += "run " + val + " "
				})
			})

			order += "batch{"
			batch(() => {
				order += "write{"
				signal(1)
				order += "}write "
			})
			order += "}batch "

			assert.strictEqual(order, "init batch{write{}write run 1 }batch ")
		})

		it("runs cleanups before listener inners", () => {
			const signal = createSignal(0)

			let order = ""

			createRoot(() => {
				onUpdate(signal, (val) => {
					onCleanup(() => {
						order += `cleanup a(${val}) `
					})
					order += `run a(${val}) `
				})
				onUpdate(signal, (val) => {
					onCleanup(() => {
						order += `cleanup b(${val}) `
					})
					order += `run b(${val}) `
				})
			})

			order += "write 1 "
			signal(1)
			order += "write 2 "
			signal(2)
			assert.strictEqual(order, "write 1 run a(1) run b(1) write 2 cleanup a(1) cleanup b(1) run a(2) run b(2) ")
		})
	})

	describe("onWrite", () => {
		it("does reexecute on equal data update", () => {
			const signal = createSignal(0, true)
			let count = 0
			createRoot(() => {
				onWrite(signal, () => {
					count++
				})
			})
			assert.strictEqual(count, 0)
			signal(0)
			assert.strictEqual(count, 1)
			signal(0)
			assert.strictEqual(count, 2)
		})

		it("calls inner with the latest value", () => {
			const signal = createSignal(0)
			let count = 0
			let calledWithVal = -1
			createRoot(() => {
				onWrite(signal, (val) => {
					count++
					calledWithVal = val
				})
			})
			assert.strictEqual(count, 0)
			signal(12)
			assert.strictEqual(count, 1)
			assert.strictEqual(calledWithVal, 12)
		})

		it("executes immediately before write exits", () => {
			const signal = createSignal(0)
			let order = ""
			createRoot(() => {
				order += "init "
				onWrite(signal, (val) => {
					order += "run " + val + " "
				})
			})

			order += "batch{"
			batch(() => {
				order += "write{"
				signal(1)
				order += "}write "
			})
			order += "}batch "

			assert.strictEqual(order, "init batch{write{run 1 }write }batch ")
		})

		it("catches errors", () => {
			const signal = createSignal(0)

			let order = ""
			createRoot(() => {
				onWrite(signal, () => {
					order += "throw "
					throw new Error("Test err")
				})
				onWrite(signal, () => {
					order += "other onWrite "
				})
			})

			order += "write "
			signal(1)

			assert.strictEqual(order, "write throw other onWrite ")
		})

		it("runs listeners within their own ownership context", () => {
			const signal = createSignal(0)
			const a = createSignal(0)

			let order = ""

			createRoot(() => {
				createEffect(() => {
					order += "run A "
					a()

					onCleanup(() => {
						order += "cleanup A "
					})
					onWrite(signal, (val) => {
						order += `onWrite(${val}) `
						onCleanup(() => {
							order += `cleanup onWrite(${val}) `
						})
					})
				})

				createEffect(() => {
					order += "write signal(1){"
					signal(1)
					order += "}write signal(1) "
				})
			})

			order += "write signal(2){"
			signal(2)
			order += "}write signal(2) "

			order += "write a(1){"
			a(1)
			order += "}write a(1) "

			assert.strictEqual(order, "run A write signal(1){onWrite(1) }write signal(1) write signal(2){cleanup onWrite(1) onWrite(2) }write signal(2) write a(1){cleanup A cleanup onWrite(2) run A }write a(1) ")
		})

		// Matches onUpdate test
		it("runs cleanups before listener inners", () => {
			const signal = createSignal(0)

			let order = ""

			createRoot(() => {
				onWrite(signal, (val) => {
					onCleanup(() => {
						order += `cleanup a(${val}) `
					})
					order += `run a(${val}) `
				})
				onWrite(signal, (val) => {
					onCleanup(() => {
						order += `cleanup b(${val}) `
					})
					order += `run b(${val}) `
				})
			})

			order += "write 1 "
			signal(1)
			order += "write 2 "
			signal(2)
			assert.strictEqual(order, "write 1 run a(1) run b(1) write 2 cleanup a(1) cleanup b(1) run a(2) run b(2) ")
		})

		it("does not track deps (init)", () => {
			const signal = createSignal(0)

			let state
			createRoot(() => {
				createEffect(() => {
					onWrite(signal, () => {
						state = _getInternalState()
					})
					signal(1)
				})
			})

			assert.strictEqual(state.collectingDependencies, false)
			assert.strictEqual(state.assertedStatic, false)
		})

		it("does not track deps (after init)", () => {
			const signal = createSignal(0)

			let state
			createRoot(() => {
				createEffect(() => {
					onWrite(signal, () => {
						state = _getInternalState()
					})
				})
			})

			signal(1)

			assert.strictEqual(state.collectingDependencies, false)
			assert.strictEqual(state.assertedStatic, false)
		})

		it("executes secondary writes in a batch", () => {
			const signal = createSignal(0)

			let a = createSignal(0)
			let b = createSignal(0)
			let c = createSignal(0)

			let order = ""
			createRoot(() => {
				createEffect(() => {
					order += "AB{"
					a()
					b()
					order += "}AB "
				})

				createEffect(() => {
					order += "C{"
					c()
					order += "}C "
				})

				onWrite(signal, () => {
					order += "listener1{"
					a(1)
					b(1)
					order += "}listener1 "
				})

				onWrite(signal, () => {
					order += "listener2{"
					c(1)
					order += "}listener2 "
				})
			})

			order += "write{"
			signal(1)
			order += "}write "

			assert.strictEqual(order, "AB{}AB C{}C write{listener1{}listener1 listener2{}listener2 AB{}AB C{}C }write ")
		})

		it("executes secondary writes within the writer's update queue", () => {
			const signal = createSignal(0)

			let a = createSignal(0)
			let b = createSignal(0)

			let order = ""
			createRoot(() => {
				createEffect(() => {
					order += "A{"
					a()
					order += "}A "
				})

				createEffect(() => {
					order += "B{"
					b()
					order += "}B "
				})

				onWrite(signal, () => {
					order += "setB{"
					b(1)
					order += "}setB "
				})
			})

			order += "batch{"
			batch(() => {
				a(1)

				order += "subclock{"
				subclock(() => {
					order += "writeSignal{"
					signal(1)
					order += "}writeSignal "
				})
				order += "}subclock "
			})
			order += "}batch "

			assert.strictEqual(order, "A{}A B{}B batch{subclock{writeSignal{setB{}setB B{}B }writeSignal }subclock A{}A }batch ")
		})

		it("disappears on cleanup", () => {
			const owner = new Owner(null)
			const signal = createSignal(0)

			let order = ""
			runWithOwner(owner, () => {
				onWrite(signal, (val) => {
					order += `val=${val} `
				})
			})

			order += "write(1){"
			signal(1)
			order += "}write(1) "

			order += "destroy "
			owner.destroy()

			order += "write(2){"
			signal(2)
			order += "}write(2) "

			assert.strictEqual(order, "write(1){val=1 }write(1) destroy write(2){}write(2) ")
		})
	})

	describe("untrack", () => {
		it("sets internalState.collectingDependencies", () => {
			untrack(() => {
				assert.strictEqual(_getInternalState().collectingDependencies, false)
			})
		})

		it("sets internalState.assertedStatic", () => {
			assertStatic(() => {
				untrack(() => {
					assert.strictEqual(_getInternalState().assertedStatic, false)
				})
			})
		})

		it("blocks dependency collection", () => {
			let count = 0
			let signal = createSignal(0)
			createRoot(() => {
				createEffect(() => {
					count++
					untrack(() => {
						signal()
					})
				})
			})
			assert.strictEqual(count, 1)
			signal(1)
			assert.strictEqual(count, 1)
		})

		// IMPORTANT! if this test does not pass, it may cause other tests here to pass incorrectly,
		// because they contain asserts inside the untrack which they expect to propogate up to the it()
		it("passes errors", () => {
			assert.throws(() => {
				untrack(() => {
					throw new Error("err")
				})
			})
		})

		it("restores current computation after throw", () => {
			createRoot(() => {
				createEffect(() => {
					const before = _getInternalState().currentOwnerOwner
					try {
						untrack(() => {
							throw new Error("err")
						})
					} catch (err) { }
					assert.strictEqual(_getInternalState().currentOwnerOwner, before)
				})
			})
		})

		it("pops collectingDependencies state (false)", () => {
			untrack(() => {
				untrack(() => { })
				assert.strictEqual(_getInternalState().collectingDependencies, false)
			})
		})

		it("pops collectingDependencies state (true)", () => {
			assert.strictEqual(_getInternalState().collectingDependencies, false)
			createRoot(() => {
				createEffect(() => {
					untrack(() => { })
					assert.strictEqual(_getInternalState().collectingDependencies, true)
				})
			})
		})

		it("pops collectingDependencies state after throw (false)", () => {
			untrack(() => {
				try {
					untrack(() => {
						throw new Error("err")
					})
				} catch (err) { }
				assert.strictEqual(_getInternalState().collectingDependencies, false)
			})
		})

		it("pops collectingDependencies state after throw (true)", () => {
			assert.strictEqual(_getInternalState().collectingDependencies, false)
			createRoot(() => {
				createEffect(() => {
					try {
						untrack(() => {
							throw new Error("err")
						})
					} catch (err) { }
					assert.strictEqual(_getInternalState().collectingDependencies, true)
				})
			})
		})

		it("pops assertedStatic state (true)", () => {
			assertStatic(() => {
				untrack(() => { })
				assert.strictEqual(_getInternalState().assertedStatic, true)
			})
		})

		it("pops assertedStatic state after throw (true)", () => {
			assertStatic(() => {
				try {
					untrack(() => {
						throw new Error("err")
					})
				} catch (err) { }
				assert.strictEqual(_getInternalState().assertedStatic, true)
			})
		})
	})

	describe("retrack", () => {
		it("sets internalState.collectingDependencies (even outside of an effect)", () => {
			untrack(() => {
				retrack(() => {
					assert.strictEqual(_getInternalState().collectingDependencies, true)
				})
			})
		})

		it("does not set internalState.assertedStatic", () => {
			assertStatic(() => {
				retrack(() => {
					assert.strictEqual(_getInternalState().assertedStatic, true)
				})
			})
		})

		it("does not set internalState.assertedStatic (1)", () => {
			retrack(() => {
				assert.strictEqual(_getInternalState().assertedStatic, false)
			})
		})

		it("does not set internalState.assertedStatic (2)", () => {
			assertStatic(() => {
				retrack(() => {
					assert.strictEqual(_getInternalState().assertedStatic, true)
				})
			})
		})

		it("cancels untrack", () => {
			let count = 0
			let signal = createSignal(0)
			createRoot(() => {
				createEffect(() => {
					count++
					untrack(() => {
						retrack(() => {
							signal()
						})
					})
				})
			})
			assert.strictEqual(count, 1)
			signal(1)
			assert.strictEqual(count, 2)
		})

		it("passes errors", () => {
			assert.throws(() => {
				retrack(() => {
					throw new Error("err")
				})
			})
		})

		it("pops collectingDependencies state (false)", () => {
			untrack(() => {
				retrack(() => { })
				assert.strictEqual(_getInternalState().collectingDependencies, false)
			})
		})

		it("pops collectingDependencies state after throw (false)", () => {
			untrack(() => {
				try {
					retrack(() => {
						throw new Error("err")
					})
				} catch (err) { }
				assert.strictEqual(_getInternalState().collectingDependencies, false)
			})
		})
	})

	describe("assertStatic", () => {
		it("blocks dependency collection", () => {
			let count = 0
			let signal = createSignal(0)
			createRoot(() => {
				createEffect(() => {
					count++
					assertStatic(() => {
						signal()
					})
				})
			})
			assert.strictEqual(count, 1)
			signal(1)
			assert.strictEqual(count, 1)
		})

		it("sets internalState.assertedStatic", () => {
			assertStatic(() => {
				assert.strictEqual(_getInternalState().assertedStatic, true)
			})
		})

		it("sets internalState.collectingDependencies", () => {
			let val = "NOT RUN"
			createEffect(() => {
				assertStatic(() => {
					val = _getInternalState().collectingDependencies
				})
			})

			assert.strictEqual(val, false)
		})
	})

	describe("toSignal", () => {
		it("creates something portlike", () => {
			let setVal
			let signal = toSignal(
				() => 5,
				(val) => {
					setVal = val
				}
			)
			assert.strictEqual(signal(), 5)
			signal(3)
			assert.strictEqual(setVal, 3)
			assert.strictEqual(signal(), 5)
		})

		it("does not have internal state", () => {
			let count = 0
			let setVal
			let signal = toSignal(
				() => 5,
				(val) => {
					setVal = val
				}
			)

			createRoot(() => {
				createEffect(() => {
					count++
					signal()
				})
			})
			assert.strictEqual(count, 1)
			signal(1)
			assert.strictEqual(count, 1)
		})
	})

	describe("batch", () => {
		it("batches updates", () => {
			const a = createSignal(0)
			const b = createSignal(0)
			let count = 0
			createRoot(() => {
				createEffect(() => {
					count++
					a()
					b()
				})
			})
			assert.strictEqual(count, 1)
			batch(() => {
				a(1)
				assert.strictEqual(count, 1)
				b(1)
				assert.strictEqual(count, 1)
				a(2)
				assert.strictEqual(count, 1)
				b(2)
				assert.strictEqual(count, 1)
			})
			assert.strictEqual(count, 2)
		})

		it("allows ports to update before the end of the batch", () => {
			const a = createSignal(0)
			const b = createSignal(0)
			let count = 0
			createRoot(() => {
				createEffect(() => {
					count++
					a()
					b()
				})
			})
			batch(() => {
				a(1)
				b(1)
				assert.strictEqual(a(), 1)
				assert.strictEqual(b(), 1)
			})
		})


		it("allows ports to update more than once", () => {
			const a = createSignal(0)
			const b = createSignal(0)
			let count = 0
			createRoot(() => {
				createEffect(() => {
					count++
					a()
					b()
				})
			})
			batch(() => {
				a(1)
				b(1)
				a(2)
				assert.strictEqual(a(), 2)
			})
		})

		it("passes errors", () => {
			assert.throws(() => {
				batch(() => {
					throw new Error("err")
				})
			})
		})
	})

	describe("onCleanup", () => {
		it("can trigger an effect update without causing an infinite loop", () => {
			const sig = createSignal(0)
			createRoot(() => {
				createEffect(() => {
					const val = sig()
					onCleanup(() => {
						sig(sig() + 1)
					})
				})
			})
			assert.strictEqual(sig(), 0)
			assert.doesNotThrow(() => sig(1))
			assert.strictEqual(sig(), 2)
		})

		it("isolates owner", () => {
			const sig = createSignal(0)
			let innerOwner = "a"
			createRoot(() => {
				createEffect(() => {
					const val = sig()
					onCleanup(() => {
						innerOwner = getOwner()
					})
				})
				sig(1)
			})

			assert.strictEqual(innerOwner, undefined)
		})

		it("isolates errors", () => {
			const sig = createSignal(0)
			let log = ""
			createRoot(() => {
				createEffect(() => {
					const val = sig()
					onCleanup(() => {
						log += "a"
						throw new Error("Test err")
					})
					onCleanup(() => {
						log += "b"
					})
				})
			})
			assert.strictEqual(log, "")
			assert.doesNotThrow(() => sig(1))
			assert.strictEqual(log, "ab")
		})
	})

	describe("runWithOwner", () => {
		it("sets owner", () => {
			const owner1 = new Owner(null)
			const owner2 = new Owner(null)

			let innerOwner
			runWithOwner(owner1, () => {
				runWithOwner(owner2, () => {
					innerOwner = getOwner()
				})
			})

			assert.strictEqual(innerOwner, owner2)
		})

		it("isolates owner", () => {
			const owner1 = new Owner(null)
			const owner2 = new Owner(null)

			let innerOwner1
			let innerOwner2
			runWithOwner(owner1, () => {
				runWithOwner(owner2, () => {
					innerOwner2 = getOwner()
				})
				innerOwner1 = getOwner()
			})

			assert.strictEqual(innerOwner2, owner2)
			assert.strictEqual(innerOwner1, owner1)
		})

		it("passes errors", () => {
			const owner1 = new Owner(null)
			assert.throws(() => {
				runWithOwner(owner1, () => {
					throw new Error("test")
				})
			})
		})

		it("allows setting owner === null", () => {
			let innerOwner
			const owner1 = new Owner(null)
			runWithOwner(owner1, () => {
				runWithOwner(null, () => {
					innerOwner = getOwner()
				})
			})

			assert.strictEqual(innerOwner, null)
		})

		it("allows setting owner === undefined", () => {
			let innerOwner
			const owner1 = new Owner(null)
			runWithOwner(owner1, () => {
				runWithOwner(undefined, () => {
					innerOwner = getOwner()
				})
			})

			assert.strictEqual(innerOwner, undefined)
		})

		it("returns the same owner within an effect", () => {
			let innerOwner1
			let innerOwner2
			createRoot(() => {
				createEffect(() => {
					innerOwner1 = getOwner()
					innerOwner2 = getOwner()
				})
			})

			assert.strictEqual(innerOwner1, innerOwner2)
		})
	})

	describe("createContext", () => {
		it("creates a context", () => {
			const ctx = createContext(0)
		})
	})

	describe("useContext", () => {
		it("returns the default value if called outside a runWithContext", () => {
			const ctx = createContext(42)

			assert.strictEqual(useContext(ctx), 42)
		})

		it("returns undefined if no default value is set", () => {
			const ctx = createContext()

			assert.strictEqual(useContext(ctx), undefined)
		})

		it("returns assigned undefined even with truthy default", () => {
			const ctx = createContext("a")

			runWithContext(ctx, undefined, () => {
				assert.strictEqual(useContext(ctx), undefined)
			})

			assert.strictEqual(useContext(ctx), "a")
		})

		it("does not return the value from a saved owner (1)", () => {
			const ctx = createContext()

			let owner
			runWithOwner(new Owner(null), () => {
				runWithContext(ctx, 5, () => {
					owner = getOwner()
				})
			})
			runWithOwner(owner, () => {
				assert.strictEqual(useContext(ctx), undefined)
			})
		})

		it("does not return the value from a saved owner (2)", () => {
			const ctx = createContext()

			let owner
			runWithOwner(new Owner(null), () => {
				runWithContext(ctx, 5, () => {
					owner = getOwner()
				})
			})
			runWithContext(ctx, 2, () => {
				runWithOwner(owner, () => {
					assert.strictEqual(useContext(ctx), 2)
				})
			})
		})

		it("does not do nested restore from a saved owner", () => {
			const ctx = createContext()

			let owner
			runWithOwner(new Owner(null), () => {
				runWithContext(ctx, 5, () => {
					owner = getOwner()
				})
			})

			runWithContext(ctx, 2, () => {
				assert.strictEqual(useContext(ctx), 2)
				runWithOwner(owner, () => {
					assert.strictEqual(useContext(ctx), 2)
					runWithContext(ctx, 3, () => {
						assert.strictEqual(useContext(ctx), 3)
						runWithOwner(owner, () => {
							assert.strictEqual(useContext(ctx), 3)
						})
						assert.strictEqual(useContext(ctx), 3)
					})
					assert.strictEqual(useContext(ctx), 2)
				})
				assert.strictEqual(useContext(ctx), 2)
			})
		})
	})

	describe("runWithContext", () => {
		it("sets the context", () => {
			const ctx = createContext()

			runWithContext(ctx, 5, () => {
				assert.strictEqual(useContext(ctx), 5)
			})
		})

		it("handles nested context assignments", () => {
			const ctx = createContext()

			runWithContext(ctx, 5, () => {
				assert.strictEqual(useContext(ctx), 5)
				runWithContext(ctx, 10, () => {
					assert.strictEqual(useContext(ctx), 10)
				})
				assert.strictEqual(useContext(ctx), 5)
			})
		})

		it("handles errors", () => {
			const ctx = createContext()

			runWithContext(ctx, 5, () => {
				assert.throws(() => {
					runWithContext(ctx, 10, () => {
						throw new Error("Test")
					})
				})
				assert.strictEqual(useContext(ctx), 5)
			})
		})

		it("handles multiple contexts", () => {
			const a = createContext()
			const b = createContext(2)

			assert.strictEqual(useContext(a), undefined)
			runWithContext(a, 5, () => {
				assert.strictEqual(useContext(a), 5)
				assert.strictEqual(useContext(b), 2)
				runWithContext(b, 10, () => {
					assert.strictEqual(useContext(a), 5)
					assert.strictEqual(useContext(b), 10)
				})
				assert.strictEqual(useContext(a), 5)
				assert.strictEqual(useContext(b), 2)
			})
		})

		it("returns the inner return value", () => {
			const ctx = createContext()

			const result = runWithContext(ctx, 5, () => {
				assert.strictEqual(useContext(ctx), 5)

				return "a"
			})

			assert.strictEqual(result, "a")
		})
	})

	describe("context interactions", () => {
		it("context values are captured by effects", () => {
			const ctx = createContext("a")
			const sig = createSignal(0)
			let log = ""

			createRoot(() => {
				runWithContext(ctx, "b", () => {
					createEffect(() => {
						log += `sig = ${sig()}, ctx = ${useContext(ctx)}; `
					})
				})
			})
			sig(1)
			assert.strictEqual(log, "sig = 0, ctx = b; sig = 1, ctx = b; ")
		})

		it("context values are captured by onWrite", () => {
			const ctx = createContext("a")
			const sig = createSignal(0)
			let log = ""

			createRoot(() => {
				runWithContext(ctx, "b", () => {
					onWrite(sig, () => {
						log += `sig = ${sig()}, ctx = ${useContext(ctx)}; `
					})
				})
			})
			log += "write 0; "
			sig(0)
			log += "write 1; "
			sig(1)

			assert.strictEqual(log, "write 0; sig = 0, ctx = b; write 1; sig = 1, ctx = b; ")
		})

		it("context values are captured by onCleanup", () => {
			const ctx = createContext("a")
			let log = ""

			const owner = new Owner(null)

			log += useContext(ctx)
			runWithOwner(owner, () => {
				log += useContext(ctx)
				runWithContext(ctx, "b", () => {
					log += useContext(ctx)
					onCleanup(() => {
						log += useContext(ctx)
					})
					log += useContext(ctx)
				})
				log += useContext(ctx)
			})
			log += useContext(ctx)

			owner.destroy()

			assert.strictEqual(log, "aabbaab")
		})

		it("context values are captured by onCleanup inside effects", () => {
			const sig = createSignal(0)

			const ctx = createContext("a")
			let log = ""

			createRoot(() => {
				runWithContext(ctx, "b", () => {
					createEffect(() => {
						const run = `sig = ${sig()}`
						log += `run effect, sig = ${sig()}; `
						onCleanup(() => {
							log += `cleanup run "${run}", ctx = ${useContext(ctx)}; `
						})
					})
				})
			})

			sig(1)
			sig(2)

			assert.strictEqual(log, `run effect, sig = 0; cleanup run "sig = 0", ctx = b; run effect, sig = 1; cleanup run "sig = 1", ctx = b; run effect, sig = 2; `)
		})

		it("owners do not save tracking state", () => {
			let sig1 = createSignal("a")
			let sig2 = createSignal("x")
			let log = ""

			let savedOwner

			createRoot(() => {
				createEffect(() => {
					log += `run effect; sig1 = ${sig1()}; `
					savedOwner = getOwner()
				})
			})

			assertStatic(() => {
				runWithOwner(savedOwner, () => {
					log += `run with saved owner; sig2 = ${sig2()}, assertedStatic = ${_getInternalState().assertedStatic}, collectingDependencies = ${_getInternalState().collectingDependencies}; `
				})
			})

			log += "set sig2 = y; "
			sig2("y")
			log += "set sig1 = c; "
			sig1("c")
			assert.strictEqual(log, "run effect; sig1 = a; run with saved owner; sig2 = x, assertedStatic = true, collectingDependencies = false; set sig2 = y; set sig1 = c; run effect; sig1 = c; ")
		})

		it("direct effect returns also do not save tracking state", () => {
			let sig1 = createSignal("a")
			let sig2 = createSignal("x")
			let log = ""

			let effect
			createRoot(() => {
				effect = createEffect(() => {
					log += `run effect; sig1 = ${sig1()}; `
					sig1()
				})
			})

			assertStatic(() => {
				runWithOwner(effect, () => {
					log += `run with saved owner; sig2 = ${sig2()}, assertedStatic = ${_getInternalState().assertedStatic}, collectingDependencies = ${_getInternalState().collectingDependencies}; `
				})
			})

			log += "set sig2 = y; "
			sig2("y")
			log += "set sig1 = c; "
			sig1("c")
			assert.strictEqual(log, "run effect; sig1 = a; run with saved owner; sig2 = x, assertedStatic = true, collectingDependencies = false; set sig2 = y; set sig1 = c; run effect; sig1 = c; ")
		})

		it("restoring owners does not restore the tracking parent", () => {
			let log = ""

			const sig = createSignal("a")
			let savedOwner

			createRoot(() => {
				createEffect(() => {
					log += "run effect 1; "
					savedOwner = new Owner()
				})

				createEffect(() => {
					log += "run effect 2; "
					runWithOwner(savedOwner, () => {
						log += `sig = ${sig()}; `
					})
				})
			})

			log += "set sig = b; "
			sig("b")

			assert.strictEqual(log, "run effect 1; run effect 2; sig = a; set sig = b; run effect 2; sig = b; ")
		})

		it("context values are not saved in owners", () => {
			const ctx = createContext("a")
			let log = ""
			log += useContext(ctx) // a

			runWithContext(ctx, "b", () => {
				log += useContext(ctx) // b
				let owner
				runWithContext(ctx, "c", () => {
					owner = new Owner(null)
					log += useContext(ctx) // c
				})
				log += useContext(ctx) // b (again)
				runWithOwner(owner, () => {
					log += useContext(ctx) // b (no runWithContext changed it)
				})
				log += useContext(ctx) // still b
			})
			log += useContext(ctx) // back to a

			assert.strictEqual(log, "abcbbba")
		})

		it("context values are not saved in tracking state commands", () => {
			const ctx = createContext("a")
			let log = ""
			log += useContext(ctx)

			createRoot(() => {
				log += useContext(ctx)
				runWithContext(ctx, "b", () => {
					log += useContext(ctx)
					assertStatic(() => {
						log += useContext(ctx)
						runWithContext(ctx, "c", () => {
							log += useContext(ctx)
							new Owner(null)
						})
						log += useContext(ctx)
					})
					log += useContext(ctx)
				})
				log += useContext(ctx)
			})
			log += useContext(ctx)

			assert.strictEqual(log, "aabbcbbaa")
		})
	})

	describe("ReactiveArray", () => {
		it("creates as expected", () => {
			const arr = new ReactiveArray(["a", "b", "c"])

			assert.strictEqual(Array.from(arr).join(""), "abc")
		})

		it("initializes indexes correctly", () => {
			const arr = new ReactiveArray(["a", "b", "c"])

			assert.strictEqual(arr.array.map(item => item.index()).join(","), "0,1,2")
		})

		describe("ReactiveArray.splice", () => {
			it("handles splices", () => {
				const arr = new ReactiveArray(["a", "b", "c"])

				arr.splice(1, 1, "1", "2")

				assert.strictEqual(Array.from(arr).join(""), "a12c")
			})

			it("updates indexes after splices", () => {
				const arr = new ReactiveArray(["a", "b", "c"])

				arr.splice(1, 1, "1", "2")

				assert.strictEqual(arr.array.map(item => item.index()).join(","), "0,1,2,3")
			})
		})

		describe("ReactiveArray.map", () => {
			it("maps correctly", () => {
				createRoot(() => {
					const arr = new ReactiveArray(["a", "b", "c"])

					const mapped = arr.map(c => c.toUpperCase())

					assert.strictEqual(Array.from(mapped).join(","), "A,B,C")
				})
			})

			it("handles splice on the base", () => {
				createRoot(() => {
					const arr = new ReactiveArray(["a", "b", "c"])

					const mapped = arr.map(c => c.toUpperCase())

					arr.splice(1, 1, "x", "y")

					assert.strictEqual(Array.from(arr).join(","), "a,x,y,c")
					assert.strictEqual(Array.from(mapped).join(","), "A,X,Y,C")

					arr.splice(4, 2, "m", "n")

					assert.strictEqual(Array.from(arr).join(","), "a,x,y,c,m,n")
					assert.strictEqual(Array.from(mapped).join(","), "A,X,Y,C,M,N")
				})
			})

			it("tracks mapper dependencies", () => {
				createRoot(() => {
					const arr = new ReactiveArray(["a", "b", "c"])
					const add = createSignal("")

					const mapped = arr.map(c => c.toUpperCase() + add())

					assert.strictEqual(Array.from(mapped).join(","), "A,B,C")

					add("_")

					assert.strictEqual(Array.from(mapped).join(","), "A_,B_,C_")
				})
			})

			it("tracks mapper indexes", () => {
				createRoot(() => {
					const arr = new ReactiveArray(["a", "b", "c"])


					let log = []
					const mapped = arr.map((c, index) => {
						log.push("+" + c) // create effect for mapping c
						onCleanup(() => {
							log.push("-" + c) // destroy/rerun effect for mapping c
						})

						return c.toUpperCase() + index()
					})

					assert.strictEqual(Array.from(mapped).join(","), "A0,B1,C2")

					log.push("splice")
					arr.splice(1, 1, "x", "y")

					assert.strictEqual(Array.from(mapped).join(","), "A0,X1,Y2,C3")
					assert.strictEqual(log.join(","), "+a,+b,+c,splice,+x,+y,-b,-c,+c")
				})
			})

			it("destroys mapper effects", () => {
				createRoot(() => {
					const arr = new ReactiveArray(["a", "b", "c"])

					let log = []
					const mapped = arr.map(c => {
						log.push("+" + c) // create effect for mapping c
						onCleanup(() => {
							log.push("-" + c) // destroy/rerun effect for mapping c
						})

						return c.toUpperCase()
					})

					log.push("splice")
					arr.splice(1, 1, "x", "y")

					assert.strictEqual(log.join(","), "+a,+b,+c,splice,+x,+y,-b")
				})
			})
		})

		describe("ReactiveArray.filter", () => {
			it("filters correctly", () => {
				createRoot(() => {
					const arr = new ReactiveArray([0, 3, 1, 4])

					const filtered = arr.filter(c => c > 2)

					assert.strictEqual(Array.from(filtered).join(","), "3,4")
				})
			})

			it("handles splice on the base", () => {
				createRoot(() => {
					const arr = new ReactiveArray([0, 3, 1, 4])

					const filtered = arr.filter(c => c > 2)

					arr.splice(1, 1, 5, 7)

					assert.strictEqual(Array.from(arr).join(","), "0,5,7,1,4")
					assert.strictEqual(Array.from(filtered).join(","), "5,7,4")

					arr.splice(0, 2, 9, 8)

					assert.strictEqual(Array.from(arr).join(","), "9,8,7,1,4")
					assert.strictEqual(Array.from(filtered).join(","), "9,8,7,4")
				})
			})

			it("handles splice on the base when no items are removed", () => {
				createRoot(() => {
					const arr = new ReactiveArray([0, 3, 1, 4])

					const filtered = arr.filter(c => c > 2)

					arr.splice(1, 0, 5, 7)

					assert.strictEqual(Array.from(filtered).join(","), "5,7,3,4")
				})
			})

			it("handles splice on the base when removed items aren't kept", () => {
				createRoot(() => {
					const arr = new ReactiveArray([0, 3, 1, 4])

					const filtered = arr.filter(c => c > 2)

					arr.splice(0, 1, 5, 7)

					assert.strictEqual(Array.from(filtered).join(","), "5,7,3,4")
				})
			})

			it("handles index based filters", () => {
				createRoot(() => {
					const arr = new ReactiveArray(["a", "b", "c", "d", "e", "f"])

					const filtered = arr.filter((c, index) => index() % 2 === 1)

					assert.strictEqual(Array.from(filtered).join(","), "b,d,f")

					arr.splice(1, 1, "x", "y")

					assert.strictEqual(Array.from(filtered).join(","), "x,c,e")
				})
			})

			it("doesn't splice output for same filter result", () => {
				createRoot(() => {
					const arr = new ReactiveArray(["a", "b", "c", "d", "e", "f"])

					const filtered = arr.filter((c, index) => index() <= 3)

					assert.strictEqual(Array.from(filtered).join(","), "a,b,c,d")

					const log = []
					onWrite(filtered.array.spliceEvent, (evt) => {
						if (!evt) {
							return
						}
						const [start, added, removed] = evt
						log.push(`${start}|-${removed.map(item => item.value).join(",")}|+${added.map(item => item.value).join(",")}`)
					})

					arr.splice(1, 1, "x", "y")
					// axycdef

					assert.strictEqual(Array.from(filtered).join(","), "a,x,y,c")

					// 4, not 3, because the second splice to remove d happens in an intermediate state: "axycd"
					assert.strictEqual(Array.from(log).join(";"), "1|-b|+x,y;4|-d|+")
				})
			})
		})

		describe("ReactiveArray.sort", () => {
			it("sorts correctly", () => {
				createRoot(() => {
					const arr = new ReactiveArray([0, 3, 1, 4])

					const sorted = arr.sort((a, b) => a - b)

					assert.strictEqual(Array.from(sorted).join(","), "0,1,3,4")
				})
			})

			it("handles splice on the base", () => {
				createRoot(() => {
					const arr = new ReactiveArray([0, 3, 1, 4])

					const sorted = arr.sort((a, b) => a - b)

					arr.splice(1, 1, 7, -1, 2)

					assert.strictEqual(Array.from(arr).join(","), "0,7,-1,2,1,4")
					assert.strictEqual(Array.from(sorted).join(","), "-1,0,1,2,4,7")

					arr.splice(0, 2, 3, 10)

					assert.strictEqual(Array.from(arr).join(","), "3,10,-1,2,1,4")
					assert.strictEqual(Array.from(sorted).join(","), "-1,1,2,3,4,10")
				})
			})

			it("produces reasonable splice lists", () => {
				createRoot(() => {
					const arr = new ReactiveArray([0, 3, 1, 4])

					const sorted = arr.sort((a, b) => a - b)


					const log = []
					onWrite(sorted.array.spliceEvent, (evt) => {
						if (!evt) {
							return
						}
						const [start, added, removed] = evt
						log.push(`${start}|-${removed.map(item => item.value).join(",")}|+${added.map(item => item.value).join(",")}`)
					})

					arr.splice(1, 1, 7, -1, 2)

					// 0 1 2 3 4
					// 0,1,3,4
					// 0,1,4
					// 0,1,4,7
					//-1,0,1,4,7
					//-1,0,1,2,4,7
					assert.strictEqual(Array.from(log).join(";"), "2|-3|+;3|-|+7;0|-|+-1;3|-|+2")
				})
			})
		})

		describe("ReactiveArray.effectForEach", () => {
			it("runs effects", () => {
				createRoot(() => {
					const counts = new Map()

					const arr = new ReactiveArray(["a", "b", "c"])

					arr.effectForEach((c) => {
						if (!counts.has(c)) {
							counts.set(c, 0)
						}

						counts.set(c, counts.get(c) + 1)

						onCleanup(() => {
							counts.set(c, counts.get(c) - 1)
						})
					})

					assert.strictEqual(Array.from(counts).map(c => c.join(":")).join(","), "a:1,b:1,c:1")
				})
			})

			it("reruns effects on splice", () => {
				createRoot(() => {
					const counts = new Map()

					const arr = new ReactiveArray(["a", "b", "c"])

					arr.effectForEach((c) => {
						if (!counts.has(c)) {
							counts.set(c, 0)
						}

						counts.set(c, counts.get(c) + 1)

						onCleanup(() => {
							counts.set(c, counts.get(c) - 1)
						})
					})

					assert.strictEqual(Array.from(counts).map(c => c.join(":")).join(","), "a:1,b:1,c:1")

					arr.splice(1, 1, "c", "a", "d")

					assert.strictEqual(Array.from(counts).map(c => c.join(":")).join(","), "a:2,b:0,c:2,d:1")
				})
			})

			it("reruns effect only when necessary", () => {
				createRoot(() => {
					const counts = new Map()

					const arr = new ReactiveArray(["a", "b", "c"])

					const log = []

					arr.effectForEach((c) => {
						if (!counts.has(c)) {
							counts.set(c, 0)
						}

						log.push("+" + c)
						counts.set(c, counts.get(c) + 1)

						onCleanup(() => {
							log.push("-" + c)
							counts.set(c, counts.get(c) - 1)
						})
					})

					assert.strictEqual(Array.from(counts).map(c => c.join(":")).join(","), "a:1,b:1,c:1")

					log.push("splice")
					arr.splice(1, 1, "x", "y")

					assert.strictEqual(Array.from(counts).map(c => c.join(":")).join(","), "a:1,b:0,c:1,x:1,y:1")

					assert.strictEqual(log.join(","), "+a,+b,+c,splice,+x,+y,-b")
				})
			})
		})
	})
})
