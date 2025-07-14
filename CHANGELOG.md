# 0.6.0

In terms of function behavior changes, this is probably the biggest Dynein release so far. While most real-world code should be unaffected by this release, there are technically a large number of breaking changes. If you have a Dynein project with lot of complex code, it will probably be necessary for you to do a careful code review and testing pass to check that you aren't relying on edge case behavior of older Dynein versions which is now different in 0.6.0. See below for an overview of what you should be looking out for in your code when upgrading to 0.6.0.

## Highlights

* Package reorganization:
	* `WatchedArray`, `WatchedSet`, `WatchedMap`, and `ReactiveArray` have been moved out of @dynein/watched-builtins and into @dynein/state. Thus, @dynein/watched-builtins is now deprecated.
	* @dynein/hyperfor has been merged into @dynein/dom and renamed to `addFor`. @dynein/hyperfor has therefore been deprecated as well.
	* @dynein/shared-signals has been removed from the Dynein codebase entirely. I think the shared signals concept is worth developing further, but it should be done as a wrapper or extension to some pre-existing Typescript RPC library (e.g., tRPC) in order to leverage the systems for authentication, session management, request validation, server-client type sharing, etc. that have already been designed and tested by other libraries. Because I don't plan to work on that anytime soon, I decided to remove and deprecate @dynein/shared-signals for now so that it doesn't add unnecessary clutter to the Dynein codebase.
	* As a result of the above reorganization, there are now **only three** Dynein packages: @dynein/state, @dynein/dom, and plain `dynein`. (But since the plain `dynein` package only combines the functionality of @dynein/state and @dynein/dom, there are really only two packages.)
* New functions: `createMuffled`, `saveAllContexts`, and `isTracking`. Refer to API.md for more details about what the new functions do and when they might be useful.
* Renamed functions:
	* `addStateStasher` is now `registerCustomStateStasher`
	* `stashAllState` is now `saveAllState`
	* `$s` is now `stateStashPromise` (although `$s` remains as an alias)
* Removed functionality:
	* The ability to add plugins, custom attribute handlers, and object style values were removed because they were used extremely rarely and added more complexity to the codebase.
* The list renderer (previously `hyperfor`, now `addFor`) has been **almost entirely rewritten** to improve performance and add functionality. When replacing a rendered array with an entirely new array, the list renderer will now attempt to preserve and reorder DOM nodes for identical items from the old render. (Previously replacing the array value with a new one would cause a complete rerender of the list.)
* **The effect of `runWithOwner` on the hidden state variables inside Dynein is now very different.** These changes were made because the results of running `runWithOwner` in older versions of Dynein were confusing and sometimes difficult to work with in complex situations. The modifications should only affect edge cases, but if you have code that relies on the older behavior for those edge cases, you'll need to change it when upgrading to 0.6.0. See below for a comparison of the old and new behavior and advice on how to adjust old application code to work with the new version of Dynein.
* A wide variety of bugs (primarily edge cases) were fixed and new unit tests were added to confirm that they are fixed and to guard against regressions.

## Other breaking changes

* `createMemo`:
	* The value of the function getter returned by `createMemo` will now change in the middle of a batch instead of after the end of the batch. If a function is passed to `createMemo`, it will also be called in the middle of a batch if necessary. This change was to avoid confusing behavior when the value would be out-of-date while in the middle of the batch. It will cause your code to break if you rely on the memo'd value to not change until after the end of a batch.
	* The second argument to `createMemo` (previously "fireOnEqual") has been removed.
	* If you need the old behavior of `createMemo`, you can simply use the older implementation of `createMemo`, which can be created using only user-accessible functions. (See the older versions of API.md, which contain the old implementation.)
* `onWrite`:
	* The setter passed to `toSignal` is now only called after all the `onWrite` listeners run. Thus, accessing the signal directly inside an `onWrite` will give the old value. As a result, the `onWrite` listeners run before the effects triggered by the write. This change affects signals from `toSignal` as well as signals from `createSignal`, because `createSignal` uses `toSignal` internally.
	* Migrating:
		* If you were reading the signal value inside `onWrite` and want the new value, use the `newValue` parameter passed to the onWrite listener function.
		* If you expected the onWrite listeners to run _after_ `toSignal`, you can add your own onWrite listener immediately after calling `toSignal` and move some of your code which was previously in your `toSignal` setter into the new onWrite listener. The onWrite listeners are called in the order that they were defined, and so that onWrite listener will be called before all the others.
* `onCleanup`:
	* Batches updates. If you need the old behavior, use `subclock` inside `onCleanup`.
* `addAsyncReplaceable`:
	* The second argument passed to the wrapped function was removed because it was used very rarely and added extra code to the Dynein core. If you were using the second argument, it will be very easy to re-implement the same functionality using a combination of `getOwner` and `runWithOwner`. Your code will probably be more readable that way anyway.
* `Owner`:
	* `addChild` is now a private method and cannot be accesssed from external code. Use `runWithOwner` instead.
