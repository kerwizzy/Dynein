import { default as DyneinState, DataSignal } from "dynein-state"

export default abstract class WatchedValue<U> {
	abstract value: DataSignal<U>;

	protected get v() {
		return DyneinState.sample(this.value);
	}

	protected fire() {
		this.value(DyneinState.sample(this.value));
	}
}
