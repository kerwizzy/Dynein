import {
	SharedStateEndpoint,
	SetMessage,
	UpdateMessage,
	ClientToServerMessage,
	ServerToClientMessage,
	Serializable,
	SharedPort
} from "./serialize.js";

interface Client<T> {
	readonly id: string;
	metadata: T;
}

enum KeyType {
	named,
	uuid,
	object
}

function getKeyType(key: string): KeyType {
	const start = key[0];
	switch (start) {
		case "@":
			return KeyType.named;
		case "_":
			return KeyType.uuid;
		case "$":
			return KeyType.object;
		default:
			throw new Error("Unrecognized key prefix");
	}
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

interface ServerParams<T> {
	sendMessage: (clientID: string, msg: ServerToClientMessage) => void;
	setupEvents: (
		onmessage: (clientID: string, msg: ClientToServerMessage) => void,
		onClientConnect: (clientID: string, metadata: T) => void,
		onClientDisconnect: (clientID: string) => void
	) => void;
	checkCanRead: (clientID: string, portID: string, metadata: T) => Promise<boolean>;
	checkCanWrite: (clientID: string, portID: string, metadata: T) => Promise<boolean>;
	rpc: (clientID: string, msg: any, metadata: T) => Promise<any>;
	handleObjectKey: (
		clientID: string,
		cmd: "get" | "set" | "update",
		obj: any,
		value: any,
		updateOnEqual: boolean,
		metadata: T
	) => Promise<any>;
	uuid: () => string;
}

export class SharedStateServer<T> extends SharedStateEndpoint {
	private clients: Map<string, Client<T>> = new Map();
	private subscriptions: Map<string, Set<Client<T>>> = new Map();
	private specialGetters: Record<string, (client: Client<T>) => any>;
	protected debounceInterval = 0;
	sharedPortsByKey: Map<string, SharedPort<any>> = new Map();
	private params: ServerParams<T>;

	uuid() {
		return this.params.uuid();
	}

	constructor(params: ServerParams<T>) {
		super();
		this.specialGetters = {
			serverTime: () => {
				return Date.now();
			},
			clients: () => {
				return new Set(Array.from(this.clients.values()).map((cl) => cl.id));
			},
			ownClientID: (client) => {
				return client.id;
			}
		};

		this.params = params;
		this.params.setupEvents(
			async (clientID, msg) => {
				if (!this.clients.has(clientID)) {
					console.warn("Got message from unknown client");
					return;
				}
				const client = this.clients.get(clientID)!;
				try {
					await this.serverHandleMessage(client, msg);
				} catch (err) {
					console.log("Got error from handle message: ", err);
					this.sendToClient(client, {
						cmd: "err",
						causeCmd: msg.cmd,
						err: "Server error"
					});
				}
			},
			(clientID, metadata) => {
				this.clients.set(clientID, { id: clientID, metadata });
			},
			(clientID) => {
				this.clients.delete(clientID);
			}
		);
	}

	protected async broadcastUpdate(
		msg: SetMessage | UpdateMessage,
		blockSendTo?: string | undefined
	) {
		if (!this.subscriptions.has(msg.key)) {
			throw new Error("Unexpected state");
		}
		const subscriptions = this.subscriptions.get(msg.key)!;
		for (let client of subscriptions) {
			if (blockSendTo !== client.id) {
				if (this.params.checkCanRead(client.id, msg.key, client.metadata)) {
					this.sendToClient(client, msg);
				}
			}
		}
	}

	public async broadcastObjectKeySet(obj: any, value: any) {
		const key = "$" + stableJSONStringify(obj);
		if (!this.subscriptions.has(key)) {
			return;
		}
		this.broadcastUpdate({
			cmd: "set",
			key,
			updateOnEqual: false,
			value: this.serialize(value)
		});
	}

	protected async sendToClient(client: Client<T>, msg: ServerToClientMessage) {
		this.params.sendMessage(client.id, msg);
	}

	protected async serverHandleMessage(client: Client<T>, msg: ClientToServerMessage) {
		switch (msg.cmd) {
			case "set":
				{
					if (await this.params.checkCanWrite(client.id, msg.key, client.metadata)) {
						if (this.specialGetters[msg.key]) {
							return;
						}

						const keyType = getKeyType(msg.key);
						if (!this.subscriptions.has(msg.key)) {
							this.subscriptions.set(msg.key, new Set());
						}

						if (keyType === KeyType.object) {
							try {
								await this.params.handleObjectKey(
									client.id,
									msg.cmd,
									JSON.parse(msg.key.substring(1)),
									this.deserialize(msg.value),
									msg.updateOnEqual,
									client.metadata
								);
								this.broadcastUpdate(msg, client.id);
							} catch (err) {
								this.sendToClient(client, {
									cmd: "err",
									causeCmd: "set",
									err: err instanceof APIError ? err.message : "Server error"
								});
								console.log("got err: ", err);
							}
						} else {
							if (msg.cmd === "set" && !this.getPortByKey(msg.key)) {
								this._makeOrGetPort(
									msg.key,
									this.deserialize(msg.value),
									msg.updateOnEqual
								);
							}
							super.handleMessage(client.id, msg);
						}
					} else {
						this.sendToClient(client, {
							cmd: "err",
							causeCmd: "set",
							err: "Unauthorized"
						});
						return;
					}
				}
				break;
			case "get":
				{
					if (await this.params.checkCanRead(client.id, msg.key, client.metadata)) {
						if (this.specialGetters[msg.key]) {
							this.sendToClient(client, {
								cmd: "got",
								key: msg.key,
								value: this.serialize(this.specialGetters[msg.key](client)),
								updateOnEqual: false
							});
						} else {
							const keyType = getKeyType(msg.key);

							if (!this.subscriptions.has(msg.key)) {
								this.subscriptions.set(msg.key, new Set());
							}
							this.subscriptions.get(msg.key)!.add(client);

							if (keyType === KeyType.object) {
								try {
									const val = await this.params.handleObjectKey(
										client.id,
										msg.cmd,
										JSON.parse(msg.key.substring(1)),
										undefined,
										msg.updateOnEqual,
										client.metadata
									);
									this.sendToClient(client, {
										cmd: "got",
										key: msg.key,
										value: this.serialize(val),
										updateOnEqual: false
									});
								} catch (err) {
									this.sendToClient(client, {
										cmd: "err",
										causeCmd: "get",
										err: err instanceof APIError ? err.message : "Server error"
									});
									this.sendToClient(client, {
										cmd: "got",
										key: msg.key,
										value: this.serialize(undefined),
										updateOnEqual: false
									});
									console.log("got err: ", err);
								}
							} else {
								if (this.sharedPortsByKey.has(msg.key)) {
									this.sendToClient(client, {
										cmd: "got",
										key: msg.key,
										value: this.serialize(
											this.sharedPortsByKey.get(msg.key)!()
										),
										updateOnEqual: this.sharedPortsByKey.get(msg.key)!
											.sharedPortUpdateOnEqual
									});
								} else {
									this.serverHandleMessage(client, {
										cmd: "set",
										key: msg.key,
										value: msg.init,
										updateOnEqual: msg.updateOnEqual
									});
								}
							}
						}
					} else {
						this.sendToClient(client, {
							cmd: "err",
							causeCmd: "get",
							err: "Unauthorized"
						});
						return;
					}
				}
				break;
			case "update":
				{
					if (await this.params.checkCanWrite(client.id, msg.key, client.metadata)) {
						if (this.specialGetters[msg.key]) {
							return;
						}

						const keyType = getKeyType(msg.key);
						if (!this.subscriptions.has(msg.key)) {
							throw new Error("Unexpected state");
						}

						if (keyType === KeyType.object) {
							try {
								await this.params.handleObjectKey(
									client.id,
									msg.cmd,
									JSON.parse(msg.key.substring(1)),
									msg,
									true,
									client.metadata
								);
								this.broadcastUpdate(msg, client.id);
							} catch (err) {
								if (err instanceof APIError) {
									this.sendToClient(client, {
										cmd: "err",
										causeCmd: "update",
										err: err.message
									});
								}
								console.log("got err: ", err);
							}
						} else {
							super.handleMessage(client.id, msg);
						}
					} else {
						this.sendToClient(client, {
							cmd: "err",
							causeCmd: "update",
							err: "Unauthorized"
						});
						return;
					}
				}
				break;
			case "unsubscribe":
				{
					const keyType = getKeyType(msg.key);
					if (!this.subscriptions.has(msg.key)) {
						throw new Error("Unexpected state");
					}
					const subscriptionSet = this.subscriptions.get(msg.key)!;
					subscriptionSet.delete(client);
					if (keyType === KeyType.uuid) {
						if (subscriptionSet.size === 0) {
							//TODO: maybe there could be a race condition here if one last client leaves and then another now client requests at about the same time?
							this.sharedPortsByKey.delete(msg.key);
							this.subscriptions.delete(msg.key);
						}
					}
				}
				break;
			case "rpc":
				{
					try {
						const val = await this.params.rpc(
							client.id,
							this.deserialize(msg.arg),
							client.metadata
						);
						this.sendToClient(client, {
							cmd: "rpcOK",
							id: msg.id,
							res: this.serialize(val)
						});
					} catch (err) {
						if (!(err instanceof APIError)) {
							console.warn("Error serving RPC: ", err);
						}
						const outMsg = err instanceof APIError ? err.message : "Server error";
						this.sendToClient(client, { cmd: "rpcErr", id: msg.id, err: outMsg });
					}
				}
				break;
			default: {
				const nev: never = msg;
				throw new Error("Unrecognized command: " + nev);
			}
		}
	}

	protected getPortByKey(key: string): SharedPort<any> | undefined {
		return this.sharedPortsByKey.get(key);
	}
	protected setPortByKey(key: string, port: SharedPort<any>) {
		this.sharedPortsByKey.set(key, port);
	}
}
