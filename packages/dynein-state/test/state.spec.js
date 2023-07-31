import { createSignal, toSignal, createEffect, createMemo, onUpdate, onCleanup, createRoot, untrack, sample, retrack, batch, onBatchEnd, assertStatic, subclock, _getInternalState, runWithOwner, Owner, getOwner, createContext, useContext, runWithContext } from "../built/state.js";

function serializer(target, load, store) {
	const silencedData = silenceEcho(target)

	createEffect(()=>{
		const data = silencedData()
		batch(()=>{
			untrack(()=>{
				load(data)
			})
		})

		let firstTime = true
		createEffect(()=>{
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
	createEffect(()=>{
		signal()
		if (!updateFromHere) {
			fire(true)
		}
	})

	return toSignal(()=>{
		fire()
		return sample(signal)
	}, (val)=>{
		updateFromHere = true
		subclock(()=>{
			signal(val)
		})
		updateFromHere = false
	})
}

describe("@dynein/state", () => {
	describe("createSignal", () => {
		it("disallows multiple arguments to set", () => {
			const signal = createSignal(1);
			assert.throws(() => signal(2, 3, 4));
		});

		it("returns the initial value", () => {
			assert.strictEqual(createSignal(1)(), 1);
		});

		it("sets the value", () => {
			const signal = createSignal(1);
			signal(2);
			assert.strictEqual(signal(), 2);
		});

		it("sets the value for sample", () => {
			const signal = createSignal(1);
			signal(2);
			assert.strictEqual(sample(signal), 2);
		});
	});

	describe("createRoot", () => {
		it("passes errors", () => {
			assert.throws(() => {
				createRoot(() => {
					throw new Error("err");
				});
			});
		});

		it("restores current computation after throw", () => {
			const before = _getInternalState().currentOwnerOwner;
			try {
				createRoot(() => {
					throw new Error("err");
				});
			} catch (err) {}
			assert.strictEqual(_getInternalState().currentOwnerOwner, before);
		});
	});

	describe("createEffect", () => {
		it("disallows 0 arguments", () => {
			createRoot(() => {
				assert.throws(() => createEffect());
			});
		});

		it("creates a watcher", () => {
			createRoot(() => {
				assert.doesNotThrow(() => {
					const signal = createSignal(0);
					createEffect(() => {
						signal();
					});
				});
			});
		});

		it("reexecutes on dependency update", () => {
			const signal = createSignal(0);
			let count = 0;
			createRoot(() => {
				createEffect(() => {
					count++;
					signal();
				});
			});
			assert.strictEqual(count, 1);
			signal(1);
			assert.strictEqual(count, 2);
		});

		it("reexecutes for each dependency update", () => {
			const a = createSignal(0);
			const b = createSignal(0);
			let count = 0;
			createRoot(() => {
				createEffect(() => {
					count++;
					a();
					b();
				});
			});
			assert.strictEqual(count, 1);
			a(1);
			assert.strictEqual(count, 2);
			b(1);
			assert.strictEqual(count, 3);
		});

		it("does not reexecute on equal value update", () => {
			const signal = createSignal(0);
			let count = 0;
			createRoot(() => {
				createEffect(() => {
					count++;
					signal();
				});
			});
			assert.strictEqual(count, 1);
			signal(0);
			assert.strictEqual(count, 1);
		});

		it("does reexecute on equal data update", () => {
			const signal = createSignal(0, true);
			let count = 0;
			createRoot(() => {
				createEffect(() => {
					count++;
					signal();
				});
			});
			assert.strictEqual(count, 1);
			signal(0);
			assert.strictEqual(count, 2);
		});

		it("resets dependencies on recompute", () => {
			let phase = createSignal(false);
			const a = createSignal(0);
			const b = createSignal(0);
			let count = 0;
			createRoot(() => {
				createEffect(() => {
					count++;
					if (!phase()) {
						a();
					} else {
						b();
					}
				});
			});
			assert.strictEqual(count, 1);
			a(1);
			assert.strictEqual(count, 2);
			b(1);
			assert.strictEqual(count, 2);
			phase(true);
			assert.strictEqual(count, 3);
			a(2);
			assert.strictEqual(count, 3);
			b(2);
			assert.strictEqual(count, 4);
		});

		it("encapsulates dependencies", () => {
			let signal = createSignal(0);
			let outerCount = 0;
			let innerCount = 0;
			createRoot(() => {
				createEffect(() => {
					outerCount++;
					createEffect(() => {
						innerCount++;
						signal();
					});
				});
			});
			assert.strictEqual(outerCount, 1);
			assert.strictEqual(innerCount, 1);
			signal(1);
			assert.strictEqual(outerCount, 1);
			assert.strictEqual(innerCount, 2);
		});

		it("destroys subwatchers on recompute", () => {
			let innerWatch = createSignal(true);
			let signal = createSignal(0);
			let outerCount = 0;
			let innerCount = 0;
			createRoot(() => {
				createEffect(() => {
					outerCount++;
					if (innerWatch()) {
						createEffect(() => {
							innerCount++;
							signal();
						});
					}
				});
			});
			assert.strictEqual(outerCount, 1);
			assert.strictEqual(innerCount, 1);
			signal(1);
			assert.strictEqual(outerCount, 1);
			assert.strictEqual(innerCount, 2);
			innerWatch(false);
			assert.strictEqual(outerCount, 2);
			assert.strictEqual(innerCount, 2);
			signal(2);
			assert.strictEqual(outerCount, 2);
			assert.strictEqual(innerCount, 2);
		});

		it("handles destruction of parent within child", ()=>{
			let order = "";
			const a = createSignal("")
			createRoot(() => {
				createEffect(()=>{
					order += "outer{"
					const b = createSignal("")
					createEffect(()=>{
						order += "inner{"
						b(a())

						createEffect(()=>{

						})
						order += "}inner "
					})
					b()
					order += "}outer "
				})
			})
			order = ""
			assert.doesNotThrow(()=>{
				a("a")
			})
			assert.strictEqual(order, "inner{}inner outer{inner{}inner }outer ")
		})

		it("calls cleanup", () => {
			let innerWatch = createSignal(true);
			let signal = createSignal(0);
			let cleanupACount = 0;
			let cleanupBCount = 0;
			createRoot(() => {
				createEffect(() => {
					if (innerWatch()) {
						createEffect(() => {
							signal();
							onCleanup(() => {
								cleanupACount++;
							});
						});
						onCleanup(() => {
							cleanupBCount++;
						});
					}
				});
			});
			assert.strictEqual(cleanupACount, 0);
			assert.strictEqual(cleanupBCount, 0);
			signal(1);
			assert.strictEqual(cleanupACount, 1);
			assert.strictEqual(cleanupBCount, 0);
			signal(2);
			assert.strictEqual(cleanupACount, 2);
			assert.strictEqual(cleanupBCount, 0);
			innerWatch(false);
			assert.strictEqual(cleanupACount, 3);
			assert.strictEqual(cleanupBCount, 1);
			innerWatch(0);
			assert.strictEqual(cleanupACount, 3);
			assert.strictEqual(cleanupBCount, 1);
		});

		it("can be manually destroyed", () => {
			const signal = createSignal(0);
			let count = 0;
			let watcher;
			createRoot(() => {
				watcher = createEffect(() => {
					count++;
					signal();
				});
			});
			assert.strictEqual(count, 1);
			signal(1);
			assert.strictEqual(count, 2);
			watcher.destroy();
			signal(2);
			assert.strictEqual(count, 2);
		});

		it("does not leak the internal Computation instance", () => {
			createRoot(() => {
				createEffect(function () {
					assert.strictEqual(this, undefined);
				});
			});
		});

		it("passes errors", () => {
			createRoot(() => {
				assert.throws(() => {
					createEffect(() => {
						throw new Error("err");
					});
				});
			});
		});

		it("restores current computation after throw", () => {
			createRoot(() => {
				const before = _getInternalState().currentOwner;
				try {
					createEffect(() => {
						throw new Error("err");
					});
				} catch (err) {}
				assert.strictEqual(_getInternalState().currentOwner, before);
			});
		});

		it("keeps running if there are more changes", () => {
			const signal = createSignal(0);
			let count = 0;
			createRoot(() => {
				createEffect(() => {
					count++;
					if (signal() >= 1 && signal() < 5) {
						signal(signal() + 1);
					}
				});
			});
			assert.strictEqual(count, 1);
			signal(1);
			assert.strictEqual(count, 6);
			assert.strictEqual(signal(), 5);
		});

		it("executes in order (test 1)", () => {
			const p1 = createSignal(0);
			const p2 = createSignal(0);
			const p3 = createSignal(0);
			const p4 = createSignal(0);

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

			let order = "";
			createRoot(() => {
				createEffect(() => {
					order += "D{";
					p3();
					p4();
					order += "}D ";
				});
				createEffect(() => {
					order += "C{";
					p4(p2() + Math.random());
					order += "}C ";
				});

				createEffect(() => {
					order += "A{";
					p2(p1() + Math.random());
					order += "}A ";
				});
				createEffect(() => {
					order += "B{";
					p3(p1() + Math.random());
					order += "}B ";
				});
			});
			assert.strictEqual(order, "D{}D C{}C D{}D A{}A C{}C D{}D B{}B D{}D ", "init");
			order = "";
			p1(1);
			assert.strictEqual(order, "A{}A B{}B C{}C D{}D ", "after set");
		});

		it("executes in order (test 2)", () => {
			const p1 = createSignal(0);
			const p2 = createSignal(0);
			const p3 = createSignal(0);
			const p4 = createSignal(0);

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

			let order = "";
			createRoot(() => {
				createEffect(() => {
					order += "C{";
					p4(p2() + 1);
					order += "}C ";
				});
				createEffect(() => {
					order += "D{";
					p3();
					p4();
					order += "}D ";
				});

				createEffect(() => {
					order += "A{";
					p2(p1() + 1);
					order += "}A ";
				});
				createEffect(() => {
					order += "B{";
					p3(p1() + 5);
					order += "}B ";
				});
			});
			assert.strictEqual(order, "C{}C D{}D A{}A C{}C D{}D B{}B D{}D ", "init");
			order = "";
			p1(1);
			assert.strictEqual(order, "A{}A B{}B C{}C D{}D ", "after set");
		});

		it("executes in order (test 3)", () => {
			const p1 = createSignal(0);
			const p2 = createSignal(0);
			const p3 = createSignal(0);
			const p4 = createSignal(0);

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

			let order = "";
			createRoot(() => {
				createEffect(() => {
					order += "C{";
					p4(p2() + 1);
					order += "}C ";
				});
				createEffect(() => {
					order += "D{";
					p3();
					p4();
					order += "}D ";
				});
				createEffect(() => {
					order += "B{";
					p3(p1() + 5);
					order += "}B ";
				});
				createEffect(() => {
					order += "A{";
					p2(p1() + 1);
					order += "}A ";
				});
			});
			assert.strictEqual(order, "C{}C D{}D B{}B D{}D A{}A C{}C D{}D ", "init");
			order = "";
			p1(1);
			assert.strictEqual(order, "B{}B A{}A D{}D C{}C D{}D ", "after set");
		});

		it("executes nested effects in order", ()=>{
			const signal = createSignal(0);
			let order = "";
			createRoot(()=>{
				createEffect(()=>{
					onCleanup(()=>{
						order += "!A1 "
					})

					order += "A{"+signal()+" "
					createEffect(()=>{
						order += "B{"+signal()+" "
						order += "}B "

						onCleanup(()=>{
							order += "!B "
						})
					})
					order += "}A "
					onCleanup(()=>{
						order += "!A2 "
					})
				})
			})

			assert.strictEqual(order, "A{0 B{0 }B }A ", "init");
			order = "";
			signal(1)
			assert.strictEqual(order, "!A1 !B !A2 A{1 B{1 }B }A ", "after set");
		})


		it("delays execution when in watch init", () => {
			const signal = createSignal(0);
			let order = "";
			createRoot(() => {
				createEffect(() => {
					order += "A{";
					signal();
					order += "}A ";
				});
				createEffect(() => {
					order += "B{";
					signal(1);
					order += "}B ";
				});
			});
			assert.strictEqual(order, "A{}A B{}B A{}A ");
		});

		it("delays execution when in watch execute", () => {
			const a = createSignal(1);
			const signal = createSignal(0);
			let order = "";
			createRoot(() => {
				createEffect(() => {
					order += "A{";
					signal();
					order += "}A ";
				});
				createEffect(() => {
					order += "B{";
					signal(a());
					order += "}B ";
				});
			});
			order = "";
			a(2);
			assert.strictEqual(order, "B{}B A{}A ");
		});

		it("batches second stage changes", () => {
			const a = createSignal(0);
			const b = createSignal(0)
			let order = ""
			createRoot(() => {
				createEffect(()=>{
					order += "A{"+a()
					order += "}A "
				})
				createEffect(()=>{
					order += "B{"+b()
					order += "}B "
				})
				createEffect(() => {
					order += "s{"+a()+" "
					if (a() >= 1 && a() < 3) {
						order += "a++{"
						a(a() + 1);
						order += "}a++ "

						order += "b++{"
						b(b() + 1)
						order += "}b++ "
					}
					order += "}s "
				});
			});
			assert.strictEqual(order, "A{0}A B{0}B s{0 }s ");
			order = ""
			a(1)
			assert.strictEqual(order, "A{1}A s{1 a++{}a++ b++{}b++ }s A{2}A s{2 a++{}a++ b++{}b++ }s B{2}B A{3}A s{3 }s ");
		})

		it("subclock (test 1)", () => {
			const a = createSignal(0);
			const b = createSignal(0)
			let order = ""
			createRoot(() => {
				createEffect(()=>{
					order += "A{"+a()
					order += "}A "
				})
				createEffect(()=>{
					order += "B{"+b()
					order += "}B "
				})
				createEffect(() => {
					order += "s{"+a()+" "
					if (a() >= 1 && a() < 3) {
						order += "a++{"
						a(a() + 1);
						order += "}a++ "

						order += "b++{"
						subclock(()=>{
							b(sample(b) + 1)
						})
						order += "}b++ "
					}
					order += "}s "
				});
			});
			assert.strictEqual(order, "A{0}A B{0}B s{0 }s ");
			order = ""
			a(1)
			assert.strictEqual(order, "A{1}A s{1 a++{}a++ b++{B{1}B }b++ }s A{2}A s{2 a++{}a++ b++{B{2}B }b++ }s A{3}A s{3 }s ");
		})

		it("subclock (test 2)", () => {
			const a = createSignal(0);
			const b = createSignal(0)
			let order = ""

			let level = 0
			const log = (v)=>{
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
				createEffect(()=>{
					log("A{"+a())
					log("}A ")
				})
				createEffect(()=>{
					log("B{"+b())
					log("}B ")
				})
				createEffect(() => {
					log("s{"+a()+" ")
					if (a() >= 1 && a() < 3) {
						log("a++{")
						a(a() + 1);
						log("}a++ ")

						log("b++{")
						const newB = sample(b)+1
						b(Math.random()) //schedule to fire
						subclock(()=>{
							subclock(()=>{
								subclock(()=>{
									log("subclock{")
									subclock(()=>{
										log("inner{"+newB+" ")
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
				});
			});
			assert.strictEqual(order, "A{0}A B{0}B s{0 }s ");
			order = ""
			a(1)
			assert.strictEqual(order, "A{1}A s{1 a++{}a++ b++{subclock{inner{1 B{1}B }inner }subclock }b++ }s A{2}A s{2 a++{}a++ b++{subclock{inner{2 B{2}B }inner }subclock }b++ }s A{3}A s{3 }s ");
		})

		it("subclock passes errors without breaking parent update", () => {
			const a = createSignal(0);
			const b = createSignal(0)
			let order = ""
			createRoot(() => {
				createEffect(()=>{
					order += "A{"+a()
					order += "}A "
				})
				createEffect(()=>{
					order += "B{"+b()
					order += "}B "
				})
				createEffect(() => {
					order += "s{"+a()+" "
					if (a() >= 1 && a() < 3) {
						order += "a++{"
						a(a() + 1);
						order += "}a++ "

						order += "b++{"
						subclock(()=>{
							order += "Sclock{"
							b(sample(b) + 1)
							throw new Error("test")
						})
						order += "}b++ "
					}
					order += "}s "
				});
			});
			assert.strictEqual(order, "A{0}A B{0}B s{0 }s ");
			order = ""
			a(1)
			assert.strictEqual(order, "A{1}A s{1 a++{}a++ b++{Sclock{B{1}B A{2}A s{2 a++{}a++ b++{Sclock{B{2}B A{3}A s{3 }s ");
		})

		// See https://github.com/adamhaile/S/issues/32
		// Basically, the data().length shouldn't be run when data() is null
		it("Sjs issue 32", ()=>{
			createRoot(() => {
				const data = createSignal(null, true)
				const cache = createSignal(sample(() => !!data()))
				const child = data => {
					createEffect(() => {
						console.log("nested", data().length)
					});
					return "Hi";
				};
				createEffect(() => {
					cache(!!data())
				});
				const memo = createMemo(() => (cache() ? child(data) : undefined));
				createEffect(() => {
					console.log("view", memo())
				});
				console.log("ON");
				data("name");
				console.log("OFF");
				data(undefined);
			})
		})

		it("effect created inside an exec-pending effect", () => {
			const a = createSignal(0);
			const b = createSignal(0)

			let idCounter = 0
			let order = "";
			createRoot(()=>{
				createEffect(()=>{
					const id = (idCounter++)
					onCleanup(()=>{
						order += `cleanup outer(${id}) `
					})
					order += `outer(${id}) { `
					if (!a()) {
						order += "set a { "
						a(true)
						order += "} set a "
					}

					order += `create inner(${id}) `
					createEffect(()=>{
						onCleanup(()=>{
							order += `cleanup inner(${id}) `
						})
						b()
						order += `run inner(${id}) `
					})
					order += `} outer(${id}) `
				})
			})
			assert.strictEqual(order, "outer(0) { set a { cleanup outer(0) } set a create inner(0) run inner(0) } outer(0) cleanup inner(0) outer(1) { create inner(1) run inner(1) } outer(1) ");
			order = ""
			b(1)
			assert.strictEqual(order, "cleanup inner(1) run inner(1) ");
		})

		// These two tests maybe aren't the most preferable behavior, but its an edge case and
		// there doesn't seem to be an easy way to fix it. In real world-scenarios where you have
		// a self-triggering effect like this (e.g., effect checks a precondition and then
		// fixes it), you should probably return at the end of the `if (!a()) {` block and then
		// the inner effect wouldn't be created twice.
		//
		// Maybe I'll revisit this in the future, but for now this case is undefined behavior,
		// and tested here to document it and make it easy to notice if some future edit to Dynein
		// changes it.
		it("executes but doesn't create an effect created inside an exec-pending effect (subclock) (undefined behavior)", () => {
			const a = createSignal(0);
			const b = createSignal(0)

			let idCounter = 0
			let order = "";
			createRoot(()=>{
				createEffect(()=>{
					const id = (idCounter++)
					onCleanup(()=>{
						order += `cleanup outer(${id}) `
					})
					order += `outer(${id}) { `
					if (!a()) {
						order += "set a { "
						subclock(()=>{
							a(true)
						})
						order += "} set a "
					}

					order += `create inner(${id}) `
					createEffect(()=>{
						b()
						order += `run inner(${id}) `
					})
					order += `} outer(${id}) `
				})
			})
			assert.strictEqual(order, "outer(0) { set a { cleanup outer(0) outer(1) { create inner(1) run inner(1) } outer(1) } set a create inner(0) run inner(0) } outer(0) ");
			order = ""
			b(1)
			assert.strictEqual(order, "run inner(1) run inner(0) ");
		})

		it("doesn't reexecute a destroy-pending watcher", () => {
			const a = createSignal(false);
			const b = createSignal(false);

			let order = "";
			createRoot(() => {
				createEffect(() => {
					order += "outer ";
					if (!a()) {
						createEffect(() => {
							order += "inner ";
							b();
						});
					}
				});
			});
			order = "";
			batch(() => {
				order += "set b "
				b(true);
				order += "set a "
				a(true);
			});
			assert.strictEqual(order, "set b set a outer ");
		});

		it("doesn't execute a watcher forcibly destroyed during a run", () => {
			const signal = createSignal(0)
			let order = "";

			let secondEffect
			createRoot(() => {
				createEffect(() => {
					order += "A{"+signal()+" "
					if (signal() === 1) {
						secondEffect.destroy()
					}
					onCleanup(()=>{
						order += "!A "
					})
					order += "}A "
				})

				secondEffect = createEffect(()=>{
					order += "B{"+signal()+" "
					onCleanup(()=>{
						order += "!B "
					})
					order += "}B "
				})
			})

			assert.strictEqual(order, "A{0 }A B{0 }B ", "init")
			order = "";
			signal(1)
			assert.strictEqual(order, "!A !B A{1 }A ", "after set")
		})
	});

	describe("onUpdate", () => {
		it("calls inner only after the first update after setup", () => {
			const signal = createSignal(0);
			let count = 0;
			createRoot(() => {
				onUpdate(signal, () => {
					count++;
				});
			});
			assert.strictEqual(count, 0);
			signal(1);
			assert.strictEqual(count, 1);
		});

		it("does reexecute on equal data update", () => {
			const signal = createSignal(0, true);
			let count = 0;
			createRoot(() => {
				onUpdate(signal, () => {
					count++;
				});
			});
			assert.strictEqual(count, 0);
			signal(0);
			assert.strictEqual(count, 1);
			signal(0);
			assert.strictEqual(count, 2);
		});

		it("does not track inner deps", () => {
			const signal = createSignal(0);
			const b = createSignal(0);
			let count = 0;
			createRoot(() => {
				onUpdate(signal, () => {
					b()
					count++;
				});
			});
			assert.strictEqual(count, 0);
			signal(1);
			assert.strictEqual(count, 1);
			b(1);
			assert.strictEqual(count, 1);
		});

		it("calls inner with the latest value", () => {
			const signal = createSignal(0);
			let count = 0;
			let calledWithVal = -1
			createRoot(() => {
				onUpdate(signal, (val) => {
					count++
					calledWithVal = val
				});
			});
			assert.strictEqual(count, 0);
			signal(12);
			assert.strictEqual(count, 1);
			assert.strictEqual(calledWithVal, 12);
		});
	})

	describe("untrack", () => {
		it("sets internalState.collectingDependencies", () => {
			untrack(() => {
				assert.strictEqual(_getInternalState().collectingDependencies, false);
			});
		});

		it("sets internalState.assertedStatic", () => {
			assertStatic(() => {
				untrack(() => {
					assert.strictEqual(_getInternalState().assertedStatic, false);
				});
			});
		});

		it("blocks dependency collection", () => {
			let count = 0;
			let signal = createSignal(0);
			createRoot(() => {
				createEffect(() => {
					count++;
					untrack(() => {
						signal();
					});
				});
			});
			assert.strictEqual(count, 1);
			signal(1);
			assert.strictEqual(count, 1);
		});

		it("passes errors", () => {
			assert.throws(() => {
				untrack(() => {
					throw new Error("err");
				});
			});
		});

		it("restores current computation after throw", () => {
			createRoot(() => {
				createEffect(() => {
					const before = _getInternalState().currentOwnerOwner;
					try {
						untrack(() => {
							throw new Error("err");
						});
					} catch (err) {}
					assert.strictEqual(_getInternalState().currentOwnerOwner, before);
				});
			});
		});

		it("pops collectingDependencies state (false)", () => {
			untrack(() => {
				untrack(() => {});
				assert.strictEqual(_getInternalState().collectingDependencies, false);
			});
		});

		it("pops collectingDependencies state (true)", () => {
			assert.strictEqual(_getInternalState().collectingDependencies, false);
			createRoot(()=>{
				createEffect(()=>{
					untrack(() => {});
					assert.strictEqual(_getInternalState().collectingDependencies, true);
				});
			})
		});

		it("pops collectingDependencies state after throw (false)", () => {
			untrack(() => {
				try {
					untrack(() => {
						throw new Error("err");
					});
				} catch (err) {}
				assert.strictEqual(_getInternalState().collectingDependencies, false);
			});
		});

		it("pops collectingDependencies state after throw (true)", () => {
			assert.strictEqual(_getInternalState().collectingDependencies, false);
			createRoot(()=>{
				createEffect(()=>{
					try {
						untrack(() => {
							throw new Error("err");
						});
					} catch (err) {}
					assert.strictEqual(_getInternalState().collectingDependencies, true);
				});
			})
		});

		it("pops assertedStatic state (true)", () => {
			assertStatic(() => {
				untrack(() => {});
				assert.strictEqual(_getInternalState().assertedStatic, true);
			});
		});

		it("pops assertedStatic state after throw (true)", () => {
			assertStatic(() => {
				try {
					untrack(() => {
						throw new Error("err");
					});
				} catch (err) {}
				assert.strictEqual(_getInternalState().assertedStatic, true);
			});
		});
	});

	describe("retrack", () => {
		it("sets internalState.collectingDependencies", () => {
			untrack(() => {
				retrack(() => {
					assert.strictEqual(_getInternalState().collectingDependencies, true);
				});
			});
		});

		it("does not set internalState.assertedStatic", () => {
			assertStatic(() => {
				retrack(() => {
					assert.strictEqual(_getInternalState().assertedStatic, true);
				});
			});
		});

		it("does not set internalState.assertedStatic", () => {
			retrack(() => {
				assert.strictEqual(_getInternalState().assertedStatic, false);
			});
		});

		it("cancels untrack", () => {
			let count = 0;
			let signal = createSignal(0);
			createRoot(() => {
				createEffect(() => {
					count++;
					untrack(() => {
						retrack(() => {
							signal();
						});
					});
				});
			});
			assert.strictEqual(count, 1);
			signal(1);
			assert.strictEqual(count, 2);
		});

		it("passes errors", () => {
			assert.throws(() => {
				retrack(() => {
					throw new Error("err");
				});
			});
		});

		it("pops collectingDependencies state (false)", () => {
			untrack(() => {
				retrack(() => {});
				assert.strictEqual(_getInternalState().collectingDependencies, false);
			});
		});

		it("pops collectingDependencies state after throw (false)", () => {
			untrack(() => {
				try {
					retrack(() => {
						throw new Error("err");
					});
				} catch (err) {}
				assert.strictEqual(_getInternalState().collectingDependencies, false);
			});
		});
	});

	describe("assertStatic", () => {
		it("sets internalState.collectingDependencies", () => {
			assertStatic(() => {
				assert.strictEqual(_getInternalState().collectingDependencies, false);
			});
		});

		it("sets internalState.assertedStatic", () => {
			assertStatic(() => {
				assert.strictEqual(_getInternalState().assertedStatic, true);
			});
		});
	});

	describe("toSignal", () => {
		it("creates something portlike", () => {
			let setVal;
			let signal = toSignal(
				() => 5,
				(val) => {
					setVal = val;
				}
			);
			assert.strictEqual(signal(), 5);
			signal(3);
			assert.strictEqual(setVal, 3);
			assert.strictEqual(signal(), 5);
		});

		it("does not have internal state", () => {
			let count = 0;
			let setVal;
			let signal = toSignal(
				() => 5,
				(val) => {
					setVal = val;
				}
			);

			createRoot(() => {
				createEffect(() => {
					count++;
					signal();
				});
			});
			assert.strictEqual(count, 1);
			signal(1);
			assert.strictEqual(count, 1);
		});
	});

	describe("batch", () => {
		it("batches updates", () => {
			const a = createSignal(0);
			const b = createSignal(0);
			let count = 0;
			createRoot(() => {
				createEffect(() => {
					count++;
					a();
					b();
				});
			});
			assert.strictEqual(count, 1);
			batch(() => {
				a(1);
				assert.strictEqual(count, 1);
				b(1);
				assert.strictEqual(count, 1);
				a(2);
				assert.strictEqual(count, 1);
				b(2);
				assert.strictEqual(count, 1);
			});
			assert.strictEqual(count, 2);
		});

		it("allows ports to update before the end of the batch", () => {
			const a = createSignal(0);
			const b = createSignal(0);
			let count = 0;
			createRoot(() => {
				createEffect(() => {
					count++;
					a();
					b();
				});
			});
			batch(() => {
				a(1);
				b(1);
				assert.strictEqual(a(), 1);
				assert.strictEqual(b(), 1);
			});
		});


		it("allows ports to update more than once", () => {
			const a = createSignal(0);
			const b = createSignal(0);
			let count = 0;
			createRoot(() => {
				createEffect(() => {
					count++;
					a();
					b();
				});
			});
			batch(() => {
				a(1);
				b(1);
				a(2);
				assert.strictEqual(a(), 2);
			});
		});

		it("passes errors", () => {
			assert.throws(() => {
				batch(() => {
					throw new Error("err");
				});
			});
		});
	});

	describe("onBatchEnd", ()=>{
		it("runs immediately outside of a batch", ()=>{
			let ran = false
			onBatchEnd(()=>{
				ran = true
			})
			assert.strictEqual(ran, true)
		})

		it("runs at the end of a batch", ()=>{
			let order = ""
			batch(()=>{
				order += "a "
				onBatchEnd(()=>{
					order += "end"
				})
				order += "b "
			})
			assert.strictEqual(order, "a b end")
		})

		it("runs at the end of all batches", ()=>{
			let order = ""
			batch(()=>{
				order += "a "

				batch(()=>{
					order += "b "
					batch(()=>{
						order += "c "
						onBatchEnd(()=>{
							order += "end"
						})
						order += "d "
					})
					order += "e "
				})
				order += "f "
			})
			assert.strictEqual(order, "a b c d e f end")
		})

		it("runs in order with effects in a batch", ()=>{
			let a = createSignal(0)

			let order = ""
			createRoot(()=>{
				createEffect(()=>{
					order += "A{"
					a()
					order += "}A "
				})
			})


			order += "B{"
			batch(()=>{
				order+= "#1 "
				onBatchEnd(()=>{
					order += "end "
				})
				order+= "#2 "
				a(1)
				order+= "#3 "
			})
			order += "}B"
			assert.strictEqual(order, "A{}A B{#1 #2 #3 end A{}A }B")
		})

		it("does not pass errors (1)", ()=>{
			assert.doesNotThrow(()=>{
				onBatchEnd(()=>{
					throw new Error("test")
				})
			})
		})

		it("does not pass errors (2)", ()=>{
			assert.doesNotThrow(()=>{
				batch(()=>{
					onBatchEnd(()=>{
						throw new Error("test")
					})
				})
			})
		})
	})

	describe("onCleanup", ()=>{
		it("can trigger an effect update without causing an infinite loop", ()=>{
			const sig = createSignal(0)
			createRoot(()=>{
				createEffect(() => {
					const val = sig()
					onCleanup(()=>{
						sig(sig()+1)
					})
				})
			})
			assert.strictEqual(sig(), 0);
			assert.doesNotThrow(()=>sig(1))
			assert.strictEqual(sig(), 2);
		})

		it("isolates owner", ()=>{
			const sig = createSignal(0)
			let innerOwner = "a"
			createRoot(()=>{
				createEffect(() => {
					const val = sig()
					onCleanup(()=>{
						innerOwner = getOwner()
					})
				})
				sig(1)
			})

			assert.strictEqual(innerOwner, undefined);
		})

		it("isolates errors", () => {
			const sig = createSignal(0)
			let log = ""
			createRoot(()=>{
				createEffect(() => {
					const val = sig()
					onCleanup(()=>{
						log += "a"
						throw new Error("Test err")
					})
					onCleanup(()=>{
						log += "b"
					})
				})
			})
			assert.strictEqual(log, "");
			assert.doesNotThrow(()=>sig(1))
			assert.strictEqual(log, "ab");
		})
	})

	describe("runWithOwner", ()=>{
		it("sets owner", ()=>{
			const owner1 = new Owner(null)
			const owner2 = new Owner(null)

			let innerOwner
			runWithOwner(owner1, ()=>{
				runWithOwner(owner2, ()=>{
					innerOwner = getOwner()
				})
			})

			assert.strictEqual(innerOwner, owner2)
		})

		it("isolates owner", ()=>{
			const owner1 = new Owner(null)
			const owner2 = new Owner(null)

			let innerOwner1
			let innerOwner2
			runWithOwner(owner1, ()=>{
				runWithOwner(owner2, ()=>{
					innerOwner2 = getOwner()
				})
				innerOwner1 = getOwner()
			})

			assert.strictEqual(innerOwner2, owner2)
			assert.strictEqual(innerOwner1, owner1)
		})

		it("passes errors", ()=>{
			const owner1 = new Owner(null)
			assert.throws(()=>{
				runWithOwner(owner1, ()=>{
					throw new Error("test")
				})
			})
		})

		it("allows setting owner === null", ()=>{
			let innerOwner
			const owner1 = new Owner(null)
			runWithOwner(owner1, ()=>{
				runWithOwner(null, ()=>{
					innerOwner = getOwner()
				})
			})

			assert.strictEqual(innerOwner, null)
		})

		it("allows setting owner === undefined", ()=>{
			let innerOwner
			const owner1 = new Owner(null)
			runWithOwner(owner1, ()=>{
				runWithOwner(undefined, ()=>{
					innerOwner = getOwner()
				})
			})

			assert.strictEqual(innerOwner, undefined)
		})

		it("passes dependency collection when saved in a tracking context", ()=>{
			let runs = 0
			let sig1 = createSignal(0)
			let sig2 = createSignal(0)

			let savedOwner

			createRoot(()=>{
				createEffect(()=>{
					sig1()
					runs++
					savedOwner = getOwner()
				})
			})

			createRoot(()=>{
				createEffect(()=>{
					untrack(()=>{
						runWithOwner(savedOwner, ()=>{
							sig2()
							assert.strictEqual(_getInternalState().assertedStatic, false)
							assert.strictEqual(_getInternalState().collectingDependencies, true)
						})
					})
				})
			})

			assert.strictEqual(runs, 1)
			sig2(1)
			assert.strictEqual(runs, 2)
			sig1(1)
			assert.strictEqual(runs, 3)
		})

		it("does not cause dependency collection when saved in a non-tracking context", ()=>{
			let runs = 0
			let sig1 = createSignal(0)
			let sig2 = createSignal(0)

			let savedOwner
			createRoot(()=>{
				createEffect(()=>{
					sig1()
					runs++
					assertStatic(()=>{
						savedOwner = getOwner()
					})
				})
			})

			runWithOwner(savedOwner, ()=>{
				sig2()
				assert.strictEqual(_getInternalState().assertedStatic, true)
				assert.strictEqual(_getInternalState().collectingDependencies, false)
			})

			assert.strictEqual(runs, 1)
			sig2(1)
			assert.strictEqual(runs, 1)
			sig1(1)
			assert.strictEqual(runs, 2)
		})
	})

	describe("createContext", ()=>{
		it("creates a context", ()=>{
			const ctx = createContext(0)
		})
	})

	describe("useContext", ()=>{
		it("returns the default value if called outside an owner", ()=>{
			const ctx = createContext(42)

			runWithOwner(undefined, ()=>{
				assert.strictEqual(useContext(ctx), 42)
			})
		})

		it("returns the default value if called with a null owner", ()=>{
			const ctx = createContext(42)

			runWithOwner(null, ()=>{
				assert.strictEqual(useContext(ctx), 42)
			})
		})

		it("returns the default value if called with an owner", ()=>{
			const ctx = createContext(42)

			const owner = new Owner(null)
			runWithOwner(owner, ()=>{
				assert.strictEqual(useContext(ctx), 42)
			})
		})

		it("returns undefined if no default value is set", ()=>{
			const ctx = createContext()

			const owner = new Owner(null)
			runWithOwner(owner, ()=>{
				assert.strictEqual(useContext(ctx), undefined)
			})
		})

		it("returns the value from a saved owner (1)", ()=>{
			const ctx = createContext()

			let owner
			runWithOwner(new Owner(null), ()=>{
				runWithContext(ctx, 5, ()=>{
					owner = getOwner()
				})
			})
			runWithOwner(owner, ()=>{
				assert.strictEqual(useContext(ctx), 5)
			})
		})

		it("returns the value from a saved owner (2)", ()=>{
			const ctx = createContext()

			let owner
			runWithOwner(new Owner(null), ()=>{
				runWithContext(ctx, 5, ()=>{
					owner = getOwner()
				})
			})
			runWithContext(ctx, 2, ()=>{
				runWithOwner(owner, ()=>{
					assert.strictEqual(useContext(ctx), 5)
				})
			})
		})

		it("handles nested restore from a saved owner", ()=>{
			const ctx = createContext()

			let owner
			runWithOwner(new Owner(null), ()=>{
				runWithContext(ctx, 5, ()=>{
					owner = getOwner()
				})
			})

			runWithContext(ctx, 2, ()=>{
				assert.strictEqual(useContext(ctx), 2)
				runWithOwner(owner, ()=>{
					assert.strictEqual(useContext(ctx), 5)
					runWithContext(ctx, 3, ()=>{
						assert.strictEqual(useContext(ctx), 3)
						runWithOwner(owner, ()=>{
							assert.strictEqual(useContext(ctx), 5)
						})
						assert.strictEqual(useContext(ctx), 3)
					})
					assert.strictEqual(useContext(ctx), 5)
				})
				assert.strictEqual(useContext(ctx), 2)
			})
		})

		it("returns the value from a saved root owner (1)", ()=>{
			const ctx = createContext()

			let owner
			runWithContext(ctx, 5, ()=>{
				owner = getOwner()
			})
			runWithOwner(owner, ()=>{
				assert.strictEqual(useContext(ctx), 5)
			})
		})

		it("returns the value from a saved root owner (2)", ()=>{
			const ctx = createContext()

			let owner
			runWithContext(ctx, 5, ()=>{
				owner = getOwner()
			})
			runWithContext(ctx, 2, ()=>{
				runWithOwner(owner, ()=>{
					assert.strictEqual(useContext(ctx), 5)
				})
			})
		})


		it("resets to an unset value in a saved owner", ()=>{
			const a = createContext()
			const b = createContext()

			let owner
			runWithContext(a, 5, ()=>{
				owner = getOwner()
			})
			runWithContext(b, 2, ()=>{
				runWithOwner(owner, ()=>{
					assert.strictEqual(useContext(a), 5, "check a")
					assert.strictEqual(useContext(b), undefined, "check b")
				})
			})
		})
	})

	describe("runWithContext", ()=>{
		it("sets the context", ()=>{
			const ctx = createContext()

			runWithContext(ctx, 5, ()=>{
				assert.strictEqual(useContext(ctx), 5)
			})
		})

		it("handles nested context assignments", ()=>{
			const ctx = createContext()

			runWithContext(ctx, 5, ()=>{
				assert.strictEqual(useContext(ctx), 5)
				runWithContext(ctx, 10, ()=>{
					assert.strictEqual(useContext(ctx), 10)
				})
				assert.strictEqual(useContext(ctx), 5)
			})
		})

		it("handles errors", ()=>{
			const ctx = createContext()

			runWithContext(ctx, 5, ()=>{
				assert.throws(()=>{
					runWithContext(ctx, 10, ()=>{
						throw new Error("Test")
					})
				})
				assert.strictEqual(useContext(ctx), 5)
			})
		})

		it("handles multiple contexts", ()=>{
			const a = createContext()
			const b = createContext(2)

			assert.strictEqual(useContext(a), undefined)
			runWithContext(a, 5, ()=>{
				assert.strictEqual(useContext(a), 5)
				assert.strictEqual(useContext(b), 2)
				runWithContext(b, 10, ()=>{
					assert.strictEqual(useContext(a), 5)
					assert.strictEqual(useContext(b), 10)
				})
				assert.strictEqual(useContext(a), 5)
				assert.strictEqual(useContext(b), 2)
			})
		})

		it("returns the inner return value", ()=>{
			const ctx = createContext()

			const result = runWithContext(ctx, 5, ()=>{
				assert.strictEqual(useContext(ctx), 5)

				return "a"
			})

			assert.strictEqual(result, "a")
		})
	})
});
