import { Signal, sample } from "./state.js"

export default abstract class WatchedValue<U> {
	abstract readonly value: Signal<U>

	protected get v() {
		return sample(this.value)
	}

	protected fire() {
		this.value(sample(this.value))
	}
}
