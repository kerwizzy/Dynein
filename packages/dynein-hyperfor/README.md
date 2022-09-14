# @dynein/hyperfor

Adds high-performance loop/list rendering to [Dynein](https://www.npmjs.com/package/dynein).

## Usage

```ts
function hyperfor<T>(arr: WatchedArray<T>, render: (item: T, index: ()=>number) => void): void
```

## Example

```ts
import hyperfor from "@dynein/hyperfor"
import * as D from "dynein"
import { WatchedArray } from "@dynein/watched-builtins"


const arr = new WatchedArray([1,2,3])
D.createRoot(()=>{
	D.mountBody(()=>{
		hyperfor(arr, (item) => {
			D.addText(item)
		})
	})
})
```
