import { createRoot, createSignal, onCleanup, onUpdate } from "@dynein/state"
import { ReactiveArray } from "../built/ReactiveArray.js"

describe("@dynein/watched-builtins", () => {
	describe("ReactiveArray", () => {
		it("creates as expected", ()=>{
			const arr = new ReactiveArray(["a", "b", "c"])

			assert.strictEqual(Array.from(arr).join(""), "abc")
		})

		it("initializes indexes correctly", ()=>{
			const arr = new ReactiveArray(["a", "b", "c"])

			assert.strictEqual(arr.array.map(item => item.index()).join(","), "0,1,2")
		})
	})

	describe("ReactiveArray.splice", () => {
		it("handles splices", ()=>{
			const arr = new ReactiveArray(["a", "b", "c"])

			arr.splice(1, 1, "1", "2")

			assert.strictEqual(Array.from(arr).join(""), "a12c")
		})

		it("updates indexes after splices", ()=>{
			const arr = new ReactiveArray(["a", "b", "c"])

			arr.splice(1, 1, "1", "2")

			assert.strictEqual(arr.array.map(item => item.index()).join(","), "0,1,2,3")
		})
	})

	describe("ReactiveArray.map", () => {
		it("maps correctly", ()=>{
			createRoot(()=>{
				const arr = new ReactiveArray(["a", "b", "c"])

				const mapped = arr.map(c => c.toUpperCase())

				assert.strictEqual(Array.from(mapped).join(","), "A,B,C")
			})
		})

		it("handles splice on the base", ()=>{
			createRoot(()=>{
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

		it("tracks mapper dependencies", ()=>{
			createRoot(()=>{
				const arr = new ReactiveArray(["a", "b", "c"])
				const add = createSignal("")

				const mapped = arr.map(c => c.toUpperCase()+add())

				assert.strictEqual(Array.from(mapped).join(","), "A,B,C")

				add("_")

				assert.strictEqual(Array.from(mapped).join(","), "A_,B_,C_")
			})
		})

		it("tracks mapper indexes", ()=>{
			createRoot(()=>{
				const arr = new ReactiveArray(["a", "b", "c"])


				let log = []
				const mapped = arr.map((c, index) => {
					log.push("+"+c) // create effect for mapping c
					onCleanup(()=>{
						log.push("-"+c) // destroy/rerun effect for mapping c
					})

					return c.toUpperCase()+index()
				})

				assert.strictEqual(Array.from(mapped).join(","), "A0,B1,C2")

				log.push("splice")
				arr.splice(1, 1, "x", "y")

				assert.strictEqual(Array.from(mapped).join(","), "A0,X1,Y2,C3")
				assert.strictEqual(log.join(","), "+a,+b,+c,splice,+x,+y,-b,-c,+c")
			})
		})

		it("destroys mapper effects", ()=>{
			createRoot(()=>{
				const arr = new ReactiveArray(["a", "b", "c"])

				let log = []
				const mapped = arr.map(c => {
					log.push("+"+c) // create effect for mapping c
					onCleanup(()=>{
						log.push("-"+c) // destroy/rerun effect for mapping c
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
		it("filters correctly", ()=>{
			createRoot(()=>{
				const arr = new ReactiveArray([0, 3, 1, 4])

				const filtered = arr.filter(c => c > 2)

				assert.strictEqual(Array.from(filtered).join(","), "3,4")
			})
		})

		it("handles splice on the base", ()=>{
			createRoot(()=>{
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

		it("handles splice on the base when no items are removed", ()=>{
			createRoot(()=>{
				const arr = new ReactiveArray([0, 3, 1, 4])

				const filtered = arr.filter(c => c > 2)

				arr.splice(1, 0, 5, 7)

				assert.strictEqual(Array.from(filtered).join(","), "5,7,3,4")
			})
		})

		it("handles splice on the base when removed items aren't kept", ()=>{
			createRoot(()=>{
				const arr = new ReactiveArray([0, 3, 1, 4])

				const filtered = arr.filter(c => c > 2)

				arr.splice(0, 1, 5, 7)

				assert.strictEqual(Array.from(filtered).join(","), "5,7,3,4")
			})
		})

		it("handles index based filters", ()=>{
			createRoot(()=>{
				const arr = new ReactiveArray(["a", "b", "c", "d", "e", "f"])

				const filtered = arr.filter((c, index) => index() % 2 === 1)

				assert.strictEqual(Array.from(filtered).join(","), "b,d,f")

				arr.splice(1, 1, "x", "y")

				assert.strictEqual(Array.from(filtered).join(","), "x,c,e")
			})
		})

		it("doesn't splice output for same filter result", ()=>{
			createRoot(()=>{
				const arr = new ReactiveArray(["a", "b", "c", "d", "e", "f"])

				const filtered = arr.filter((c, index) => index() <= 3)

				assert.strictEqual(Array.from(filtered).join(","), "a,b,c,d")

				const log = []
				onUpdate(filtered.array.spliceEvent, (evt)=>{
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
		it("sorts correctly", ()=>{
			createRoot(()=>{
				const arr = new ReactiveArray([0, 3, 1, 4])

				const sorted = arr.sort((a,b) => a-b)

				assert.strictEqual(Array.from(sorted).join(","), "0,1,3,4")
			})
		})

		it("handles splice on the base", ()=>{
			createRoot(()=>{
				const arr = new ReactiveArray([0, 3, 1, 4])

				const sorted = arr.sort((a,b) => a-b)

				arr.splice(1, 1, 7, -1, 2)

				assert.strictEqual(Array.from(arr).join(","), "0,7,-1,2,1,4")
				assert.strictEqual(Array.from(sorted).join(","), "-1,0,1,2,4,7")

				arr.splice(0, 2, 3, 10)

				assert.strictEqual(Array.from(arr).join(","),    "3,10,-1,2,1,4")
				assert.strictEqual(Array.from(sorted).join(","), "-1,1,2,3,4,10")
			})
		})

		it("produces reasonable splice lists", ()=>{
			createRoot(()=>{
				const arr = new ReactiveArray([0, 3, 1, 4])

				const sorted = arr.sort((a,b) => a-b)


				const log = []
				onUpdate(sorted.array.spliceEvent, (evt)=>{
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

	describe("ReactiveArray.effectForEach", ()=>{
		it("runs effects", ()=>{
			createRoot(()=>{
				const counts = new Map()

				const arr = new ReactiveArray(["a", "b", "c"])

				arr.effectForEach((c)=>{
					if (!counts.has(c)) {
						counts.set(c, 0)
					}

					counts.set(c, counts.get(c)+1)

					onCleanup(()=>{
						counts.set(c, counts.get(c)-1)
					})
				})

				assert.strictEqual(Array.from(counts).map(c => c.join(":")).join(","), "a:1,b:1,c:1")
			})
		})

		it("reruns effects on splice", ()=>{
			createRoot(()=>{
				const counts = new Map()

				const arr = new ReactiveArray(["a", "b", "c"])

				arr.effectForEach((c)=>{
					if (!counts.has(c)) {
						counts.set(c, 0)
					}

					counts.set(c, counts.get(c)+1)

					onCleanup(()=>{
						counts.set(c, counts.get(c)-1)
					})
				})

				assert.strictEqual(Array.from(counts).map(c => c.join(":")).join(","), "a:1,b:1,c:1")

				arr.splice(1, 1, "c", "a", "d")

				assert.strictEqual(Array.from(counts).map(c => c.join(":")).join(","), "a:2,b:0,c:2,d:1")
			})
		})

		it("reruns effect only when necessary", ()=>{
			createRoot(()=>{
				const counts = new Map()

				const arr = new ReactiveArray(["a", "b", "c"])

				const log = []

				arr.effectForEach((c)=>{
					if (!counts.has(c)) {
						counts.set(c, 0)
					}

					log.push("+"+c)
					counts.set(c, counts.get(c)+1)

					onCleanup(()=>{
						log.push("-"+c)
						counts.set(c, counts.get(c)-1)
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

