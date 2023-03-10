# Dynein

Dynein is a small yet powerful library for creating reactive DOM apps.

**⚠️⚠️ EXPERIMENTAL / NOT FOR PRODUCTION USE ⚠️⚠️**

## Features

 * Zero dependencies
 * Tiny size (DOM + reactive state under 4 kB gzip)
 * No virtual DOM or diff/patch step
 * No JSX or custom compiler -- just plain JS (or TS) code.

## A Quick Example

```javascript
import * as D from "dynein"

const { button, h1 } = D.elements
const $text = D.addText

D.mountBody(()=>{
	const count = D.createSignal(0)
	h1("Hello World!")

	$text(()=>"Count = "+count())

	button({
		onclick:()=>{
			count(count()+1)
		}
	}, "Increment")
})

```

For more information, see the [API docs](docs/API.md).
