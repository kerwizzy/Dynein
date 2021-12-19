import { default as DyneinState, DataSignal } from "dynein-state";

type Primitive = null | undefined | boolean | string | number | bigint;

export type SerializedSet<T> = {
	type: "set";
	values: Serialize<T>[];
};

export type SerializedMap<K, V> = {
	type: "map";
	entries: [Serialize<K>, Serialize<V>][];
};
export type SerializedRecord<V> = {
	type: "obj";
	obj: Record<string, Serialize<V>>;
};

export type SerializedSharedSignal<T> = {
	type: "sharedSignal";
	key: string;
	init: Serialize<T>;
	updateOnEqual: boolean;
};

export type SerializedSharedArray = {
	type: "sharedArr";
	key: string;
};
export type SerializedSharedSet = {
	type: "sharedSet";
	key: string;
};
export type SerializedSharedMap = {
	type: "sharedMap";
	key: string;
};

export type SerializedCustomValue = {
	type: "custom";
	name: string;
	value: any;
};

export type SerializedDate = {
	type: "date";
	value: number;
};

export type SerializedArray<T> = Serialize<T>[];

export type StringRecord<V> = Record<string, V>;

export type Serialize<T> = T extends Primitive
	? T
	: T extends Date
	? SerializedDate
	: T extends Array<infer V>
	? SerializedArray<V>
	: T extends Map<infer K, infer V>
	? SerializedMap<K, V>
	: T extends Set<infer T>
	? SerializedSet<T>
	: T extends StringRecord<infer V>
	? SerializedRecord<V>
	: T extends SharedSignal<infer V>
	? SerializedSharedSignal<V>
	: T extends SharedArray<infer V>
	? SerializedSharedArray
	: T extends SharedSet<infer V>
	? SerializedSharedSet
	: T extends SharedMap<infer K, infer V>
	? SerializedSharedMap
	: never;

export type Serializable =
	| Primitive
	| Date
	| { [key: string]: Serializable }
	| Serializable[]
	| Set<Serializable>
	| Map<Serializable, Serializable>
	| SharedSignal<any>
	| SharedArray<Serializable>
	| SharedSet<UniqueSerializable>
	| SharedMap<UniqueSerializable, Serializable>;
export type UniqueSerializable = Primitive | SharedSignal<Serializable>;
export type SerializedValue = Serialize<Serializable> | SerializedCustomValue;

export function isSharedSignal(thing: any): thing is SharedSignal<any> {
	return thing && thing[sharedSignalSymbol] === true;
}

export type GetMessage = {
	cmd: "get";
	key: string;
	init: SerializedValue;
	updateOnEqual: boolean;
};

export type GotMessage = {
	cmd: "got";
	key: string;
	value: SerializedValue;
	updateOnEqual: boolean;
};

export type SetMessage = {
	cmd: "set";
	key: string;
	value: SerializedValue;
	updateOnEqual: boolean;
};

export type UpdateMessage = {
	cmd: "update";
	key: string;
	method: string;
	args: SerializedArray<any>;
};

export type UnsubscribeMessage = {
	cmd: "unsubscribe";
	key: string;
};

export type ErrorMessage = {
	cmd: "err";
	causeCmd: ClientToServerMessage["cmd"];
	err: string;
};

export type RPCMessage = {
	cmd: "rpc";
	id: number;
	arg: SerializedValue;
};

export type RPCResponseMessage = {
	cmd: "rpcOK";
	id: number;
	res: SerializedValue;
};

export type RPCErrorMessage = {
	cmd: "rpcErr";
	id: number;
	err: string;
};

export type ClientToServerMessage =
	| GetMessage
	| SetMessage
	| UpdateMessage
	| UnsubscribeMessage
	| RPCMessage
export type ServerToClientMessage =
	| SetMessage
	| GotMessage
	| UpdateMessage
	| ErrorMessage
	| RPCResponseMessage
	| RPCErrorMessage
export type ServerOrClientMessage = SetMessage | GotMessage | UpdateMessage;

