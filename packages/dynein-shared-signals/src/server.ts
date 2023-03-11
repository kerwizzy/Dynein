import {
	SharedStateEndpoint,
	SetMessage,
	UpdateMessage,
	ClientToServerMessage,
	ServerToClientMessage,
	Serializable,
	SharedSignal
} from "./serialize.js";

import Deque from "double-ended-queue"

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
	readonly clients: Map<string, Client<T>> = new Map();
	private subscriptions: Map<string, Set<Client<T>>> = new Map();
	private specialGetters: Record<string, (client: Client<T>) => any>;
	debounceInterval = 0;
	sharedSignalsByKey: Map<string, SharedSignal<any>> = new Map();
	private params: ServerParams<T>;

	private serverHandleMessageAwaits = 0;

	private messageQueue: Deque<[Client<T>, ClientToServerMessage]> = new Deque()
	private handlingMessages: boolean = false


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
				this.messageQueue.push([client, msg])
				setTimeout(()=>{
					this.handleMessageChunks()
				}, 40)
			},
			(clientID, metadata) => {
				this.clients.set(clientID, { id: clientID, metadata });
			},
			(clientID) => {
				const client = this.clients.get(clientID)
				if (!client) {
					console.warn("Unexpected state: delete nonexistent clientID")
					return
				}
				this.clients.delete(clientID);
				for (const subscribers of this.subscriptions.values()) {
					subscribers.delete(client)
				}
			}
		);

		const logStatus = () => {
			//console.log(`subscriptions: ${this.subscriptions.size} sharedSignalsByKey: ${this.sharedSignalsByKey.size} queued msgs: ${this.messageQueue.length} serverHandleMessageAwaits ${this.serverHandleMessageAwaits}`)
			setTimeout(logStatus, 2_000)
		}
		logStatus()
	}

	protected async handleMessageChunks() {
		if (this.handlingMessages) {
			return
		}
		const chunkSize = 500
		this.handlingMessages = true
		while (this.messageQueue.length > 0) {
			const msgs: [Client<T>, ClientToServerMessage][] = []
			for (let i = 0; i<chunkSize; i++) {
				if (this.messageQueue.length === 0) {
					break
				}
				msgs.push(this.messageQueue.shift()!)
			}
			await Promise.all(msgs.map(([client, msg]) => this.tryServerHandleMessage(client, msg)))
		}
		this.handlingMessages = false
	}

	protected async tryServerHandleMessage(client: Client<T>, msg: ClientToServerMessage) {
		this.serverHandleMessageAwaits++
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
		this.serverHandleMessageAwaits--
	}

	protected async broadcastUpdate(
		msg: SetMessage | UpdateMessage,
		blockSendTo?: string | undefined
	) {
		if (!this.subscriptions.has(msg.key)) {
			return
		}
		const subscriptions = this.subscriptions.get(msg.key)!;
		for (let client of subscriptions) {
			if (blockSendTo !== client.id) {
				if (await this.params.checkCanRead(client.id, msg.key, client.metadata)) {
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
							if (msg.cmd === "set" && !this.getSignalByKey(msg.key)) {
								this._makeOrGetSignal(
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
			case "subscribe": {
				// This is different from a "get" command in that "subscribe" only adds the subscription
				// instead of also fetching and returning the value. This is useful when
				// the client already knows the value (e.g., because it fetched a lot of values at
				// once as part of a search query) but still wants to be alerted on updates
				if (await this.params.checkCanRead(client.id, msg.key, client.metadata)) {
					if (!this.subscriptions.has(msg.key)) {
						this.subscriptions.set(msg.key, new Set());
					}
					this.subscriptions.get(msg.key)!.add(client);
				} else {
					this.sendToClient(client, {
						cmd: "err",
						causeCmd: "subscribe",
						err: "Unauthorized"
					});
					return;
				}
			} break
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
									if (!this.subscriptions.get(msg.key)?.has(client)) {
										return // unsubscribed in meantime, no need to send got
									}
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
								if (this.sharedSignalsByKey.has(msg.key)) {
									this.sendToClient(client, {
										cmd: "got",
										key: msg.key,
										value: this.serialize(
											this.sharedSignalsByKey.get(msg.key)!()
										),
										updateOnEqual: this.sharedSignalsByKey.get(msg.key)!
											.sharedSignalUpdateOnEqual
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
					if (keyType === KeyType.uuid || keyType === KeyType.object) {
						if (subscriptionSet.size === 0) {
							//TODO: maybe there could be a race condition here if one last client leaves and then another now client requests at about the same time?
							this.sharedSignalsByKey.delete(msg.key);
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

	protected getSignalByKey(key: string): SharedSignal<any> | undefined {
		return this.sharedSignalsByKey.get(key);
	}
	protected setSignalByKey(key: string, signal: SharedSignal<any>) {
		this.sharedSignalsByKey.set(key, signal);
	}

	protected protectFromGC(signal: SharedSignal<any>) {
		// do nothing, since server doesn't handle GC at the moment
	}

	protected unprotectFromGC(signal: SharedSignal<any>) {
		// do nothing, since server doesn't handle GC at the moment
	}

	public getObjectSignal<T>(obj: any, init: T, updateOnEqual = false) {
		return this._makeOrGetSignal("$" + stableJSONStringify(obj), init, updateOnEqual).signal;
	}
}
