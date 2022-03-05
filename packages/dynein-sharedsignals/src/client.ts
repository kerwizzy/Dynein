import { default as DyneinState, DataSignal } from "dynein-state";
import {
	SharedStateEndpoint,
	SetMessage,
	UpdateMessage,
	ClientToServerMessage,
	ServerToClientMessage,
	Serializable,
	SharedSignal,
	SharedArray,
	SharedSet,
	SharedMap
} from "./serialize.js";

interface ClientParams {
	sendMessage: (msg: any) => void;
	setupOnMessage: (onmessage: (msg: any) => void) => void;
	uuid: () => string;
}

// Based on https://stackoverflow.com/a/43636793
function stableJSONStringify(obj: any) {
	return JSON.stringify(obj, (key, value) =>
		value instanceof Object && !Array.isArray(value)
			? Object.keys(value)
					.sort()
					.reduce((sorted: any, key) => {
						sorted[key] = value[key];
						return sorted;
					}, {})
			: value
	);
}

export class APIError extends Error {}

export class SharedStateClient extends SharedStateEndpoint {
	private params: ClientParams;

	private unsubscribeReg: FinalizationRegistry<string>;

	protected debounceInterval = 50;

	uuid(): string {
		return this.params.uuid();
	}

	constructor(params: ClientParams) {
		super();
		this.unsubscribeReg = new FinalizationRegistry((key: string) => {
			//console.log("GC",key)
			this.sharedSignalsByKey.delete(key)
			this.send({
				cmd: "unsubscribe",
				key
			});
		});

		this.params = params;

		this.params.setupOnMessage((msg) => {
			this.clientHandleMessage(msg);
		});
	}

	protected clientHandleMessage(msg: ServerToClientMessage) {
		switch (msg.cmd) {
			case "err":
				console.warn(`Server error: in processing ${msg.causeCmd}: ${msg.err}`);
				break;
			case "rpcOK":
			case "rpcErr":
				const id = msg.id;
				const resolvers = this.pendingRPCResolvers.get(id);
				if (!resolvers) {
					throw new Error("Got reply to unknown RPC id");
				}
				const [resolve, reject] = resolvers;
				this.pendingRPCResolvers.delete(id);
				if (msg.cmd === "rpcOK") {
					resolve(this.deserialize(msg.res));
				} else {
					reject(new APIError(msg.err));
				}
				break;
			default:
				super.handleMessage("server", msg);
				break;
		}
	}

	protected async send(msg: ClientToServerMessage) {
		this.params.sendMessage(msg);
	}

	protected broadcastUpdate(msg: SetMessage | UpdateMessage, blockSendTo: string | undefined) {
		// console.log("broadcast update block send to", blockSendTo);
		if (blockSendTo !== "server") {
			this.send(msg);
		}
	}

	/* Old, non-GC aware implementation

	protected sharedSignalsByKey: Map<string, SharedSignal<any>> = new Map();
	protected getSignalByKey(key: string): SharedSignal<any> | undefined {
		if (this.sharedSignalsByKey.has(key)) {
			const val = this.sharedSignalsByKey.get(key)!;
			return val
		}
	}
	protected setSignalByKey(key: string, signal: SharedSignal<any>) {
		if (this.sharedSignalsByKey.has(key)) {
			throw new Error("Overwrite cached signal")
		}
		this.sharedSignalsByKey.set(key, signal);
	}
	*/

	protected sharedSignalsByKey: Map<string, WeakRef<SharedSignal<any>>> = new Map();

	protected getSignalByKey(key: string): SharedSignal<any> | undefined {
		if (this.sharedSignalsByKey.has(key)) {
			const ref = this.sharedSignalsByKey.get(key)!;
			const val = ref.deref();
			if (!val) {
				//console.warn("Maybe tried to fetch a GCd signal");
				return undefined
			} else {
				return val;
			}
		}
	}

	protected setSignalByKey(key: string, signal: SharedSignal<any>) {
		this.sharedSignalsByKey.set(key, new WeakRef(signal));
		this.unsubscribeReg.register(signal, key, signal);
	}

	protected gcProtected = new Set<SharedSignal<any>>()
	protected protectFromGC(signal: SharedSignal<any>) {
		this.gcProtected.add(signal)
	}

	protected unprotectFromGC(signal: SharedSignal<any>) {
		this.gcProtected.delete(signal)
	}

	_makeOrGetSignal<T>(key: string, init: T, updateOnEqual: boolean): { cached: boolean, signal: SharedSignal<T> } {
		const result = super._makeOrGetSignal(key, init, updateOnEqual);
		if (!result.cached) {
			this.send({ cmd: "get", key, init: this.serialize(DyneinState.sample(result.signal) as any), updateOnEqual });
		}
		return result;
	}

	forceRefresh(signal: SharedSignal<any>) {
		this.send({ cmd: "get", key: signal.key, init: this.serialize(DyneinState.sample(signal) as any), updateOnEqual: signal.sharedSignalUpdateOnEqual });
	}

	private rpcIDCounter = 0;
	private pendingRPCResolvers: Map<number, [(val: any) => void, (err: Error) => void]> =
		new Map();

	public async rpc(arg: any) {
		return new Promise((resolve, reject) => {
			const id = this.rpcIDCounter++;
			this.pendingRPCResolvers.set(id, [resolve, reject]);
			this.send({
				cmd: "rpc",
				id,
				arg: this.serialize(arg)
			});
		});
	}

	public getObjectSignal<T>(obj: any, init: T, updateOnEqual = false): SharedSignal<T> {
		return this._makeOrGetSignal("$" + stableJSONStringify(obj), init, updateOnEqual).signal;
	}
}