const sharedSignalSymbol = Symbol("isSharedSignal");
const localSignalSymbol = Symbol("setLocal");
const keySymbol = Symbol("sharedSignalKeySymbol");
const updateFromRemoteSymbol = Symbol("updateSymbol");
export interface SharedSignal<T> extends DataSignal<T> {
	readonly synced: () => boolean;
	readonly syncedPromise: Promise<void>
	[keySymbol]: string;
	[localSignalSymbol]: (val: T) => void;
	[sharedSignalSymbol]: true;
	[updateFromRemoteSymbol]: (from: string, val: T, isSetCmd: boolean) => void;
	readonly sharedSignalUpdateOnEqual: boolean;
}

export function throttleDebounce(time: number, fn: () => void, throttle: boolean=true): () => void {
	let lastCall = 0;
	let seq = 0
	return () => {
		seq++
		const ownSeq = seq
		if (throttle && lastCall + time < Date.now()) {
			fn(); //throttle
			lastCall = Date.now();
		} else {
			setTimeout(() => {
				if (seq === ownSeq) { //no tries since try that triggered this timeout
					fn(); //debounce
					lastCall = Date.now();
				}
			}, time);
		}
	};
}

interface CustomSerializer<T> {
	name: string;
	predicate: (thing: any) => thing is T;
	serialize(thing: T, serialize: (value: any) => any): any;
	deserialize(serialized: any, deserialize: (value: any) => any): T;
}

function assertUnreachable(x: never): never {
	throw new Error("Unexpected state");
}

export abstract class SharedStateEndpoint {
	protected abstract uuid(): string;
	protected abstract debounceInterval: number;

	protected customSerializers: Map<(thing: any) => boolean, CustomSerializer<any>> = new Map();
	protected customDeserializers: Map<string, CustomSerializer<any>> = new Map();

	protected handleMessage(from: string, msg: ServerOrClientMessage) {
		switch (msg.cmd) {
			case "set":
			case "update":
			case "got":
				const currentSignal = this.getSignalByKey(msg.key);
				if (!currentSignal) {
					console.warn("Got `set` to unknown signal");
					return;
				}

				DyneinState.batch(() => {
					if (msg.cmd === "set" || msg.cmd === "got") {
						const deserialized = this.deserialize(msg.value);
						currentSignal[updateFromRemoteSymbol](from, deserialized, msg.cmd === "set");
					} else if (msg.cmd === "update") {
						const target = currentSignal.sample();
						const args = this.deserialize(msg.args);
						if (msg.method === "splice") {
							target.splice(...args);
						} else if (msg.method === "add") {
							target.add(...msg.args);
						} else if (msg.method === "set") {
							target.set(...msg.args);
						} else if (msg.method === "delete") {
							target.delete(...msg.args);
						} else {
							throw new Error("Unrecognized method");
						}
						currentSignal[localSignalSymbol](target);
						this.broadcastUpdate(msg, from); //echo same update message to other clients if on server, do nothing if on client because of blockSendTo
					} else {
						throw new Error("Unexpected state");
					}
				});
				break;
			default:
				assertUnreachable(msg);
		}
	}

	protected abstract broadcastUpdate(
		msg: SetMessage | UpdateMessage,
		blockSendTo?: string | undefined
	): void;

	addCustomSerializer<T>(serializer: CustomSerializer<T>) {
		if (this.customDeserializers.has(serializer.name)) {
			throw new Error("Custom serializer name collision");
		}
		this.customSerializers.set(serializer.predicate, serializer);
		this.customDeserializers.set(serializer.name, serializer);
	}

