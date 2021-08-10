import { default as DyneinState, DataPort } from "dynein-state"

export default abstract class WatchedValue<U> {
	abstract value: DataPort<U>;

	protected get v() {
		return this.value.sample();
	}

	protected fire() {
		this.value(this.value.sample());
	}
}
