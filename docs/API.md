# Table of Contents

* [Reactive State](#reactive-state) (@dynein/state)
	* [Core functions](#core-state-functions)
		* [createSignal](#dcreatesignal)
		* [isSignal](#dissignal)
		* [createEffect](#dcreateeffect)
		* [untrack](#duntrack)
		* [sample](#dsample)
		* [assertStatic](#dassertstatic)
		* [retrack](#dretrack)
	* [Ownership](#ownership)
		* [Owner](#downer)
		* [createRoot](#dcreateroot)
		* [getOwner](#dgetowner)
		* [runWithOwner](#drunwithowner)
		* [onCleanup](#doncleanup)
	* [State Utilities](#state-utilities)
		* [toSignal](#dtosignal)
		* [onUpdate](#donupdate)
		* [createMemo](#dcreatememo)
		* [createMuffled](#dcreatemuffled)
	* [Contexts](#contexts)
		* [createContext](#dcreatecontext)
		* [runWithContext](#drunwithcontext)
		* [useContext](#dusecontext)
	* [Advanced functions](#advanced-state-functions)
		* [batch](#dbatch)
		* [onBatchEnd](#donbatchend)
		* [subclock](#dsubclock-experimental)
* [Reactive arrays, sets, and maps](#reactive-arrays-sets-and-maps) (@dynein/watched-builtins)
* [DOM Engine](#dom-engine) (@dynein/dom)
	* [Core functions](#core-dom-functions)
		* [elements](#delements)
			* [Event handlers](#event-handlers)
			* [Reactive attributes](#reactive-attributes)
			* [Auto-binding of form values](#auto-binding-of-form-values)
		* [svgElements](#dsvgelements)
		* [addNode](#daddnode)
		* [addText](#daddtext)
		* [addHTML](#daddhtml)
		* [addDynamic](#daddhtml)
		* [addIf](#daddif)
	* [Utilities](#dom-utilities)
		* [createUniqueId](#dcreateuniqueid)
		* [mountBody](#dmountbody)
	* [Advanced functions](#advanced-dom-functions)
		* [addAsyncReplaceable](#daddasyncreplaceable)
		* [addPortal](#daddportal)
		* [getTarget](#dgettarget)
		* [defineCustomProperty](#ddefinecustomproperty-experimental)
* [High-performance list rendering](#high-performance-list-rendering) (@dynein/hyperfor)

# Reactive State

## Core State Functions

The reactivity system is centered around objects called `Signal`s. A signal is simply an object with this interface:

```ts
interface Signal<T> {
    (): T;          // get the value of the signal and record it as a dependency of whatever reactive effect context we're in
    (newVal: T): T; // set the value of the signal
}
```

The functions below all work in some way or another with signals.

### `D.createSignal`

```ts
function createSignal<T>(init: T, updateOnEqual?: boolean = false): D.Signal<T>;
```

Creates a signal which is logged as a dependency of the parent effect (if any) when read, and triggers an update of all effects when written to.

The `init` parameter controls the initial value of the signal, and the `updateOnEqual` parameter controls whether writing a new value which is `===` to the old value should trigger an update of dependent effects.

#### Example Usage

```ts
const value = D.createSignal(0)

value() //gets value, returns 0 at this point
value(1) //sets value to 1
value() //gets value, returns 1 at this point
```

### `D.isSignal`

```ts
function isSignal(thing: any): boolean
```

Returns whether or not `thing` is a signal object which was created with [`D.createSignal`](#dcreatesignal) or [`D.toSignal`](#dtosignal).

### `D.createEffect`

```ts
function createEffect(fn: () => void): Destructable
```

Calls `fn` and logs all signals read during the execution of `fn`. Whenever any of these signals is updated, `fn` will be reexecuted. Dependencies are collected fresh on each reexecution.

`D.createEffect` also automatically creates an ownership scope. See the section on [Ownership](#ownership) below for more about how that works.

### `D.untrack`

```ts
function untrack<T>(inner: () => T): T;
```

When used within a [`D.createEffect`](#dcreateeffect), calls `inner` but does not collect accessed signals as dependencies. Returns the result of `inner()`.

### `D.sample`

```ts
function sample<T>(inner: () => T): T;
```

Alias for [`D.untrack`](#duntrack) that helps make code more readable in certain contexts.

### `D.assertStatic`

```ts
function assertStatic<T>(inner: () => T): T;
```

Similar to untrack and sample, in that all signals accessed within `inner` are not logged as dependecies of the current effect, but different in that while signal accesses in an `untrack` will be silently ignored, any signal access inside an `assertStatic` will trigger a warning in the console.

### `D.retrack`
```ts
function retrack<T>(inner: () => T): T;
```

Can be used inside a [`D.untrack`](#duntrack) block to begin tracking again.

## Ownership

Most reactive computations in real-world Dynein apps are usually created "inside" another reactive computation. For instance, if you have a tab view, and then a reactive component (say, a counter) on one of the tabs, there will probably be at least two reactive effect contexts: one for updating the DOM when the selected tab is changed, and one for updating the DOM when the counter is incremented.

The second reactive effect (the one for updating the counter) is a *child* of the effect for the tab view. When the tab is changed, the reactive effect for the counter is no longer necessary and should be destroyed.

Dynein keeps track of all this by using the `Owner` class. For all the technical details, you should go take a look at the code (it's not that long), but here's the summary of how effects and Owners interact:

* Every effect is also an Owner.
* Every effect created inside another effect becomes a child of that effect. (Assuming you aren't using [`D.runWithOwner`](#drunwithowner) to do something special).
* When effects are reexecuted, all their child effects are destroyed.
* Every effect should be created either within a parent effect, or within a [D.createRoot](#dcreateroot).

### `D.Owner`

```ts
interface Destructable {
	destroy(): void
	parent: Owner | null
}

class Owner implements Destructable {
	parent: Owner | null = null

	readonly isDestroyed: boolean

	constructor(parent: Owner | null | undefined = currentOwner)

	addChild(thing: Destructable): void
	destroy(): void

	// destroy all children, but not this
	reset(): void
}
```

Base `Owner` class. Most simple apps won't need to instantiate this directly, but it can be useful in more advanced apps.

### `D.createRoot`

```ts
function createRoot<T>(inner: (dispose: ()=>void)=>T): T
```

Runs `inner` in a new root ownership scope. Note that this is merely an ownership scope, not an effect, and it doesn't set up any dependency tracking.

All Dynein DOM entry points (either [`D.addPortal`](#daddportal) or [`D.mountBody`](#dmountbody)) should be called inside a `createRoot`. You can also use this inside a [`D.createEffect`](#dcreateeffect) to set up an effect that you don't want destroyed when the parent re-executes.

### `D.getOwner`

```ts
function getOwner(): Owner | null | undefined
```

Return the current ownership scope. The difference between `null` and `undefined` is that `null` indicates an intentional and explicit root scope, while `undefined` indicates that the current context is entirely outside any ownership tracking context (probably by accident, which can cause problems because reactive effects created here will never be disposed).

### `D.runWithOwner`

```ts
function runWithOwner<T>(owner: Owner | null | undefined, inner: () => T): T
```

Run the code in `inner` with the specified `owner`.

### `D.onCleanup`

```ts
function onCleanup(fn: () => void): void
```

Run `fn` when the current ownership scope is destroyed or reset. (e.g., when the parent effect re-executes).

It's important to use this to clean up things like `setInterval` or `addEventListener` when you create them inside effects, because otherwise they'll never be destroyed and might even get added over and over again each time your effect re-executes.

## Contexts

Many other JS frameworks (React, SolidJS, etc.) provide a feature called "contexts" or "provide/inject". The use case for all these APIs is distributing values through many levels of a component tree without having to explicitly pass the values in properties or arguments.

The Dynein API for this is fairly simple, and only involves three functions:

* [`D.createContext()`](#dcreatecontext) sets up a new context key, optionally with a default value.
* [`D.runWithContext(context, value, inner)`](#drunwithcontext) runs `inner` with the context key `context` set to `value`.
	* This method is conceptually equivalent to what other libraries call the "Provider".
* [`D.useContext(context)`](#dusecontext) returns the value which has been bound to the context key `context` by an enclosing `D.runWithContext`.

**IMPORTANT NOTE:** context values are propagated through the ownership tree, not the call tree or the component tree. So, for instance, if you save or create an Owner inside a `runWithContext` and then later run something inside that owner, `useContext` will give results as if it was called inside the `runWithContext`.

### `D.createContext`

```ts
type Context<T> = {
	readonly id: symbol
	readonly defaultValue: T
}

function createContext<T>(): Context<T | undefined>
function createContext<T>(defaultValue: T): Context<T>
```

Create a new `Context` object, optionally with a default value.

### `D.runWithContext`

```ts
function runWithContext<T, R>(context: Context<T>, value: T, inner: () => R): R
```

Creates a new [Owner](#downer) with context key `context` set to `value`, runs `inner` inside that owner, and returns the result.

### `D.saveContexts`

```ts
function saveContexts(contexts: Context<any>[]): <T>(inner: ()=>T) => T
```

Saves the current values of each Context in `contexts` and returns a function which will restore those values within `inner`.

### `D.useContext`

```ts
function useContext<T>(context: Context<T>): T
```

Searches upwards through the ownership tree to find the closest enclosing [`D.runWithContext`](#drunwithcontext) call setting the value of this context key. If no `D.runWithContext` call is found which defines the value of this context here, returns the default value of the context, or undefined if none was set.

## State Utilities

### `D.toSignal`

```ts
function toSignal<T>(getter: () => T, setter: (val: T) => void): D.Signal<T>;
```

This is a utility function for turning a getter/setter pair into an object obeying the signal interface.

Note that unlike the signals generated by [`D.createSignal`](#dcreatesignal), the signals generated by this function do *not* interact with the reactivity system. Calling `()` on a signal from `toSignal` just calls the getter and doesn't automatically add anything to the state system, and calling `(val)` just calls the setter and doesn't trigger an update of any effects.

Note however that if you get or set `createSignal`-generated signals in `getter` or `setter`, then these read or written signals will act as usual as part of the dependency system.

### `D.onUpdate`

```ts
function onUpdate<T>(signal: () => T, listener: (newValue: T) => void): Destructable
```

Utility function for listening for updates to `signal`. The `listener` will be called with the new value of `signal` when `signal` fires an update.

Internally, `onUpdate` is just:
```ts
function onUpdate<T>(signal: () => T, listener: (newValue: T) => void): Destructable {
	let isFirst = true;
	return createEffect(() => {
		const newValue = signal();
		if (!isFirst) {
			untrack(() => {
				listener(newValue);
			});
		}
		isFirst = false;
	});
}
```

### `D.onWrite`

```ts
function onWrite<T>(getter: Signal<T>, listener: (newValue: T) => void): void
```

`D.onWrite` is somewhat similar to [`D.onUpdate`](#donupdate), but unlike the listeners added with `D.onUpdate`, the listeners added with `D.onWrite` execute immediately (no matter the context in which the signal is written to), and are all executed before the `signal(value)` call returns.

### `D.createMemo`

```ts
function createMemo<T>(fn: () => T, fireWhenEqual: boolean = false): ()=>T
```

Creates and returns a getter for a hidden internal signal which is set to the value of `fn` and updated whenever `fn`'s reactive dependencies update. This is useful if `fn` is expensive to execute, updates infrequently, but is accessed frequently. You can create a memo for `fn` and then read from the saved result (which is fast) instead of calling `fn` directly.

Internally, `createMemo` is just:
```ts
function createMemo<T>(fn: () => T, fireWhenEqual: boolean = false): () => T {
	const internalSignal = createSignal<T>(undefined as unknown as T, fireWhenEqual);
	createEffect(() => {
		internalSignal(fn());
	});
	return () => internalSignal();
}
```

### `D.createMuffled`

```ts
function createMuffled<T>(signal: Signal<T>): Signal<T>
```

Creates and returns a getter/setter pair (wrapped into the `Signal` interface) which allows writing to `signal` without causing an "echo".

More specifically, if `muffled = createMuffled(signal)`:

* Writing `muffled(value)` will _not_ cause effects which depend on `muffled()` to re-run. However, it _will_ update the value of `signal` and cause effects which depend on `signal()` to re-run.
* Writing `signal(value)` _will_ cause effects which depend on `muffled()` to re-run.
* `muffled()` will always equal `signal()`.

You will probably not need to use this function very often, but it can be useful when implementing other utility primitives. It's often included in code which automatically serializes a complicated reactive structure to flat representation such as a JSON string written to localStorage.

## Advanced State Functions

### `D.batch`

```ts
function batch(fn: () => void): void
```

Calls `fn` immediately, but if any signals are updated within `fn`, Dynein will wait to re-execute any dependent effects until `fn` is finished. **Event handlers (onclick, etc.) are automatically wrapped in D.batch, so you don't need to call this yourself.**

Without `D.batch`, if we had:

```ts
const a = D.createSignal("")
const b = D.createSignal("")

D.createEffect(()=>{
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

While on the other hand, if we wrap our event handler in a D.batch:
```ts
function handleEvent() {
	console.log("handling event")
	D.batch(()=>{
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

Also, if batches are nested, no effects will be executed until the *outermost* `D.batch` call finishes.

Note that even though the reactive updates are delayed, the signal values themselves update immediately. i.e.,
```ts
const a = D.createSignal("")

D.batch(()=>{
	a("a")

	a() // === "a"
})

```

This also means that it's possible for things like [`D.createMemo`](#dcreatememo) to be out-of-sync inside a batch. In practice, this isn't usually a problem, but it's important to be aware of.

In some more advanced situations, you may want some updates to be batched but others to be run immediately. In this case, you probably need [`D.subclock`](#dsubclock-experimental).

### `D.onBatchEnd`

```ts
function onBatchEnd(fn: ()=>void): void
```

Add `fn` to the internal execution queue, so it will be run at the end of the current batch.

### `D.subclock` **(EXPERIMENTAL)**

```ts
function subclock(fn: () => void): void
```

Creates a separate execution queue for effects triggered inside `fn`, and runs them before `fn` exits.

This is maybe the most advanced feature in the Dynein state library and you probably won't need it in simple apps, but when you do, it's indispensable.

# Reactive arrays, sets, and maps

[Signals](#dcreatesignal) are great for primitive values (numbers, strings, booleans, etc.) but you'll eventually want to have arrays, sets, and maps as part of your application state.

It might seem we could implement this just with signals, but we quickly run into trouble:
```ts
const todoListItems = D.createSignal<string[]>([])

function addTodoItem(text: string) {
	// ???
}
```

Maybe we can just push to the array?

```ts
const todoListItems = D.createSignal<string[]>([])

function addTodoItem(text: string) {
	todoListItems().push(text)
}
```
Well, that will add it to our array, but nothing that depends on `todoListItems` will update or rerender, because we didn't write to the signal.

How about this, then:
```ts
const todoListItems = D.createSignal<string[]>([])

function addTodoItem(text: string) {
	const arr = todoListItems()
	arr.push(text)
	todoListItems(arr)
}
```
Although we *are* writing to `todoListItems` now, this still won't cause effects that depend on `todoListItems` to re-execute, because we aren't actually changing the value. The new value is `===` to the old value, since it's still the same array object. (`arr === arr`)

We could make this work, though, if we set `updateOnEqual` to true when creating the `todoListItems` signal:

```ts
const todoListItems = D.createSignal<string[]>([], true)

function addTodoItem(text: string) {
	const arr = todoListItems()
	arr.push(text)
	todoListItems(arr)
}
```

Still, this is a little ugly. Thankfully, you can just drop in the `@dynein/watched-builtins` library and things will be nice again:

```ts
import { WatchedArray } from "@dynein/watched-builtins"

const todoListItems = new WatchedArray<string>()

function addTodoItem(text: string) {
	todoListItems.push(text) // works as expected!
}
```

Currently, `WatchedArray`, `WatchedSet`, and `WatchedMap` are all provided. Their APIs are all basically identical to their native JS counterparts, but with the difference that they take care of reactivity as expected, by using the `D.createSignal(..., true)` method. They expose this internal signal as `.value: Signal<Array | Set | Map>`, and you can read and write to it directly.

# DOM Engine

## Core DOM Functions


### `D.elements`

Object (technically a proxy, but it works like an object) mapping tagName to an element creation function. e.g.,

```ts
const div = D.elements.div
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
const {div, span} = D.elements

D.mountBody(()=>{
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
div({onclick:(evt)=>{
	// do stuff
}})
```

#### Reactive attributes

You can easily make properties reactive by passing functions instead of static values. e.g.,

```ts
const state = D.createSignal(false)

div({style:()=>`color: ${state() ? "red" : "green"}`, onclick:(evt)=>{
	state(!state())
}}, "123")
```

Will create a div that toggles between red and green when clicked on.

#### Auto-binding of form values

For form controls, you can pass a signal to the `value` (or `checked`, for checkboxes) parameter, and then a **bidirectional binding** will automatically be created between the form control value and the signal.

e.g.,
```ts
const str = D.createSignal("test")

input({type:"text", value:str})
button({onclick:()=>{
	str(str()+"A")
}}, "Add A")
```

When the textbox is edited, the `str` signal will be updated, and when the `str` signal is written to, the textbox will be updated.

Note that this indeed **breaks unidirectional dataflow**, but personally I think this is a good thing in this case (and many other cases) because it makes the code easier to read and write, without making it harder to reason about.

If you need to handle the binding explicitly for some reason, you can wrap the `str` signal in a plain getter function, so the binding is only created one direction:
```ts
input({type:"text", value:()=>str, oninput:(evt)=>{
	// stuff
}})
```

Another option to consider is to bind a `D.toSignal`. This can be useful for handling a number input where your signal is a number but the `<input>` value is a string:

```ts
const x = D.createSignal(0)

input({type:"number", value:D.toSignal(()=>x().toString(), (newVal)=>x(parseInt(newVal) || 0))})
```


### `D.svgElements`

Just like [`D.elements`](#delements), but for SVG elements (`<svg>`, `<rect>`, etc.)

### `D.addNode`

```ts
function addNode<T extends Node>(node: T): T;
```

Inserts the specified node at the current position and returns it.

### `D.addText`

```ts
declare type Primitive = string | number | boolean | undefined | null;

function addText(val: Primitive | (() => Primitive)): Node;
```

If `val` is a primitive, inserts a text node with `val?.toString() ?? ""`.

If `val` is a function, sets up an effect to watch the value of `val()` and update the inserted text node when `val()` changes.

Returns the created text node.

### `D.addHTML`

```ts
function addHTML(html: string): void;
```

Inserts the specified HTML at the current position.


### `D.addDynamic`

```ts
function addDynamic(inner: () => void): void;
```

Runs `inner` in the current DOM creation context and also tracks dependencies like `D.createEffect`. When a dependency update is triggered, the dependency list is reset, all of the contents of the `addDynamic` area are cleared, `inner` is reexecuted, the dependencies are collected again, and the new nodes are added to the DOM.


### `D.addIf`

```ts
function addIf(condition: () => any, inner: () => void): {
    elseif(condition: () => any, inner: () => void): ...;
    else(inner: () => void): void;
}
```

Allows adding branching based on a conditions without making `inner` reactive. This could also be acheived with `D.addDynamic` by wrapping the inner blocks with a `D.assertStatic` but this is more convenient.

## DOM Utilities

### `D.createUniqueId`

```ts
function createUniqueId(): string
```

Returns `"__d0"`, `"__d1"`, `"__d2"`, etc. on successive calls. Useful for conveniently generating element ids when necessary, e.g., for linking a `<label>` to an `<input>`.

### `D.mountBody`

```ts
function mountBody(inner: () => void): void
```

Calls `inner` and adds the DOM elements specified by `inner` to the page `<body>`.

If the window is not fully loaded yet, then it waits for page load and then runs `inner`.

Note that internally this function is just a convenience wrapper for [`D.addPortal`](#daddportal) and it does not create an ownership scope. You'll generally want to run `D.mountBody` inside a `D.createRoot` as the entry point of your app.

## Advanced DOM Functions

### `D.addAsyncReplaceable`

```ts
function addAsyncReplaceable(setupReplacements: (replaceInner: (inner: () => void) => void, dependent: (inner: () => void) => void) => void): void
```

This function allows for more fine grained control of the DOM. `D.addDynamic` and `D.addIf` are essentially wrappers around `D.addAsyncReplaceable`.

Basically, this method *synchronously* sets up an area of the DOM that can be "replaced" with new DOM elements at some future time (i.e., *"asynchronously"*) by using a callback it gives you.

This can be useful for implementing asynchrounous content. (Although this isn't the only way of doing asynchronous stuff in Dynein apps, and it often isn't the best way -- see below for some more notes on that).

Anyway, to give an example of how to use `addAsyncReplaceable`, let's suppose we're implementing a page with lazy loaded content, where we have some async API method

```ts
async function getPageHTML(pageID: string): Promise<string>
```

We can then use `D.addAsyncReplaceable` to implement a `renderPage` function:

```ts
function renderPage(pageID: string) {
	D.addAsyncReplaceable(async ($r)=>{
		$r(()=>{
			$text("Loading...")
		})


		// The "Loading..." text will be shown until the $r (replace) function is called again later, after the promise resolves or rejects

		try {
			const html = await getPageHTML(pageID)
			$r(()=>{
				D.addHTML(html)
			})
		} catch (err: any) {
			$r(()=>{
				$text("Error loading page: "+err.message)
			})
		}
	})
}
```

Note, however, that this isn't the only way to implement asynchronously loaded content or query results. For instance, if we have a search page, `D.addAsyncReplaceable` probably shouldn't be used at all. Instead, we might write a search page like this:

```ts
function searchPage() {
	const searchText = D.createSignal("")
	const results = D.createSignal<null | Results[]>([]) // null while searching

	input({type:"text", value:searchText})
	button({onclick:async ()=>{
		results(null)
		results(await getSearchResults(searchText()))
	}}, "Search")

	D.addDynamic(()=>{
		const resultsArray = results()

		D.assertStatic(()=>{
			if (resultsArray === null) {
				$text("Loading...")
			} else {
				renderResults(resultsArray)
			}
		})
	})
}

```

### `D.addPortal`

```ts
function addPortal(parentNode: Node, inner: () => void): void
function addPortal(parentNode: Node, beforeNode: Node | null, inner: () => void): void
```

Create a new element creation context at `parentNode`. Element creation calls inside `inner` will be added as children of `parentNode`.

### `D.getTarget`

```ts
function getTarget(): Node | null
```

Return the node inside which we're currently rendering, or else null if not rendering. Basically, `getTarget` is to [`getOwner`](#dgetowner) as [`addPortal`](#daddportal) is to [`runWithOwner`](#drunwithowner).

### `D.defineCustomProperty` **(EXPERIMENTAL)**

```ts
function defineCustomProperty(prop: string, handler: (el: SVGElement | HTMLElement, val: Primitive) => void): void
```

Allows defining custom element attributes.

# High-performance list rendering

The simplest way to render a reactive list in Dynein is with a [`D.addDynamic`](#dadddynamic):

```ts
const listOfThings = new WatchedArray<Thing>()

D.addDynamic(()=>{
	for (const thing of listOfThings) {
		renderThing(thing)
	}
})
```

This works fine for small lists, but if you end up with very long lists or are editing them a lot, this method can become a performance problem, because `D.addDynamic` rerenders the entire list whenever you add or remove one item. Even for short lists, this behavior can be non-ideal if you have some state inside `renderThing` that you want preserved even while adding or removing items.

Both problems can often be solved very easily by replacing the loop with a `hyperfor`:

```ts
import hyperfor from "@dynein/hyperfor"

const listOfThings = new WatchedArray<Thing>()

hyperfor(listOfThings, (thing)=>{
	renderThing(thing)
})

```

A hyperfor loop will preserve the rendered elements from previous render runs, and only rerender the modified items. In fact, it won't even re-execute `renderThing` for items which stayed the same.

The function signature is:

```ts
function hyperfor<T>(arr: WatchedArray<T>, render: (item: T, index: ()=>number) => void): void
```

Internally, `hyperfor` tracks the individual array modifications (`.splice`, `.push`, etc) made to the `WatchedArray` and converts them to equivalent DOM modifications. This avoids needing a virtual DOM and diff/patch step found in many other reactive DOM libraries.
