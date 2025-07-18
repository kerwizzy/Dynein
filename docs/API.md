# Table of Contents

* [Reactive State](#reactive-state) (@dynein/state)
	* [Basic functions](#basic-state-functions)
		* [createSignal](#createsignal)
		* [toSignal](#tosignal)
		* [createEffect](#createeffect)
		* [untrack](#untrack)
		* [sample](#sample)
		* [retrack](#retrack)
		* [assertStatic](#assertstatic)
		* [isTracking](#istracking)
		* [batch](#batch)
		* [stateStashPromise](#statestashpromise)
	* [Ownership](#ownership)
		* [Owner](#owner)
		* [createRoot](#createroot)
		* [getOwner](#getowner)
		* [runWithOwner](#runwithowner)
		* [onCleanup](#oncleanup)
	* [State Utilities](#state-utilities)
		* [onUpdate](#onupdate)
		* [onWrite](#onwrite)
		* [createMemo](#creatememo)
		* [createMuffled](#createmuffled)
		* [isSignal](#issignal)
	* [Contexts](#contexts)
		* [createContext](#createcontext)
		* [runWithContext](#runwithcontext)
		* [useContext](#usecontext)
		* [saveContexts](#savecontexts)
		* [saveAllContexts](#saveallcontexts)
	* [Advanced functions](#advanced-state-functions)
		* [saveAllState](#saveallstate)
		* [registerCustomStateStasher](#registercustomstatestasher)
		* [subclock](#subclock)
	* [Reactive arrays, sets, and maps](#reactive-arrays-sets-and-maps)
* [DOM Engine](#dom-engine) (@dynein/dom)
	* [Basic functions](#basic-dom-functions)
		* [elements](#elements)
			* [Event handlers](#event-handlers)
			* [Reactive attributes](#reactive-attributes)
			* [Auto-binding of form values](#auto-binding-of-form-values)
		* [svgElements](#svgelements)
		* [addDynamic](#addhtml)
		* [addIf](#addif)
		* [addText](#addtext)
		* [addNode](#addnode)
		* [addHTML](#addhtml)
		* [addFor](#addfor)
	* [Utilities](#dom-utilities)
		* [createUniqueId](#createuniqueid)
		* [mountBody](#mountbody)
	* [Advanced functions](#advanced-dom-functions)
		* [addAsyncReplaceable](#addasyncreplaceable)
		* [addPortal](#addportal)
		* [getTarget](#gettarget)
		* [addAsync](#addasync)
		* [runWithInsertionState](#runwithinsertionstate)


# Reactive State

## Basic state functions

The reactivity system is centered around objects called `Signal`s. A signal is simply an object with this interface:

```ts
interface Signal<T> {
    (): T          // get the value of the signal
    (newVal: T): T // set the value of the signal
}
```

The functions below all work in some way or another with signals.

> ⚠️ If you're used to working with other libraries with signals (e.g., SolidJS), the concept of a Dynein `Signal` is not identical to the concept of a signal in most other libraries. A Dynein `Signal` is simply an object with the above interface (and a hidden symbol marking it as a signal). A Dynein signal does _not imply dependency tracking._ The [`toSignal`](#tosignal) function allows turning _any_ getter/setter function pair into a Dynein `Signal`, and those getter/setter functions don't necessarily have to trigger dependency tracking.

### createSignal

```ts
function createSignal<T>(initialValue: T, fireWhenEqual: boolean = false): Signal<T>
```

Creates a signal which is logged as a dependency of the parent effect (if any) when read, and triggers an update of all dependent effects when written to.

The `initialValue` parameter controls the initial value of the signal, and the `fireWhenEqual` parameter controls whether writing a new value which is `===` to the old value should trigger an update of dependent effects.

This function is different from [`toSignal`](#tosignal) because [`toSignal`](#tosignal) only "merges" a getter/setter pair into a single object. `createSignal` creates a special internal object which causes dependency tracking.

#### Example Usage

```ts
const value = createSignal(0)

value() // gets value, returns 0 at this point
value(1) // sets value to 1
value() // gets value, returns 1 at this point
```

### toSignal

```ts
function toSignal<T>(getter: () => T, setter: (val: T) => void): Signal<T>
```

This is a utility function for turning a getter/setter pair into an object obeying the signal interface.

Note that unlike the signals generated by [`createSignal`](#createsignal), the signals generated by this function do *not* interact with the reactivity system. Calling `()` on a signal from `toSignal` just calls the getter and doesn't automatically add anything to the state system, and calling `(val)` just calls the setter and doesn't trigger an update of any effects. (However, it _does_ trigger [`onWrite`](#onwrite) listeners.)

Note however that if you get or set `createSignal`-generated signals inside `getter` or `setter`, then these read or written signals will act as usual as part of the dependency system.

### createEffect

```ts
function createEffect(fn: () => void): Destructable
```

Calls `fn` and logs all signals read during the execution of `fn`. Whenever any of these signals is updated, `fn` will be re-executed. Dependencies are collected fresh on each re-execution.

`createEffect` also automatically creates an ownership scope. See the section on [Ownership](#ownership) below for more about how that works.

### untrack

```ts
function untrack<T>(inner: () => T): T
```

When used within a [`createEffect`](#createeffect), calls `inner` but does not collect accessed signals as dependencies. Returns the result of `inner()`.

### sample

```ts
function sample<T>(inner: () => T): T
```

Alias for [`untrack`](#untrack) that helps make code more readable in certain contexts. In general, to improve readability, use `sample` when you use the return value, and use `untrack` when you do not use the return value.

### retrack
```ts
function retrack<T>(inner: () => T): T
```

Can be used inside an [`untrack`](#untrack) block to begin tracking again.

### assertStatic

```ts
function assertStatic<T>(inner: () => T): T
```

Similar to untrack and sample, in that all signals accessed within `inner` are not logged as dependecies of the current effect, but different in that while signal accesses in an `untrack` will be silently ignored, any signal access inside an `assertStatic` will trigger a warning in the console.

### isTracking

```ts
function isTracking(): boolean
```

Returns whether accessing a signal right now will add it as a dependency of the enclosing effect (if there is one).

### batch

```ts
function batch(fn: () => void): void
```

Calls `fn` immediately, but if any signals are updated within `fn`, Dynein will wait to re-execute any dependent effects until `fn` is finished. **Event handlers (onclick, etc.) are automatically wrapped in `batch`.**

Without `batch`, if we had:

```ts
const a = createSignal("")
const b = createSignal("")

createEffect(() => {
	console.log("running effect")
	console.log("a = "+a())
	console.log("b = "+b())
	console.log("done running effect")
})

function handleEvent() {
	console.log("handling event")
	a("a")
	b("b")
	console.log("done handling event")
}
handleEvent()
```

This would log:
```
running effect
a =
b =
done running effect
handling event
running effect
a = a
b =
done running effect
running effect
a = a
b = b
done running effect
done handling event
```

While on the other hand, if we wrap our event handler in a batch:
```ts
function handleEvent() {
	console.log("handling event")
	batch(() => {
		a("a")
		b("b")
	})
	console.log("done handling event")
}
```
The output will be:

```
running effect
a=
b=
done running effect
handling event
running effect
a=a
b=b
done running effect
done handling event
```

Also, if batches are nested, no effects will be executed until the *outermost* `batch` call finishes.

Note that even though the reactive updates are delayed, the signal _values_ update immediately. i.e.,
```ts
const a = createSignal("")

batch(() => {
	a("a")

	a() // === "a"
})

```

In _very rare_ situations, you may want some updates to be batched but others to be run immediately. In this case, you probably need [`subclock`](#subclock).

### stateStashPromise

Internally, most Dynein functions modify hidden variables (e.g., what the current effect is) before calling `inner`, and then re-set the values before exiting. When passing async functions to the various `inner` parameters, this doesn't work well because the values of the hidden variables will be lost after the first `await`. `stateStashPromise` provides a solution to that problem by restoring the hidden values to the values before the `await`.

For example:

```ts
runWithOwner(owner, async () => {
	await apiRequest()

	onCleanup(() => {
		// ...
	})
})

// ...

owner.destroy() // the onCleanup inner function will not be run
```

Without `stateStashPromise`, the call to [`onCleanup()`](#oncleanup) will trigger a warning: ``"Destructables created outside of a `createRoot` will never be disposed.``

If we use `stateStashPromise`, the warning will be removed:


```ts
runWithOwner(owner, async () => {
	await stateStashPromise(apiRequest())

	onCleanup(() => {
		// ...
	})
})

// ...

owner.destroy() // the onCleanup inner function *will* be run
```

Because writing `stateStashPromise` a lot of times can make your code noisy if you have a lot of `await`s, there's an alias `$s` which you can use instead:

```ts
runWithOwner(owner, async () => {
	await $s(apiRequest())

	onCleanup(()=>{
		// ...
	})
})
```

#### Some important notes about `stateStashPromise`/`$s`

1. The `stateStashPromise`/`$s` call must _always_ appear immediately after the `await`. e.g., running `$s(await apiRequest())` in the above code would not have preserved the values of the hidden state variables.
2. Additionally, `stateStashPromise`/`$s` must be used for _every_ `await` in the async function that you want to use Dynein functions inside. You should never have a solitary `await`. It needs to always be `await stateStashPromise(...)` or `await $s(...)`

If the hidden state does not seem to be being preserved, you should review you code to check that it fulfills both of those conditions.

## Ownership

Most reactive computations in real-world Dynein apps are usually created "inside" another reactive computation. For instance, if you have a tab view, and then a reactive component (say, a counter) on one of the tabs, there will probably be at least two reactive effect contexts: one for updating the DOM when the selected tab is changed, and one for updating the DOM when the counter is incremented.

The second reactive effect (the one for updating the counter) is a *child* of the effect for the tab view. When the tab is changed, the reactive effect for the counter is no longer necessary and should be destroyed.

Dynein keeps track of all this by using the `Owner` class. For all the technical details, you should go take a look at the code (it's not that long), but here's the summary of how effects and Owners interact:

* Every effect is also an Owner.
* Every effect created inside another effect becomes a child of that effect. (Assuming you aren't using [`runWithOwner`](#runwithowner) to do something special.)
* When effects are re-executed, all their child effects are destroyed.
* Every effect should be created either within a parent effect, or within a [createRoot](#createroot).

### Owner

```ts
class Owner implements Destructable {
	readonly isDestroyed: boolean

	constructor(parent: Owner | null | undefined = currentOwner)

	destroy(): void

	// destroy all children, but not this
	reset(): void
}
```

Base `Owner` interface. You create an Owner by just running `new Owner()`. Most simple apps won't need to instantiate Owners directly, but calling the constructor yourself can be useful in more advanced apps.

### createRoot

```ts
function createRoot<T>(inner: (dispose: ()=>void)=>T): T
```

Runs `inner` in a new root ownership scope. Note that this is merely an ownership scope, not an effect, and it doesn't set up any dependency tracking.

All Dynein DOM entry points (either [`addPortal`](#addportal) or [`mountBody`](#mountbody)) should be called inside a `createRoot`. You can also use this inside a [`createEffect`](#createeffect) to set up an effect that you don't want destroyed when the parent effect re-executes.

### getOwner

```ts
function getOwner(): Owner | null | undefined
```

Returns the current ownership scope. The difference between `null` and `undefined` is that `null` indicates an intentional and explicit root scope, while `undefined` indicates that the current context is entirely outside any ownership tracking context (probably by accident, which can cause problems because reactive effects created here will never be disposed).

### runWithOwner

```ts
function runWithOwner<T>(owner: Owner | null | undefined, inner: () => T): T
```

Run the code in `inner` with the specified `owner`.

### onCleanup

```ts
function onCleanup(fn: () => void): void
```

Run `fn` when the current ownership scope is destroyed or reset. (e.g., when the parent effect re-executes).

It's very important to use this to clean up things like `setInterval` or `addEventListener` when you create them inside effects, because otherwise the timers and listeners will never be deleted, and instead will probably get added over and over again each time your effect re-executes.

## State Utilities

### onUpdate

```ts
function onUpdate<T>(signal: () => T, listener: (newValue: T) => void): Destructable
```

Utility function for listening for updates to `signal`. The `listener` will be called with the new value of `signal` when `signal` fires an update.

`onUpdate` is basically equivalent to:
```ts
function onUpdate<T>(signal: () => T, listener: (newValue: T) => void): Destructable {
	let isFirst = true
	return createEffect(() => {
		const newValue = signal()
		if (!isFirst) {
			untrack(() => {
				listener(newValue)
			})
		}
		isFirst = false
	})
}
```

_(There is a small amount of extra code internally to handle edge cases.)_


### onWrite

```ts
function onWrite<T>(getter: Signal<T>, listener: (newValue: T) => void): void
```

`onWrite` is somewhat similar to [`onUpdate`](#onupdate), but unlike the listeners added with `onUpdate`, the listeners added with `onWrite` execute immediately (no matter the context in which the signal is written to), and are all executed before the `signal(value)` call returns.

**NOTE:** `onWrite` listeners run _before_ the signal setter itself is called, which means that the signal will still have the old value when the onWrite listener runs. For example:

```ts
const signal = createSignal("a")

onWrite(signal, (newValue)=>{
	console.log(`signal = ${signal()}, newValue = ${newValue}`)
})

console.log("writing b")
signal("b")

console.log("writing c")
signal("c")
```

will log:

```
writing b
signal = a, newValue = b
writing c
signal = b, newValue = c
```

### createMemo

```ts
function createMemo<T>(fn: () => T): () => T
```

Creates and returns a getter for a hidden internal signal which is set to the value of `fn` and updated whenever `fn`'s reactive dependencies update. This is useful if `fn` is expensive to execute and updates infrequently, but is accessed frequently. You can create a memo for `fn` and then read from the saved result (which is fast) instead of calling `fn` directly.

Internally, `createMemo` is basically:
```ts
function createMemo<T>(fn: () => T): () => T {
	const internalSignal = createSignal<T>(undefined, fireWhenEqual)
	createEffect(() => {
		internalSignal(fn())
	})
	return () => internalSignal()
}
```

_(As with [`onUpdate`](#onupdate), there is extra code internally to handle edge cases.)_

One major difference between the above approximate implemetation and the internal implementation is that when the function returned by `createMemo` is called inside a [`batch`](#batch), the return value will be up to date instead of "lagged" because of the [`batch`](#batch). This can sometimes "force" `fn` to be called before the end of the batch.

### createMuffled

```ts
function createMuffled<T>(signal: Signal<T>): Signal<T>
```

Creates and returns a getter/setter pair (wrapped into the `Signal` interface) which allows writing to `signal` without causing an "echo".

More specifically, if `muffled = createMuffled(signal)`:

* Writing `muffled(value)` will _not_ cause effects which depend on `muffled()` to re-run. However, it _will_ update the value of `signal` and cause effects which depend on `signal()` to re-run.
* Writing `signal(value)` _will_ cause effects which depend on `muffled()` to re-run.
* `muffled()` will always equal `signal()`.

You will probably not need to use this function very often, but it can be useful when implementing other utility primitives. It's often included in code which automatically serializes a complicated reactive structure to a non-reactive representation such as a JSON string written to localStorage.

### isSignal

```ts
function isSignal(thing: any): boolean
```

Returns whether or not `thing` is a signal object which was created with [`createSignal`](#createsignal) or [`toSignal`](#tosignal).

## Contexts

Many other JS frameworks (React, SolidJS, etc.) provide a feature called "contexts" or "provide/inject". The use case for all these APIs is distributing values through many levels of a component tree without having to explicitly pass the values in properties or arguments.

The Dynein API for this is fairly simple, and only involves three functions:

* [`createContext()`](#createcontext) sets up a new key in the internal context value store, optionally with a default value.
* [`runWithContext(context, value, inner)`](#runwithcontext) runs `inner` with the context key `context` set to `value`.
	* This method is conceptually equivalent to what other libraries call the "Provider".
* [`useContext(context)`](#usecontext) returns the value which has been bound to the context key `context` by an enclosing `runWithContext`.

Context values are "captured" by the following functions and will call their `inner` function with the context values as they were when the wrapper function was created:

* [`createEffect`](#createeffect)
* [`onUpdate`](#onupdate)
* [`onWrite`](#onwrite)
* [`onCleanup`](#oncleanup)
* [`addIf`](#addif)
* [`addDynamic`](#adddynamic)
* [`addText`](#addtext)

### createContext

```ts
type Context<T> = {
	readonly id: symbol
	readonly defaultValue: T
}

function createContext<T>(): Context<T | undefined>
function createContext<T>(defaultValue: T): Context<T>
```

Create a new `Context` object, optionally with a default value.

### runWithContext

```ts
function runWithContext<T, R>(context: Context<T>, value: T, inner: () => R): R
```

Set the `context` key to `value` in the internal context key-value store, runs `inner`, and then returns the result.

### useContext

```ts
function useContext<T>(context: Context<T>): T
```

Reads the context value set by the enclosing [`runWithContext`](#runwithcontext) (or other functions that restore context values, such as [`createEffect`](#createeffect), [`saveContexts`](#savecontexts), and [`saveAllState`](#saveallstate)). If none of those functions assigned a value to `context`, then the default value will be returned (or `undefined`, if no default value was passed to [`createContext`](#createcontext).)

### saveContexts

```ts
function saveContexts(contexts: Context<any>[]): <T>(inner: () => T) => T
```

Saves the current values of each Context in `contexts` and returns a function which will restore those values within `inner`.

### saveAllContexts

```ts
function saveAllContexts(): <T>(inner: () => T) => T
```

Saves the current values of _all_ Contexts, and returns a function which will restore those values within `inner`.

## Advanced State Functions

### saveAllState

```ts
function saveAllState(): <T>(inner: () => T) => T
```

Saves the current values of all the Dynein hidden state variables, and returns a function which will restore those values within `inner`. This is very similar in overall behavior and concept to [`stateStashPromise`](#statestashpromise), but it's much easier to misuse. _You probably shouldn't use this function unless you really know what you're doing._

If you want to save and restore states, you should look at these other functions which are more intuitive and less likely to cause unexpected behavior:

* [getOwner](#getowner) in combination with [runWithOwner](#runwithowner)
* [saveContexts](#savecontexts) or [saveAllContexts](#saveallcontexts)
* [addAsyncReplaceable](#addasyncreplaceable)

### registerCustomStateStasher

```ts
function registerCustomStateStasher(stateStasher: () => (() => void))
```

This function is used to define a custom hidden state variable. It should only be used if you're writing a library which builds on top of @dynein/state and does something analogous to @dynein/dom. If you're making that sort of library, go look at the source code of @dynein/dom and @dynein/state to see how `registerCustomStateStasher` should be used and how it fits in with the rest of @dynein/state.

### subclock

```ts
function subclock(fn: () => void): void
```

Creates a separate execution queue for effects triggered by signal writes inside `fn`, and re-runs those effects before `fn` exits and `subclock` returns.

# Reactive arrays, sets, and maps

[Signals](#createsignal) are great for primitive values (numbers, strings, booleans, etc.) but you'll eventually want to have arrays, sets, and maps as part of your application state.

It might seem we could implement this just with signals, but we quickly run into trouble:
```ts
const todoListItems = createSignal<string[]>([])

function addTodoItem(text: string) {
	// ???
}
```

Maybe we can just push to the array?

```ts
const todoListItems = createSignal<string[]>([])

function addTodoItem(text: string) {
	todoListItems().push(text)
}
```
Well, that will add it to our array, but nothing that depends on `todoListItems` will update or rerender, because we didn't write to the signal.

How about this, then:
```ts
const todoListItems = createSignal<string[]>([])

function addTodoItem(text: string) {
	const arr = todoListItems()
	arr.push(text)
	todoListItems(arr)
}
```
Although we *are* writing to `todoListItems` now, this still won't cause effects that depend on `todoListItems` to re-execute, because we aren't actually changing the value. The new value is `===` to the old value, since it's still the same array object. (`arr === arr`)

We could make this work, though, if we set `fireWhenEqual` to true when creating the `todoListItems` signal:

```ts
const todoListItems = createSignal<string[]>([], true)

function addTodoItem(text: string) {
	const arr = todoListItems()
	arr.push(text)
	todoListItems(arr)
}
```

Still, this is a little ugly. To clean this code up, you can use a `WatchedArray` and things will be nice again:

```ts
import { WatchedArray } from "@dynein/state"

const todoListItems = new WatchedArray<string>()

function addTodoItem(text: string) {
	todoListItems.push(text) // works as expected!
}
```

Currently, `WatchedArray`, `WatchedSet`, and `WatchedMap` are provided by @dynein/state. Their APIs are all basically identical to their native JS counterparts, but with the difference that they take care of reactivity automatically, in a way similar to the `createSignal(..., true)` solution discussed above. They expose this signal as `.value: Signal<Array | Set | Map>`, and you can read and write to it directly.

However, these classes are not _simply_ a convenience wrapper around the `createSignal(..., true)` solution for adding reactivity to lists. `WatchedArray`, `WatchedSet`, and `WatchedMap` also pass detailed modification information to [`addFor`](#addfor) in order to enable list renders to be updated dynamically without running a diff on the whole list.

# DOM Engine

## Basic DOM Functions

### elements

Object (technically a proxy, but it works like an object) mapping tagName to an element creation function. e.g.,

```ts
const div = elements.div
```

This function can be used in several ways:

```ts

div() // add <div></div>

div("text") // add <div>text</div>

div("<b>escape</b>") // add <div>&lt;b&lt;escape&lt;/b&gt;</div>

div({style:"color:red"}) // add <div style="color:red" />

div((outerDiv)=>{ // add <div></div>
	outerDiv.style = "font-weight: bold;"

	div({style:"color:red"}) // then add <div style="color:red"></div> inside
})
// So the full result is <div "font-weight: bold;"><div style="color:red"></div></div>

const outerDiv = div(()=>{ // add <div></div>
	div({style:"color:red"}) // then add <div style="color:red"></div> inside
})
outerDiv.style.color = "green"
// So the full result is <div style="color:green"><div style="color:red"></div></div>
```

**Note that unlike JSX, hyperscript, and similar libraries, Dynein element creation functions both return the generated node <u>AND</u> add it to the DOM**.

This allows using JS control flow structures like `if`, `for`, `while`, etc. to build HTML. e.g,

```ts
const {div, span} = elements

mountBody(()=>{
	for (let i = 0; i<5; i++) {
		if (i % 2 == 0) {
			div(i)
		} else {
			span(i)
		}
	}
})
```

results in

```html
<body>
	<div>0</div>
	<span>1</span>
	<div>2</div>
	<span>3</span>
	<div>4</div>
</body>
```

Some important other things to know about Dynein element creation functions:

#### Event handlers

Any attribute starting with `on` will be treated as an event handler. e.g.,

```ts
div({ onclick: (evt) => {
	// do stuff
}})
```

#### Reactive attributes

You can easily make properties reactive by passing functions instead of static values. e.g.,

```ts
const state = createSignal(false)

div({ style: () => `color: ${state() ? "red" : "green"}`, onclick: (evt)=>{
	state(!state())
}}, "123")
```

Will create a div that toggles between red and green when clicked on.

#### Auto-binding of form values

For form controls, you can pass a signal to the `value` (or `checked`, for checkboxes) parameter, and then a **bidirectional binding** will automatically be created between the form control value and the signal.

e.g.,
```ts
const str = createSignal("test")

input({ type:"text", value:str })
button({ onclick: ()=>{
	str(str()+"A")
}}, "Add A")
```

When the textbox is edited, the `str` signal will be updated, and when the `str` signal is written to, the textbox will be updated.

Note that this indeed **breaks unidirectional dataflow**, but personally I think this is a good thing in this case (and many other cases) because it makes the code easier to read and write, without making it harder to reason about.

If you need to handle the binding explicitly for some reason, you can wrap the `str` signal in a plain getter function, so the binding is only created one direction:
```ts
input({ type:"text", value: () => str, oninput: (evt) => {
	// stuff
}})
```

Another option to consider is to bind a `toSignal`. This can be useful for handling a number input where your signal is a number but the `<input>` value is a string:

```ts
const x = createSignal(0)

input({ type:"number", value: toSignal(() => x().toString(), (newVal) => x(parseInt(newVal) || 0)) })
```

### svgElements

Just like [`elements`](#elements), but for SVG elements (`<svg>`, `<rect>`, etc.)

### addDynamic

```ts
function addDynamic(inner: () => void): void
```

Runs `inner` in the current DOM creation context and also tracks dependencies like [`createEffect`](#createeffect). When a dependency update is triggered:

1. The dependency list is reset.
1. [`onCleanup`](#oncleanup)s are called.
1. All of the content in the `addDynamic` area is cleared.
2. `inner` is re-executed and the dependencies are collected again. At the same time, the new nodes are added to the DOM.

### addIf

```ts
function addIf(condition: () => any, inner: () => void): {
    elseif(condition: () => any, inner: () => void): ...
    else(inner: () => void): void
}
```

Allows adding branching based on a conditions without making `inner` reactive. This could also be acheived with `addDynamic` by wrapping the inner blocks with a `assertStatic` but this is more convenient.

> ⚠️ `addIf` does not have the same narrowing guarantees that a regular JS `if` does. Code or effects inside an `addIf` can (temporarily) still exist and be executed **even after `condition` becomes false**. This is because the hidden effects which re-run the `condition` functions can happen to be run _after_ effects inside the `inner` run. **You may need to add native JS `if` guards inside effects or other functions created inside `inner` in order to handle this.**
>
> Depending on your code, you may be able use [`addDynamic`](#adddynamic) with regular JS `if` statements instead of `addIf` in order to avoid this problem.

### addText

```ts
declare type Primitive = string | number | boolean | undefined | null

function addText(val: Primitive | (() => Primitive)): Node
```

If `val` is a primitive, inserts a text node with `val?.toString() ?? ""`.

If `val` is a function, sets up an effect to watch the value of `val()` and update the inserted text node when `val()` changes.

Returns the created text node.

### addNode

```ts
function addNode<T extends Node>(node: T): T
```

Inserts the specified node at the current position and returns it.

### addHTML

```ts
function addHTML(html: string): void
```

Inserts the specified HTML at the current position.

> ⚠️ `addHTML` does not perform any validation or escaping of the passed HTML string before adding it to the DOM, and so **passing untrusted input to this function could make your application vulnerable to XSS attacks**. In general, this function should _only_ be used with static strings direct from your source code. If you need dynamic content, you should be using the other functions in @dynein/dom.

### addFor


The simplest way to render a reactive list in Dynein is with a [`addDynamic`](#adddynamic):

```ts
const listOfThings = new WatchedArray<Thing>()

addDynamic(()=>{
	for (const thing of listOfThings) {
		renderThing(thing)
	}
})
```

This works fine for small lists, but if you end up with very long lists or are editing them a lot, this method can become a performance problem, because `addDynamic` rerenders the entire list whenever you add or remove one item. (Dynein doesn't have a virtual DOM and doesn't do diffs.) Even for short lists, this behavior can be non-ideal if you have some state inside `renderThing` that you want preserved even while adding or removing items.

Both problems can often be solved very easily by replacing the loop with an `addFor`:

```ts
import { addFor } from "dynein"

const listOfThings = new WatchedArray<Thing>()

addFor(listOfThings, (thing) => {
	renderThing(thing)
})

```

An `addFor` will preserve the rendered elements from previous render runs, and only rerender the modified items. In fact, it won't even re-execute `renderThing` for items which stayed the same.

The function signature is:

```ts
function addFor<T>(list: WatchedArray<T>, render: (item: T, index: () => number) => void, updateIndex?: boolean = false): void
function addFor<T>(list: WatchedSet<T>, render: (item: T, index: () => number) => void, updateIndex?: boolean = false): void
function addFor<K, V>(list: WatchedMap<K, V>, render: (item: [K, V], index: () => number) => void, updateIndex?: boolean = false): void
```

Internally, `addFor` tracks the individual list modifications (`.splice`, `.push`, `.add`, `.set`, etc.) made to the `WatchedArray` (or `WatchedSet` or `WatchedMap`) and converts them to equivalent DOM modifications.

When completely replacing the list by writing to the `.value` of the WatchedArray, WatchedSet, or WatchedMap, the `addFor` will attempt to preserve and rearrange elements from the previous render.

By default, the `index` function passed to `render` returns `NaN` to improve performance (because for most list renders the index is not used as part of the rendered content). If you pass `true` to the `updateIndex` parameter, the `index` function will be a reactive getter of the current index of the item. When the index of the item changes, the `index` function will trigger updates of effects dependent on it.

> ⚠️ Unlike most other Dynein primitives, `addFor` does not support `render` being async. If you need gradual asynchronous rendering for individual items, use an `addAsync` inside `render`.

## DOM Utilities

### createUniqueId

```ts
function createUniqueId(): string
```

Returns `"__d0"`, `"__d1"`, `"__d2"`, etc. on successive calls. Useful for conveniently generating element ids when necessary, e.g., for linking a `<label>` to an `<input>`.

### mountBody

```ts
function mountBody(inner: () => void): void
```

Calls `inner` and adds the DOM elements specified by `inner` to the page `<body>`.

If the window is not fully loaded yet, then it waits for page load and then runs `inner`.

Note that internally this function is just a convenience wrapper for [`addPortal`](#addportal) and it does not create an ownership scope. You'll generally want to run `mountBody` inside a `createRoot` as the entry point of your app.

## Advanced DOM Functions

### addAsyncReplaceable

```ts
function addAsyncReplaceable(setupReplacements: (replaceInner: <T>(inner: () => T) => T) => void): void
```

This function allows fine grained control of the DOM. `addDynamic` and `addIf` are essentially wrappers around `addAsyncReplaceable`.

Basically, this function *synchronously* sets up an area of the DOM that can be "replaced" with new DOM elements at some future time (i.e., *"asynchronously"*) by using a callback it gives you.

This can be useful for implementing asynchrounous content. (Although this isn't the only way of doing asynchronous stuff in Dynein apps, and it often isn't the best way. See below for some more notes on that.)

Anyway, to give an example of how to use `addAsyncReplaceable`, let's suppose we're implementing a page with lazy-loaded content, where we have some async API method

```ts
async function getPageHTML(pageID: string): Promise<string>
```

We can then use `addAsyncReplaceable` to implement a `renderPage` function:

```ts
function renderPage(pageID: string) {
	addAsyncReplaceable(async (replaceInner) => {
		replaceInner(() => {
			addText("Loading...")
		}) // Now the "Loading..." text will be shown until the replaceInner function is called again

		try {
			const html = await getPageHTML(pageID)
			replaceInner(() => {
				addHTML(html)
			})
		} catch (err: any) {
			replaceInner(()=>{
				addText("Error loading page: " + err.message)
			})
		}
	})
}
```

Note, however, that this isn't the only way to implement asynchronously loaded content or query results. For instance, if we have a search page, `addAsyncReplaceable` probably shouldn't be used at all. Instead, we might write a search page like this:

```ts
function searchPage() {
	const searchText = createSignal("")
	const results = createSignal<null | Results[]>([]) // null while searching

	input({ type:"text", value: searchText })
	button({ onclick: async () => {
		results(null)
		results(await getSearchResults(searchText()))
	}}, "Search")

	addDynamic(() => {
		const resultsArray = results()

		assertStatic(() => {
			if (resultsArray === null) {
				addText("Loading...")
			} else {
				renderResults(resultsArray)
			}
		})
	})
}

```

### addPortal

```ts
function addPortal(parentNode: Node, inner: () => void): void
function addPortal(parentNode: Node, beforeNode: Node | null, inner: () => void): void
```

Create a new element creation context at `parentNode`. Element creation calls inside `inner` will be added as children of `parentNode`.

### getTarget

```ts
function getTarget(): Node | null
```

Return the node inside which we're currently rendering, or else null if not rendering. Basically, `getTarget` is to [`getOwner`](#getowner) as [`addPortal`](#addportal) is to [`runWithOwner`](#runwithowner).

### addAsync

```ts
function addAsync<T>(inner: () => T): T
```

Creates an area of the DOM that can be gradually appended to. e.g., if we were creating an area to show a log:

```ts
addAsync(async () => {
	addText("starting process...")
	await stateStashPromise(api.runStep1())
	addText("step 1 done, starting step 2")
	await stateStashPromise(api.runStep2())
	addText("done")
})

```

The DOM in the `addAsync` area will initially show:

```
starting process...
```

After `api.runStep1` finishes, it will show:

```
starting process...
step 1 done, starting step 2
```

After `api.runStep2` finishes, it will show:

```
starting process...
step 1 done, starting step 2
done
```

### runWithInsertionState

```ts
function runWithInsertionState<T>(parentNode: Node | null, beforeNode: Node | null, inner: () => T): T
```

Directly sets the hidden state variables defining what area of the DOM is being appended to. It's somewhat like a lower-level version of [`addPortal`](#addportal). It's very unlikely that you will need to use this function.
