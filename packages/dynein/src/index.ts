interface Plugin {
	install: (options?: any) => void
}

const currentlyAddedPlugins: Set<Plugin> = new Set()
export function usePlugin(plugin: Plugin, options?: any) {
	if (!currentlyAddedPlugins.has(plugin)) {
		currentlyAddedPlugins.add(plugin)
		plugin.install(options)
	}
}

export type { Plugin }
export * from "@dynein/state"
export * from "@dynein/dom"