	serialize<T extends Serializable>(value: T): Serialize<T> {
		if (
			value === null ||
			value === undefined ||
			typeof value === "boolean" ||
			typeof value === "number" ||
			typeof value === "string" ||
			typeof value === "bigint"
		) {
			return value as Serialize<Primitive> as any;
		} else if (value instanceof Date) {
			return {
				type: "date",
				value: value.getTime()
			} as Serialize<Date> as any;
		} else if (Array.isArray(value)) {
			return value.map((v) => this.serialize(v)) as Serialize<any[]> as any;
		} else if (
			typeof value === "object" &&
			(Object.getPrototypeOf(value) === Object.prototype ||
				Object.getPrototypeOf(value) === null)
		) {
			const out = Object.create(null);
			for (let key in value) {
				//@ts-ignore
				out[key] = this.serialize(value[key]);
			}
			return { type: "obj", obj: out } as any;
		} else if (value instanceof Set) {
			return {
				type: "set",
				values: Array.from(value.values()).map((v) => this.serialize(v))
			} as Serialize<Set<any>> as any;
		} else if (value instanceof Map) {
			return {
				type: "map",
				entries: Array.from(value.entries()).map(([k, v]) => [
					this.serialize(k),
					this.serialize(v)
				])
			} as Serialize<Map<any, any>> as any;
		} else if (isSharedSignal(value)) {
			return {
				type: "sharedSignal",
				key: value[keySymbol],
				init: value.sample(),
				updateOnEqual: value.sharedSignalUpdateOnEqual
			} as Serialize<SharedSignal<any>> as any;
		} else if (value instanceof SharedSet) {
			return { type: "sharedSet", key: value.value[keySymbol] } as Serialize<
				SharedSet<any>
			> as any;
		} else if (value instanceof SharedMap) {
			return { type: "sharedMap", key: value.value[keySymbol] } as Serialize<
				SharedMap<any, any>
			> as any;
		} else {
			for (let [pred, serializer] of this.customSerializers) {
				if (pred(value)) {
					return {
						type: "custom",
						name: serializer.name,
						value: serializer.serialize(value, this.serialize.bind(this))
					} as any;
				}
			}
			console.log("val = ", value);
			throw new Error("Can't serialize");
		}
	}

	deserialize(value: any): any {
		if (
			value === null ||
			value === undefined ||
			typeof value === "boolean" ||
			typeof value === "number" ||
			typeof value === "string" ||
			typeof value === "bigint"
		) {
			return value;
		} else if (Array.isArray(value)) {
			return (value as SerializedArray<any>).map((v) => this.deserialize(v));
		} else if (value.type === "date") {
			return new Date(value.value);
		} else if (value.type === "map") {
			const out = new Map();
			for (let [k, v] of (value as SerializedMap<any, any>).entries) {
				out.set(this.deserialize(k), this.deserialize(v));
			}
			return out;
		} else if (value.type === "set") {
			const out = new Set();
			for (let entry of (value as SerializedSet<any>).values) {
				out.add(this.deserialize(entry));
			}
			return out;
		} else if (value.type === "obj") {
			const out = Object.create(null);
			for (let key in (value as SerializedRecord<any>).obj) {
				//@ts-ignore
				out[key] = this.deserialize(value.obj[key]);
			}
			return out;
		} else if (value.type === "sharedSignal") {
			return this._makeOrGetSignal(value.key, value.init, value.updateOnEqual);
		} else if (value.type === "sharedArr") {
			return this.sharedArray(value.key);
		} else if (value.type === "sharedSet") {
			return this.sharedSet(value.key);
		} else if (value.type === "sharedMap") {
			return this.sharedMap(value.key);
		} else if (value.type === "custom") {
			if (this.customDeserializers.has(value.name)) {
				const serializer = this.customDeserializers.get(value.name)!;
				return serializer.deserialize(value.value, this.deserialize.bind(this));
			}
			throw new Error("Missing deserializer for custom type " + value.name);
		} else {
			throw new Error("Can't deserialize.");
		}
	}

	protected abstract getSignalByKey(key: string): SharedSignal<any> | undefined;
	protected abstract setSignalByKey(key: string, value: SharedSignal<any>): void;

