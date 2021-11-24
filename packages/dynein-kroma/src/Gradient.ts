import Color from "./Color"

type Stop = {
	color: Color
	x: number
}

class Gradient {
	stops: Set<Stop>

	constructor() {
		this.stops = new Set()
	}

	addStop(x: number, color: Color) {
		this.stops.add({x, color})
	}


	sample(factor: number): Color {
		if (isNaN(factor)) {
			return new Color(0)
		}
		let after: Stop | null = null
		let before: Stop | null = null
		for (let stop of this.stops) {
			if (stop.x > factor && (!after || after.x > stop.x)) {
				after = stop
			}
			if (stop.x <= factor && (!before || before.x < stop.x)) {
				before = stop
			}
		}
		if (!after && before) {
			return before.color
		} else if (!before && after) {
			return after.color
		} else if (after && before) {
			return before.color.mix(after.color, (factor-before.x)/(after.x-before.x))
		}
		return new Color(0)
	}
}

export default Gradient
