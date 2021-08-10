import DyneinState from "dynein-state";
import DyneinDOM from "./dom.js";

interface Plugin {
	install: (D: DyneinType, options?: any) => void;
}

const currentlyAddedPlugins: Set<Plugin> = new Set();
function usePlugin(plugin: Plugin, options?: any) {
	if (!currentlyAddedPlugins.has(plugin)) {
		currentlyAddedPlugins.add(plugin);
		plugin.install(D, options);
	}
}

const D = {
	state: DyneinState,
	dom: DyneinDOM,
	use: usePlugin
};
type DyneinType = typeof D;

export type { Plugin };
export type { DataPort, DestructionContext } from "dynein-state";
export default D;