* `onBatchEnd` has been removed. In most cases, you can use the JS-builtin function `queueMicrotask` instead.
* Watched builtins
	* It is no longer possible to pass a signal to the WatchedArray, WatchedSet, or WatchedMap constructors. Depending on your use-case, you may just need to read the signal or use `sample`. If you need the old behavior, you may consider either replacing your watched builtin with a simple `toSignal`, or creating an `onWrite` listener on `.value` of the watched builtin.
	* The `.value` signal now returns a readonly Array, Set, or Map. This will probably cause type errors in existing code, but fixing them should be fairly mechanical and it will help you avoid writing buggy code in the future. (See below for more details about this change.)

## Migration

### Basic migration

In for _almost_ all real-world Dynein code, migrating will simply require:

* Replacing `"@dynein/watched-builtins"` with `"@dynein/state"`
* Replacing `"@dynein/hyperfor"` with `"@dynein/dom"` and replacing `hyperfor` with `addFor`
* Replacing `addStateStasher` with `registerCustomStateStasher`
* Replacing `stashAllState` with `saveAllState`
* Fixing type errors caused by the change to watched builtins `.value` desribed below.

However, in some cases, you will need to make non-mechanical code modifications in order to account for the breaking changes described above and below. Because the effects of these API changes are often subtle, you may also need to do a careful code review and testing pass in the areas of your application that might have been affected.

### Fixing watched builtins `.value` type errors

