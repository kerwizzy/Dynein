import { default as DyneinState, DataSignal } from "dynein-state"

export default abstract class WatchedValue<U> {
	abstract value: DataSignal<U>;

	protected get v() {
		return this.value.sample();
	}

	protected fire() {
		this.value(this.value.sample());
	}
}
