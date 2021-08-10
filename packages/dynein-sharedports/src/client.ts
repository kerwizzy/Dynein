import {
	SharedStateEndpoint,
	SetMessage,
	UpdateMessage,
	ClientToServerMessage,
	ServerToClientMessage,
	Serializable,
	SharedPort,
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

	protected uuid(): string {
		return this.params.uuid();
	}

	constructor(params: ClientParams) {
		super();
		this.unsubscribeReg = new FinalizationRegistry((key: string) => {
			//For the moment don't do this.sharedPortsByKey.delete(key), so that get error on try to access
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

	protected sharedPortsByKey: Map<string, SharedPort<any>> = new Map();
	protected getPortByKey(key: string): SharedPort<any> | undefined {
		if (this.sharedPortsByKey.has(key)) {
			const val = this.sharedPortsByKey.get(key)!;
			return val
		}
	}
	protected setPortByKey(key: string, port: SharedPort<any>) {
		if (this.sharedPortsByKey.has(key)) {
			throw new Error("Overwrite cached port")
		}
		this.sharedPortsByKey.set(key, port);
	}

	/* broken GC-aware implementation
	protected sharedPortsByKey: Map<string, WeakRef<SharedPort<any>>> = new Map();

	protected getPortByKey(key: string): SharedPort<any> | undefined {
		if (this.sharedPortsByKey.has(key)) {
			const ref = this.sharedPortsByKey.get(key)!;
			const val = ref.deref();
			if (!val) {
				throw new Error("Tried to fetch a GCd port");
			} else {
				return val;
			}
		}
	}

	protected setPortByKey(key: string, port: SharedPort<any>) {
		this.sharedPortsByKey.set(key, new WeakRef(port));
		this.unsubscribeReg.register(port, key, port);
	}
	*/

	_makeOrGetPort<T>(key: string, init: T, updateOnEqual: boolean): { cached: boolean, port: SharedPort<T> } {
		const result = super._makeOrGetPort(key, init, updateOnEqual);
		if (!result.cached) {
			this.send({ cmd: "get", key, init: this.serialize(result.port.sample() as any), updateOnEqual });
		}
		return result;
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

	public getObjectPort<T>(obj: any, init: T, updateOnEqual = false): SharedPort<T> {
		return this._makeOrGetPort("$" + stableJSONStringify(obj), init, updateOnEqual).port;
	}
}
