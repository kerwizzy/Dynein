import { default as DyneinState, getInternalState } from "../built/state.js";

const D = { state: DyneinState };

describe("D.state", () => {
	describe("D.state.value", () => {
		it("disallows multiple arguments to set", () => {
			const port = D.state.value(1);
			assert.throws(() => port(2, 3, 4));
		});

		it("returns the initial value", () => {
			assert.strictEqual(D.state.value(1)(), 1);
		});

		it("sets the value", () => {
			const port = D.state.value(1);
			port(2);
			assert.strictEqual(port(), 2);
		});

		it("sets the value for sample", () => {
			const port = D.state.value(1);
			port(2);
			assert.strictEqual(port.sample(), 2);
		});

		it("disallows setting .sample", () => {
			const port = D.state.value(1);
			assert.throws(() => port.sample(2));
		});
	});

	describe("D.state.root", () => {
		it("passes errors", () => {
			assert.throws(() => {
				D.state.root(() => {
					throw new Error("err");
				});
			});
		});

		it("restores current computation after throw", () => {
			const before = getInternalState().currentContext;
			try {
				D.state.root(() => {
					throw new Error("err");
				});
			} catch (err) {}
			assert.strictEqual(getInternalState().currentContext, before);
		});
	});

	describe("D.state.watch", () => {
		it("disallows 0 arguments", () => {
			D.state.root(() => {
				assert.throws(() => D.state.watch());
			});
		});

		it("creates a watcher", () => {
			D.state.root(() => {
				assert.doesNotThrow(() => {
					const port = D.state.value(0);
					D.state.watch(() => {
						port();
					});
				});
			});
		});

		it("reexecutes on dependency update", () => {
			const port = D.state.value(0);
			let count = 0;
			D.state.root(() => {
				D.state.watch(() => {
					count++;
					port();
				});
			});
			assert.strictEqual(count, 1);
			port(1);
			assert.strictEqual(count, 2);
		});

		it("reexecutes for each dependency update", () => {
			const a = D.state.value(0);
			const b = D.state.value(0);
			let count = 0;
			D.state.root(() => {
				D.state.watch(() => {
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
			const port = D.state.value(0);
			let count = 0;
			D.state.root(() => {
				D.state.watch(() => {
					count++;
					port();
				});
			});
			assert.strictEqual(count, 1);
			port(0);
			assert.strictEqual(count, 1);
		});

		it("does reexecute on equal data update", () => {
			const port = D.state.data(0);
			let count = 0;
			D.state.root(() => {
				D.state.watch(() => {
					count++;
					port();
				});
			});
			assert.strictEqual(count, 1);
			port(0);
			assert.strictEqual(count, 2);
		});

		it("resets dependencies on recompute", () => {
			let phase = D.state.value(false);
			const a = D.state.value(0);
			const b = D.state.value(0);
			let count = 0;
			D.state.root(() => {
				D.state.watch(() => {
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
			let port = D.state.value(0);
			let outerCount = 0;
			let innerCount = 0;
			D.state.root(() => {
				D.state.watch(() => {
					outerCount++;
					D.state.watch(() => {
						innerCount++;
						port();
					});
				});
			});
			assert.strictEqual(outerCount, 1);
			assert.strictEqual(innerCount, 1);
			port(1);
			assert.strictEqual(outerCount, 1);
			assert.strictEqual(innerCount, 2);
		});

		it("destroys subwatchers on recompute", () => {
			let innerWatch = D.state.value(true);
			let port = D.state.value(0);
			let outerCount = 0;
			let innerCount = 0;
			D.state.root(() => {
				D.state.watch(() => {
					outerCount++;
					if (innerWatch()) {
						D.state.watch(() => {
							innerCount++;
							port();
						});
					}
				});
			});
			assert.strictEqual(outerCount, 1);
			assert.strictEqual(innerCount, 1);
			port(1);
			assert.strictEqual(outerCount, 1);
			assert.strictEqual(innerCount, 2);
			innerWatch(false);
			assert.strictEqual(outerCount, 2);
			assert.strictEqual(innerCount, 2);
			port(2);
			assert.strictEqual(outerCount, 2);
			assert.strictEqual(innerCount, 2);
		});

		it("calls cleanup", () => {
			let innerWatch = D.state.value(true);
			let port = D.state.value(0);
			let cleanupACount = 0;
			let cleanupBCount = 0;
			D.state.root(() => {
				D.state.watch(() => {
					if (innerWatch()) {
						D.state.watch(() => {
							port();
							D.state.cleanup(() => {
								cleanupACount++;
							});
						});
						D.state.cleanup(() => {
							cleanupBCount++;
						});
					}
				});
			});
			assert.strictEqual(cleanupACount, 0);
			assert.strictEqual(cleanupBCount, 0);
			port(1);
			assert.strictEqual(cleanupACount, 1);
			assert.strictEqual(cleanupBCount, 0);
			port(2);
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
			const port = D.state.value(0);
			let count = 0;
			let watcher;
			D.state.root(() => {
				watcher = D.state.watch(() => {
					count++;
					port();
				});
			});
			assert.strictEqual(count, 1);
			port(1);
			assert.strictEqual(count, 2);
			watcher.destroy();
			port(2);
			assert.strictEqual(count, 2);
		});

		it("does not leak the internal Computation instance", () => {
			D.state.root(() => {
				D.state.watch(function () {
					assert.strictEqual(this, undefined);
				});
			});
		});

		it("passes errors", () => {
			D.state.root(() => {
				assert.throws(() => {
					D.state.watch(() => {
						throw new Error("err");
					});
				});
			});
		});

		it("restores current computation after throw", () => {
			D.state.root(() => {
				const before = getInternalState().currentContext;
				try {
					D.state.watch(() => {
						throw new Error("err");
					});
				} catch (err) {}
				assert.strictEqual(getInternalState().currentContext, before);
			});
		});

		it("keeps running if there are more changes", () => {
			const port = D.state.value(0);
			let count = 0;
			D.state.root(() => {
				D.state.watch(() => {
					count++;
					if (port() >= 1 && port() < 5) {
						port(port() + 1);
					}
				});
			});
			assert.strictEqual(count, 1);
			port(1);
			assert.strictEqual(count, 6);
			assert.strictEqual(port(), 5);
		});

		it("executes in order (test 1)", () => {
			const p1 = D.state.value(0);
			const p2 = D.state.value(0);
			const p3 = D.state.value(0);
			const p4 = D.state.value(0);

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
			D.state.root(() => {
				D.state.watch(() => {
					order += "D{";
					p3();
					p4();
					order += "}D ";
				});
				D.state.watch(() => {
					order += "C{";
					p4(p2() + Math.random());
					order += "}C ";
				});

				D.state.watch(() => {
					order += "A{";
					p2(p1() + Math.random());
					order += "}A ";
				});
				D.state.watch(() => {
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
			const p1 = D.state.value(0);
			const p2 = D.state.value(0);
			const p3 = D.state.value(0);
			const p4 = D.state.value(0);

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
			D.state.root(() => {
				D.state.watch(() => {
					order += "C{";
					p4(p2() + 1);
					order += "}C ";
				});
				D.state.watch(() => {
					order += "D{";
					p3();
					p4();
					order += "}D ";
				});

				D.state.watch(() => {
					order += "A{";
					p2(p1() + 1);
					order += "}A ";
				});
				D.state.watch(() => {
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
			const p1 = D.state.value(0);
			const p2 = D.state.value(0);
			const p3 = D.state.value(0);
			const p4 = D.state.value(0);

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
			D.state.root(() => {
				D.state.watch(() => {
					order += "C{";
					p4(p2() + 1);
					order += "}C ";
				});
				D.state.watch(() => {
					order += "D{";
					p3();
					p4();
					order += "}D ";
				});
				D.state.watch(() => {
					order += "B{";
					p3(p1() + 5);
					order += "}B ";
				});
				D.state.watch(() => {
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

		it("delays execution when in watch init", () => {
			const port = D.state.value(0);
			let order = "";
			D.state.root(() => {
				D.state.watch(() => {
					order += "A{";
					port();
					order += "}A ";
				});
				D.state.watch(() => {
					order += "B{";
					port(1);
					order += "}B ";
				});
			});
			assert.strictEqual(order, "A{}A B{}B A{}A ");
		});

		it("delays execution when in watch execute", () => {
			const a = D.state.value(1);
			const port = D.state.value(0);
			let order = "";
			D.state.root(() => {
				D.state.watch(() => {
					order += "A{";
					port();
					order += "}A ";
				});
				D.state.watch(() => {
					order += "B{";
					port(a());
					order += "}B ";
				});
			});
			order = "";
			a(2);
			assert.strictEqual(order, "B{}B A{}A ");
		});

		it("batches second stage changes", () => {
			const a = D.state.value(0);
			const b = D.state.value(0)
			let order = ""
			D.state.root(() => {
				D.state.watch(()=>{
					order += "A{"+a()
					order += "}A "
				})
				D.state.watch(()=>{
					order += "B{"+b()
					order += "}B "
				})
				D.state.watch(() => {
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
			const a = D.state.value(0);
			const b = D.state.value(0)
			let order = ""
			D.state.root(() => {
				D.state.watch(()=>{
					order += "A{"+a()
					order += "}A "
				})
				D.state.watch(()=>{
					order += "B{"+b()
					order += "}B "
				})
				D.state.watch(() => {
					order += "s{"+a()+" "
					if (a() >= 1 && a() < 3) {
						order += "a++{"
						a(a() + 1);
						order += "}a++ "

						order += "b++{"
						D.state.subclock(()=>{
							b(D.state.sample(b) + 1)
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
			const a = D.state.value(0);
			const b = D.state.value(0)
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


			D.state.root(() => {
				D.state.watch(()=>{
					log("A{"+a())
					log("}A ")
				})
				D.state.watch(()=>{
					log("B{"+b())
					log("}B ")
				})
				D.state.watch(() => {
					log("s{"+a()+" ")
					if (a() >= 1 && a() < 3) {
						log("a++{")
						a(a() + 1);
						log("}a++ ")

						log("b++{")
						const newB = D.state.sample(b)+1
						b(Math.random()) //schedule to fire
						D.state.subclock(()=>{
							D.state.subclock(()=>{
								D.state.subclock(()=>{
									log("subclock{")
									D.state.subclock(()=>{
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

		it("Sjs issue 32", ()=>{
			D.state.root(() => {
				const data = D.state.data(null)
				const cache = D.state.value(D.state.sample(() => !!data()))
				const child = data => {
					D.state.watch(() => {
						console.log("nested", data().length)
					});
					return "Hi";
				};
				D.state.watch(() => {
					cache(!!data())
				});
				const memo = D.state.memo(() => (cache() ? child(data) : undefined));
				D.state.watch(() => {
					console.log("view", memo())
				});
				console.log("ON");
				data("name");
				console.log("OFF");
				data(undefined);
			})
		})

		it("Doesn't execute a destroy-pending watcher", () => {
			const a = D.state.value(false);
			const b = D.state.value(false);

			let order = "";
			D.state.root(() => {
				D.state.watch(() => {
					order += "outer ";
					if (!a()) {
						D.state.watch(() => {
							order += "inner ";
							b();
						});
					}
				});
			});
			order = "";
			D.state.batch(() => {
				b(true);
				a(true);
			});
			assert.strictEqual(order, "outer ");
		});
	});

	describe("D.state.ignore", () => {
		it("sets internalState.ignored", () => {
			D.state.ignore(() => {
				assert.strictEqual(getInternalState().ignored, true);
			});
		});

		it("sets internalState.warnOnNoDepAdd", () => {
			D.state.expectStatic(() => {
				D.state.ignore(() => {
					assert.strictEqual(getInternalState().warnOnNoDepAdd, false);
				});
			});
		});

		it("blocks dependency collection", () => {
			let count = 0;
			let port = D.state.value(0);
			D.state.root(() => {
				D.state.watch(() => {
					count++;
					D.state.ignore(() => {
						port();
					});
				});
			});
			assert.strictEqual(count, 1);
			port(1);
			assert.strictEqual(count, 1);
		});

		it("passes errors", () => {
			assert.throws(() => {
				D.state.ignore(() => {
					throw new Error("err");
				});
			});
		});

		it("restores current computation after throw", () => {
			D.state.root(() => {
				D.state.watch(() => {
					const before = getInternalState().currentContext;
					try {
						D.state.ignore(() => {
							throw new Error("err");
						});
					} catch (err) {}
					assert.strictEqual(getInternalState().currentContext, before);
				});
			});
		});

		it("pops ignore state (true)", () => {
			D.state.ignore(() => {
				D.state.ignore(() => {});
				assert.strictEqual(getInternalState().ignored, true);
			});
		});

		it("pops ignore state (false)", () => {
			D.state.ignore(() => {});
			assert.strictEqual(getInternalState().ignored, false);
		});

		it("pops ignore state after throw (true)", () => {
			D.state.ignore(() => {
				try {
					D.state.ignore(() => {
						throw new Error("err");
					});
				} catch (err) {}
				assert.strictEqual(getInternalState().ignored, true);
			});
		});

		it("pops ignore state after throw (false)", () => {
			try {
				D.state.ignore(() => {
					throw new Error("err");
				});
			} catch (err) {}
			assert.strictEqual(getInternalState().ignored, false);
		});

		it("pops warnOnDep state (true)", () => {
			D.state.expectStatic(() => {
				D.state.ignore(() => {});
				assert.strictEqual(getInternalState().warnOnNoDepAdd, true);
			});
		});

		it("pops warnOnDep state after throw (true)", () => {
			D.state.expectStatic(() => {
				try {
					D.state.ignore(() => {
						throw new Error("err");
					});
				} catch (err) {}
				assert.strictEqual(getInternalState().warnOnNoDepAdd, true);
			});
		});
	});

	describe("D.state.unignore", () => {
		it("sets internalState.ignored", () => {
			D.state.ignore(() => {
				D.state.unignore(() => {
					assert.strictEqual(getInternalState().ignored, false);
				});
			});
		});

		it("does not set internalState.warnOnNoDepAdd", () => {
			D.state.expectStatic(() => {
				D.state.unignore(() => {
					assert.strictEqual(getInternalState().warnOnNoDepAdd, true);
				});
			});
		});

		it("does not set internalState.warnOnNoDepAdd", () => {
			D.state.unignore(() => {
				assert.strictEqual(getInternalState().warnOnNoDepAdd, false);
			});
		});

		it("cancels ignore", () => {
			let count = 0;
			let port = D.state.value(0);
			D.state.root(() => {
				D.state.watch(() => {
					count++;
					D.state.ignore(() => {
						D.state.unignore(() => {
							port();
						});
					});
				});
			});
			assert.strictEqual(count, 1);
			port(1);
			assert.strictEqual(count, 2);
		});

		it("passes errors", () => {
			assert.throws(() => {
				D.state.unignore(() => {
					throw new Error("err");
				});
			});
		});

		it("pops ignore state (true)", () => {
			D.state.ignore(() => {
				D.state.unignore(() => {});
				assert.strictEqual(getInternalState().ignored, true);
			});
		});

		it("pops ignore state after throw (true)", () => {
			D.state.ignore(() => {
				try {
					D.state.unignore(() => {
						throw new Error("err");
					});
				} catch (err) {}
				assert.strictEqual(getInternalState().ignored, true);
			});
		});
	});

	describe("D.state.expectStatic", () => {
		it("sets internalState.ignored", () => {
			D.state.expectStatic(() => {
				assert.strictEqual(getInternalState().ignored, true);
			});
		});

		it("sets internalState.warnOnNoDepAdd", () => {
			D.state.expectStatic(() => {
				assert.strictEqual(getInternalState().warnOnNoDepAdd, true);
			});
		});
	});

	describe("D.state.makePort", () => {
		it("creates something portlike", () => {
			let setVal;
			let port = D.state.makePort(
				() => 5,
				(val) => {
					setVal = val;
				}
			);
			assert.strictEqual(port(), 5);
			port(3);
			assert.strictEqual(setVal, 3);
			assert.strictEqual(port(), 5);
			assert.strictEqual(port.sample(), 5);
		});

		it("does not have internal state", () => {
			let count = 0;
			let setVal;
			let port = D.state.makePort(
				() => 5,
				(val) => {
					setVal = val;
				}
			);

			D.state.root(() => {
				D.state.watch(() => {
					count++;
					port();
				});
			});
			assert.strictEqual(count, 1);
			port(1);
			assert.strictEqual(count, 1);
		});
	});

	describe("D.state.batch", () => {
		it("batches updates", () => {
			const a = D.state.value(0);
			const b = D.state.value(0);
			let count = 0;
			D.state.root(() => {
				D.state.watch(() => {
					count++;
					a();
					b();
				});
			});
			assert.strictEqual(count, 1);
			D.state.batch(() => {
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
			const a = D.state.value(0);
			const b = D.state.value(0);
			let count = 0;
			D.state.root(() => {
				D.state.watch(() => {
					count++;
					a();
					b();
				});
			});
			D.state.batch(() => {
				a(1);
				b(1);
				assert.strictEqual(a(), 1);
				assert.strictEqual(b(), 1);
			});
		});

		it("allows ports to update more than once", () => {
			const a = D.state.value(0);
			const b = D.state.value(0);
			let count = 0;
			D.state.root(() => {
				D.state.watch(() => {
					count++;
					a();
					b();
				});
			});
			D.state.batch(() => {
				a(1);
				b(1);
				a(2);
				assert.strictEqual(a(), 2);
			});
		});

		it("passes errors", () => {
			assert.throws(() => {
				D.state.batch(() => {
					throw new Error("err");
				});
			});
		});
	});
});