	_makeOrGetSignal<T>(
		key: string,
		init: T,
		updateOnEqual: boolean
	): { cached: boolean; signal: SharedSignal<T> } {
		const currentSignal = this.getSignalByKey(key);
		if (currentSignal) {
			return { cached: true, signal: currentSignal };
		}

		let value = DyneinState.datavalue(init, updateOnEqual);

		let updateRemoteUndebounced = () => {
			const toSend = value.sample() as any;

			this.broadcastUpdate(
				{
					cmd: "set",
					key,
					value: this.serialize(toSend),
					updateOnEqual,
				},
				lastUpdateFrom
			);
		};
		let updateRemote =
			this.debounceInterval > 0
				? throttleDebounce(this.debounceInterval, updateRemoteUndebounced)
				: updateRemoteUndebounced;

		let lastUpdateFrom: string | undefined = undefined;
		let hasBeenSet = false // only true when has been updated using a `set` not merely a `got`

		const signal = DyneinState.makeSignal(
			() => value(),
			(newVal) => {
				value(newVal);

				hasBeenSet = true
				lastUpdateFrom = undefined;
				updateRemote();
			}
		) as SharedSignal<T>;

		//@ts-ignore
		value.__sharedSignal = signal; // make garbage collection of `value` depend on GC of `signal`.

		let onSynced: ()=>void
		const syncedPromise = new Promise<void>((resolve) => {
			onSynced = ()=>{
				synced(true);
				resolve()
			}
		})

		signal[updateFromRemoteSymbol] = (from, newVal, isSetCmd) => {
			if (!hasBeenSet || isSetCmd) {
				hasBeenSet ||= isSetCmd
				onSynced()
				lastUpdateFrom = from;
				value(newVal);
				updateRemote()
			}
		};

		signal[keySymbol] = key;

		signal[localSignalSymbol] = value;
		signal[sharedSignalSymbol] = true;

		//@ts-ignore
		signal.sharedSignalUpdateOnEqual = updateOnEqual;

		const synced = DyneinState.value(false);
		//@ts-ignore
		signal.synced = () => {
			return synced();
		};

		//@ts-ignore
		signal.syncedPromise = syncedPromise

		this.setSignalByKey(key, signal);

		return { cached: false, signal };
	}

	signal<T extends Serializable>(
		init: T,
		key?: string,
		updateOnEqual: boolean = false
	): SharedSignal<T> {
		key = key !== undefined ? "@" + key : "_" + this.uuid();
		return this._makeOrGetSignal(key, init, updateOnEqual).signal;
	}

	customSignal<T>(init: T, key?: string, updateOnEqual: boolean = false): SharedSignal<T> {
		key = key !== undefined ? "@" + key : "_" + this.uuid();
		return this._makeOrGetSignal(key, init, updateOnEqual).signal;
	}

	sharedArray<T extends Serializable>(init: T[] = [], key?: string): SharedArray<T> {
		key = key !== undefined ? "@" + key : "_" + this.uuid();
		return new SharedArray(this, key, init);
	}

	sharedSet<T extends UniqueSerializable>(init: T[] = [], key?: string): SharedSet<T> {
		key = key !== undefined ? "@" + key : "_" + this.uuid();
		return new SharedSet(this, key, init);
	}

	sharedMap<K extends UniqueSerializable, V extends Serializable>(
		init: [K, V][] = [],
		key?: string
	): SharedMap<K, V> {
		key = key !== undefined ? "@" + key : "_" + this.uuid();
		return new SharedMap(this, key, init);
	}
}

class SharedArray<T extends Serializable> {
	private readonly parent: SharedStateEndpoint;
	readonly value: SharedSignal<T[]>;

	private get v() {
		return this.value.sample();
	}

	constructor(parent: SharedStateEndpoint, key: string, init: T[]) {
		this.parent = parent;
		this.value = this.parent._makeOrGetSignal(key, init, true).signal;
	}

