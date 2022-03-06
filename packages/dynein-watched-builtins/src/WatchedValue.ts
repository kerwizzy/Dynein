import { Signal, sample } from "@dynein/state"

export default abstract class WatchedValue<U> {
	abstract value: Signal<U>;

	protected get v() {
		return sample(this.value);
	}

	protected fire() {
		this.value(sample(this.value));
	}
}