The "watched builtins" classes (i.e., WatchedArray, WatchedSet, and WatchedMap) have a property `.value` which is a signal allowing getting and setting the native JS Array, Set, or Map that the class instance is wrapping. The typing of this property has been changed in 0.6.0 so that reading the signal returns a readonly value. _(For the rest of this explanation I'll focus on how this applies to WatchedArray. WatchedSet and WatchedMap are basically the same as WatchedArray as far as this change is concerned.)_

In previous releases, the `.value` the property _itself_ was readonly:

```ts
const arr = new WatchedArray()

// Error: Cannot assign to 'value' because it is a read-only property.
arr.value = createSignal([])
```

This was because changing the _property_ `.value` would always be a mistake, because effects listening on array changes wouldn't re-run if `.value` itself was changed. (You should almost always declare a property or variable holding a signal as `const` or `readonly` in order to catch this sort of mistake.)

Dynein 0.6.0 goes a step further and makes the signal _value_ also immutable:

```ts
const arr = new WatchedArray(["a"])

// 0.5.1: No error
// 0.6.0: Error: Property 'push' does not exist on type 'readonly string[]'
arr.value().push("b")
```

The new typing will help catch bugs because the code above would have the unexpected result of changing the WatchedArray value without running any effects listening for changes to the array, and if there was an `addFor` created for rendering the contents of `arr`, it wouldn't have an entry for `"b"` after the above code was run.

If we split up the code more and add type annotations it will be easier to see why `arr.value().push("b")` won't trigger any updates:

```ts
// (this is the behavior in 0.5.1 and below)

const arr: WatchedArray<string> = new WatchedArray(["a"])

const nativeArray: string[] = arr.value()
nativeArray.push("b") // nativeArray is just a regular JS array, and so .push doesn't tell Dynein that the array value has changed.
```

In Dynein 0.6.0, `arr.value().push("b")` would give an error because `arr.value()` now returns `readonly string[]`, and `readonly string[]` doesn't have a `.push` method.

To resolve these errors, you simply need to call `.push` on `arr` directly:

```ts
const arr = new WatchedArray(["a"])

// No error, and will cause automatic reactive updates to occur as expected
arr.push("b")
```

There has been a similar change made to the typings in WatchedSet and WatchedMap: `.value()` on those now returns `ReadonlySet` or `ReadonlyMap`, and not `Set` or `Map` as it did previously. For example, writing `myWatchedSet.value().add("b")` will now generate a Typescript error.

> ⚠️ **This is only an edit-time error:** `readonly string[]` is a Typescript annotation. At runtime, `.value()` still returns a regular JS Array, which has all methods (including `.push`). _This change will not affect runtime behavior or catch mistakes at runtime._

This change will likely require you to add `readonly` annotations elsewhere in your code to avoid Typescript errors. For example, this code would be fine in 0.5.1 but now gives a type error:

```ts
function joinArray(items: string[]) {
	return items.join(",")
}

const arr = new WatchedArray(["a"])

// 0.5.1: No error
// 0.6.0: Argument of type 'readonly string[]' is not assignable to parameter of type 'string[]'
console.log(joinArray(arr.value()))
```

Why does this error? It's because we declared `joinArray` as "asking" for a `string[]`, and being a `string[]` implies having methods for changing it (e.g., `.push`). `arr.value()` is a `readonly string[]`, and thus doesn't have `.push` or other methods for changing the array. But `joinArray` is declared as "asking" for a mutable array, and so we get an error when we pass something to `joinArray` that doesn't meet that constraint.

The solution is to **change the declaration of `joinArray`** so that it doesn't "ask" for a mutable array:

```ts
function joinArray(items: readonly string[]) {
	// This line is still fine because .join exists on readonly arrays.
	return items.join(",")
}

const arr = new WatchedArray(["a"])

// 0.6.0: No error
console.log(joinArray(arr.value()))
```

If you're already using the results of `arr.value()` as if it's readonly, then adding `readonly` annotations to other places in your code should be easy and not produce any new type errors. If, however, that _does_ give more type errors, it probably means the code that is giving the error was wrong to begin with. (In that it could cause the native JS array to be changed without triggering updates to things listening on the WatchedArray.)

### Migration of state change functions

One of the fundamental ideas in Dynein is that immediately invoked arrow functions can be used to change state variables without the danger of forgetting to reset them to their original values. createEffect, batch, assertStatic, runWithOwner, runWithContext, addDynamic, D.elements, etc. are all examples of this idea.

Internally, there are hidden state variables that these functions set before calling the arrow function and then reset after the arrow function exits normally or throws an error.

There are currently 8 hidden state variables:

 * assertedStatic
 * collectingDependencies
 * currentOwner
 * currentEffect
 * currentUpdateQueue
 * currentUpdateQueue.startDelayed
 * context values
 * custom states
	* The internal state variables in `@dynein/dom` count as "custom states" from the perspective of `@dynein/state`

The state changing functions usually change only a few of these while leaving the others the same. e.g., `assertStatic(inner)` sets assertedStatic to true and collectingDependencies to false before calling `inner`, and then resets them to their old value after `inner` exits.

In isolation, these functions do (almost) exactly the same things in 0.5.0 and 0.6.0. There are some edge case changes to the functions individually (see below), but the primary change between 0.5.0 and 0.6.0 (and the change most likely to break old code) is in how `runWithOwner` affects the hidden state variables. The fundamental change is that `runWithOwner` now _only_ sets `currentOwner` and none of the other variables. Previously, `runWithOwner` restored some of the other variables to the values the state variables had _when the Owner was created_. **Thus, when looking for broken code, you should _especially_ focus on places where `runWithOwner` is used.** In other words, `new D.Owner()` and `runWithOwner` could previously be used to save and restore older states, but now they cannot be used that way. If you have code that _relies_ on `runWithOwner` restoring other state variables besides `currentOwner`, that code will behave differently in 0.6.0. To migrate, you should use other functions to restore the state. `saveAllContexts` and `saveAllState` may be especially helpful. (However, use of `saveAllState` is not recommended. See API.md.)

Some of the state changes produced by other functions besides `runWithOwner` were also changed, but this `runWithOwner` change is the most significant.

The table below summarizes the state changes produced by some other functions, with changes in 0.6.0 marked in bold. (currentEffect is a new variable. In 0.5.0, it was as if `currentEffect === currentOwner` at every point, and the bolding in the below table shows where there is no longer that equality.)

* Blank cells indicate the variable is not modified by the function at all.
* "restore" means that the variable is restored to the value it had when the listener was created.
* "clear" means that the variable is reset to its default value (usually undefined or something equivalent).
* "inherit triggerer" means that inside the `inner` function, the variable has the value it had when running `inner` was triggered synchronously by other code. e.g., in 0.5.0, when `onCleanup`s ran because a signal value was changed, whether or not the `onCleanup` ran with `assertedStatic` true or false depended on what the `assertedStatic` variable was/is when the signal was written to. (`onCleanup`s are triggered and run synchronously, so this just means that `onCleanup` didn't use to reset `assertedStatic` before calling `inner`.)


|              | assertedStatic | collectingDependencies | currentOwner | **currentEffect** |  startDelayed  | context values | custom states | @dynein/dom state
| ------------ | -------------- | ---------------------- | ------------ | ----------------- |  ------------- | ------------- | ------------  | -----------------
| untrack      | false          | false                  |    			|                   |                 |               |               |
| retrack      | ~~(preserve)~~ **false** | true         |              |                   |                  |               |               |
| assertStatic | true           | false                  |              |                   |                  |               |               |
| createRoot   | false          | false                  | Owner(null)  | **undefined**     |                   | clear         | clear         | clear
| onCleanup    | ~~inherit triggerer~~ **false** | ~~inherit triggerer~~ **false** | undefined    | undefined         |  ~~inherit triggerer~~ **true**  | ~~inherit triggerer~~ **restore**       | ~~inherit triggerer~~ **clear**         | ~~inherit triggerer~~ **clear**
| runWithContext |              |                        |              |                   |                 | modify        |               |
| createEffect | false          | true                   | new Effect   | new Effect        |   true          | restore       | ~~inherit triggerer~~ **clear** | **clear**
| onWrite      | false          | false                  | auto-reset child | **undefined**     |   true          | restore       | clear         | clear
| onUpdate     | false          | false                  | auto-reset child | **undefined**     |   true          | restore       | clear         | clear
| addAsyncReplaceable (outer) | ~~(preserve)~~ **true**    | ~~(preserve)~~ **false**          |    | **undefined**  |   |  |   | ~~(preserve)~~ **clear**
| addAsyncReplaceable (inner) | true    | false          | auto-reset child | **undefined**     |   ~~false~~ **true** | inherit triggerer |  inherit triggerer | modify