	includes(searchElement: T, fromIndex?: number | undefined): boolean {
		return this.value().includes(searchElement, fromIndex);
	}
	indexOf(searchElement: T, fromIndex?: number | undefined): number {
		return this.value().indexOf(searchElement, fromIndex);
	}
	lastIndexOf(searchElement: T, fromIndex?: number | undefined): number {
		return this.value().lastIndexOf(searchElement, fromIndex);
	}
	map<U>(callbackfn: (value: T, index: number, array: T[]) => U, thisArg?: any): U[] {
		return this.value().map(callbackfn, thisArg);
	}

	splice(start: number, deleteCount: number, ...items: T[]) {
		const out = this.v.splice(start, deleteCount, ...items);
		this.value[localSignalSymbol](this.v);

		//@ts-ignore
		this.parent.broadcastUpdate({
			cmd: "update",
			method: "splice",
			key: this.value[keySymbol],
			args: this.parent.serialize([start, deleteCount, ...items])
		});
		return out;
	}

	push(...items: T[]) {
		this.splice(this.v.length, 0, ...items);
		return this.v.length;
	}

	unshift(...items: T[]) {
		this.splice(0, 0, ...items);
		return this.v.length;
	}

	get length() {
		return this.value().length;
	}

	[Symbol.iterator]() {
		return this.value()[Symbol.iterator]();
	}
}

class SharedMap<K extends UniqueSerializable, V extends Serializable> {
	private readonly parent: SharedStateEndpoint;
	readonly value: SharedSignal<Map<K, V>>;

	constructor(parent: SharedStateEndpoint, key: string, init: [K, V][] = []) {
		this.parent = parent;
		this.value = this.parent._makeOrGetSignal(key, new Map(init), true).signal;
	}

	private get v() {
		return this.value.sample();
	}

	get(key: K): V | undefined {
		return this.value().get(key);
	}

	set(key: K, value: V) {
		this.value.sample().set(key, value);
		this.value[localSignalSymbol](this.v);
		//@ts-ignore
		this.parent.broadcastUpdate({
			cmd: "update",
			method: "set",
			key: this.value[keySymbol],
			args: this.parent.serialize([key, value])
		});
		return this;
	}

	has(key: K) {
		return this.value().has(key); //TODO: should maybe restructure this class so this only fires when key actually is added or removed
	}

	delete(key: K) {
		this.value.sample().delete(key);
		this.value[localSignalSymbol](this.v);
		//@ts-ignore
		this.parent.broadcastUpdate({
			cmd: "update",
			method: "delete",
			key: this.value[keySymbol],
			args: this.parent.serialize([key])
		});
	}

	entries() {
		return this.value().entries();
	}

	[Symbol.iterator]() {
		return this.entries();
	}
}

class SharedSet<T extends UniqueSerializable> {
	private readonly parent: SharedStateEndpoint;
	readonly value: SharedSignal<Set<T>>;

	constructor(parent: SharedStateEndpoint, key: string, init: T[] = []) {
		this.parent = parent;
		this.value = this.parent._makeOrGetSignal(key, new Set(init), true).signal;
	}

	private get v() {
		return this.value.sample();
	}

	add(entry: T) {
		if (this.has(entry)) {
			return;
		}
		this.value.sample().add(entry);
		this.value[localSignalSymbol](this.v);
		//@ts-ignore
		this.parent.broadcastUpdate({
			cmd: "update",
			method: "add",
			key: this.value[keySymbol],
			args: this.parent.serialize([entry])
		});
		return this;
	}

	has(entry: T) {
		return this.value().has(entry); //TODO: should maybe restructure this class so this only fires when key actually is added or removed
	}

	delete(entry: T) {
		if (!this.has(entry)) {
			return;
		}
		this.value.sample().delete(entry);
		this.value[localSignalSymbol](this.v);
		//@ts-ignore
		this.parent.broadcastUpdate({
			cmd: "update",
			method: "delete",
			key: this.value[keySymbol],
			args: this.parent.serialize([entry])
		});
	}

	values() {
		return this.value().values();
	}

	[Symbol.iterator]() {
		return this.values();
	}

	get size() {
		return this.value().size;
	}
}

export type { SharedArray, SharedSet, SharedMap };
