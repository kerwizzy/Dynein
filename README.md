# Dynein

Dynein is a small yet powerful library for creating reactive DOM apps.

## Features

 * Zero dependencies
 * Tiny size (DOM + reactive state = 3.67 kB gzip)
 * No virtual DOM or diff/patch step
 * No JSX or custom compiler -- just plain JS (or TS) code.

## A Quick Example

```javascript
import D from "dynein"

const { button, h1 } = D.dom.elements
const $text = D.dom.text

D.dom.mountBody(()=>{
	const count = D.state.value(0)
	h1("Hello World!")

	$text(()=>"Count = "+count()

	button({
		onclick:()=>{
			count(count()+1)
		}
	}, "Increment")
})

```
