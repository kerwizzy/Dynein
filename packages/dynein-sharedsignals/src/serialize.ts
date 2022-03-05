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
	value: SerializedSharedSignal<any>
};
export type SerializedSharedSet = {
	type: "sharedSet";
	key: string;
	value: SerializedSharedSignal<any>
};
export type SerializedSharedMap = {
	type: "sharedMap";
	key: string;
	value: SerializedSharedSignal<any>
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
const updateFromRemoteSymbol = Symbol("updateSymbol");
export interface SharedSignal<T> extends DataSignal<T> {
	readonly synced: () => boolean;
	readonly syncedPromise: Promise<void>
	readonly key: string;
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

type SpliceListener<T> = (start: number, deleteCount: number, added: T[], removed: T[])=>void

export abstract class SharedStateEndpoint {
	abstract uuid(): string;
	protected abstract debounceInterval: number;

	protected customSerializers: Map<(thing: any) => boolean, CustomSerializer<any>> = new Map();
	protected customDeserializers: Map<string, CustomSerializer<any>> = new Map();

	// This has to be keyed by the signal and handled in this class (not in SharedArray as one might
	// expect) because only the signal is dereferenced below in handleMessage, not the SharedArray.
	// A further problem with putting these listeners in SharedArray is that only SharedSignal objects are deserialized
	// properly to an existing version. So, for instance, if two copies of a serialized SharedArray based on the
	// same signal are deserialized, they will be deserialized as two *DIFFERENT* SharedArray objects,
	// because there is no cache by key of SharedArray objects as there is for SharedSignals.
	protected onSpliceListeners: Map<SharedSignal<any[]>, Set<SpliceListener<any>>> = new Map()

	protected handleMessage(from: string, msg: ServerOrClientMessage) {
		switch (msg.cmd) {
			case "set":
			case "update":
			case "got":
				const currentSignal = this.getSignalByKey(msg.key);
				if (!currentSignal) {
					if (msg.cmd === "got") {
						return //ignore, probably GC'd
					}
					console.warn("Got `"+msg.cmd+"` to unknown signal: "+msg.key);
					return;
				}

				DyneinState.batch(() => {
					if (msg.cmd === "set" || msg.cmd === "got") {
						const deserialized = this.deserialize(msg.value);
						currentSignal[updateFromRemoteSymbol](from, deserialized, msg.cmd === "set");
					} else if (msg.cmd === "update") {
						const target = DyneinState.sample(currentSignal);
						const args = this.deserialize(msg.args);
						if (msg.method === "splice") {
							const removed = target.splice(...args);
							this.onSplice(currentSignal, args[0], args[1], args.slice(2), removed)
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

	protected onSplice<T>(signal: SharedSignal<T[]>, start: number, deleteCount: number, added: T[], removed: T[]) {
		if (!this.onSpliceListeners.has(signal)) {
			return
		}
		for (const listener of this.onSpliceListeners.get(signal)!) {
			listener(start, deleteCount, added, removed)
		}
	}

	addSpliceListener<T>(signal: SharedSignal<T[]>, listener: SpliceListener<T>) {
		if (!this.onSpliceListeners.has(signal)) {
			this.onSpliceListeners.set(signal, new Set())
		}
		this.onSpliceListeners.get(signal)!.add(listener)
	}

	removeSpliceListener<T>(signal: SharedSignal<T[]>, listener: SpliceListener<T>) {
		if (!this.onSpliceListeners.has(signal)) {
			return
		}
		this.onSpliceListeners.get(signal)!.delete(listener)
		if (this.onSpliceListeners.get(signal)!.size === 0) {
			this.onSpliceListeners.delete(signal)
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

	serialize<T>(value: T): Serialize<T> {
		if (
			value === null ||
			value === undefined ||
			typeof value === "boolean" ||
			typeof value === "number" ||
			typeof value === "string" ||
			typeof value === "bigint"
		) {
			return value as any
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
				key: value.key,
				init: this.serialize(DyneinState.sample(value)),
				updateOnEqual: value.sharedSignalUpdateOnEqual
			} as Serialize<SharedSignal<any>> as any;
		} else if (value instanceof SharedArray) {
			return { type: "sharedArr", key: value.value.key, value:this.serialize(value.value) } as Serialize<
				SharedArray<any>
			> as any;
		} else if (value instanceof SharedSet) {
			return { type: "sharedSet", key: value.value.key, value:this.serialize(value.value) } as Serialize<
				SharedSet<any>
			> as any;
		} else if (value instanceof SharedMap) {
			return { type: "sharedMap", key: value.value.key, value:this.serialize(value.value) } as Serialize<
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
			return this._makeOrGetSignal(value.key, this.deserialize(value.init), value.updateOnEqual).signal;
		} else if (value.type === "sharedArr") {
			return new SharedArray(this, this.deserialize(value.value))
		} else if (value.type === "sharedSet") {
			return new SharedSet(this, this.deserialize(value.value))
		} else if (value.type === "sharedMap") {
			return new SharedMap(this, this.deserialize(value.value))
		} else if (value.type === "custom") {
			if (this.customDeserializers.has(value.name)) {
				const serializer = this.customDeserializers.get(value.name)!;
				return serializer.deserialize(value.value, this.deserialize.bind(this));
			}
			throw new Error("Missing deserializer for custom type " + value.name);
		} else {
			console.log("can't deserialize",value)
			throw new Error("Can't deserialize.");
		}
	}

	protected abstract getSignalByKey(key: string): SharedSignal<any> | undefined;
	protected abstract setSignalByKey(key: string, value: SharedSignal<any>): void;
	protected abstract protectFromGC(value: SharedSignal<any>): void
	protected abstract unprotectFromGC(value: SharedSignal<any>): void

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
			const toSend = DyneinState.sample(value) as any;

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
		value.__sharedSignal = signal; // make GC of signal depend on GC of value.

		let onSynced: ()=>void
		const syncedPromise = new Promise<SharedSignal<T>>((resolve) => {
			onSynced = ()=>{
				this.unprotectFromGC(signal)
				synced(true);
				resolve(signal) // resolve with signal so syncedPromise refs signal and signal won't get GC'd if syncedPromise is used
			}
		})

		signal[updateFromRemoteSymbol] = (from, newVal, isSetCmd) => {
			onSynced()

			if (!hasBeenSet || isSetCmd) {
				hasBeenSet ||= isSetCmd
				lastUpdateFrom = from;
				value(newVal);
				updateRemote()
			}
		};

		//@ts-ignore
		signal.key = key;

		signal[localSignalSymbol] = value;
		signal[sharedSignalSymbol] = true;

		//@ts-ignore
		signal.sharedSignalUpdateOnEqual = updateOnEqual;

		const synced = DyneinState.value(false);
		Object.defineProperty(signal, "synced", {
			get:() => {
				this.protectFromGC(signal) // protect until synced
				return () => {
					return synced();
				};
			}
		})

		Object.defineProperty(signal, "syncedPromise", {
			get:() => {
				this.protectFromGC(signal) // protect until synced
				return syncedPromise
			}
		})

		this.setSignalByKey(key, signal);

		return { cached: false, signal };
	}

	signal<T>(
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

	sharedArray<T>(init: SharedSignal<T[]> | Iterable<T> = [], key?: string): SharedArray<T> {
		key = key !== undefined ? "@" + key : "_" + this.uuid();
		if (isSharedSignal(init)) {
			return new SharedArray(this, init)
		} else {
			return new SharedArray(this, this._makeOrGetSignal(key, Array.from(init as Iterable<T>), true).signal);
		}
	}

	sharedSet<T extends UniqueSerializable>(init: SharedSignal<Set<T>> | Iterable<T>, key?: string): SharedSet<T> {
		key = key !== undefined ? "@" + key : "_" + this.uuid();
		if (isSharedSignal(init)) {
			return new SharedSet(this, init)
		} else {
			return new SharedSet(this, this._makeOrGetSignal(key, new Set(init as Iterable<T>), true).signal);
		}
	}

	sharedMap<K extends UniqueSerializable, V>(
		init: SharedSignal<Map<K, V>> | [K, V][] = [],
		key?: string
	): SharedMap<K, V> {
		key = key !== undefined ? "@" + key : "_" + this.uuid();
		if (isSharedSignal(init)) {
			return new SharedMap(this, init)
		} else {
			return new SharedMap(this, this._makeOrGetSignal(key, new Map(init as [K, V][]), true).signal);
		}
	}
}

class SharedArray<T> {
	private readonly parent: SharedStateEndpoint;
	readonly value: SharedSignal<T[]>;

	private get v() {
		return DyneinState.sample(this.value);
	}

	constructor(parent: SharedStateEndpoint, value: SharedSignal<T[]>) {
		this.parent = parent;
		this.value = value
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

	// See above for why these are fundamentally methods on the SharedStateEndpoint not on SharedArray
	addSpliceListener(listener: SpliceListener<T>) {
		this.parent.addSpliceListener(this.value, listener)
	}

	removeSpliceListener(listener: SpliceListener<T>) {
		this.parent.removeSpliceListener(this.value, listener)
	}

	splice(start: number, deleteCount: number, ...items: T[]) {
		const removed = this.v.splice(start, deleteCount, ...items);
		this.value[localSignalSymbol](this.v);
		//@ts-ignore
		this.parent.onSplice(this.value, start, deleteCount, items, removed)

		//@ts-ignore
		this.parent.broadcastUpdate({
			cmd: "update",
			method: "splice",
			key: this.value.key,
			args: this.parent.serialize([start, deleteCount, ...items])
		});
		return removed;
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

class SharedMap<K extends UniqueSerializable, V> {
	private readonly parent: SharedStateEndpoint;
	readonly value: SharedSignal<Map<K, V>>;

	constructor(parent: SharedStateEndpoint, value: SharedSignal<Map<K, V>>) {
		this.parent = parent;
		this.value = value
	}

	private get v() {
		return DyneinState.sample(this.value);
	}

	get(key: K): V | undefined {
		return this.value().get(key);
	}

	set(key: K, value: V) {
		DyneinState.sample(this.value).set(key, value);
		this.value[localSignalSymbol](this.v);
		//@ts-ignore
		this.parent.broadcastUpdate({
			cmd: "update",
			method: "set",
			key: this.value.key,
			args: this.parent.serialize([key, value])
		});
		return this;
	}

	has(key: K) {
		return this.value().has(key); //TODO: should maybe restructure this class so this only fires when key actually is added or removed
	}

	delete(key: K) {
		DyneinState.sample(this.value).delete(key);
		this.value[localSignalSymbol](this.v);
		//@ts-ignore
		this.parent.broadcastUpdate({
			cmd: "update",
			method: "delete",
			key: this.value.key,
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

	constructor(parent: SharedStateEndpoint, value: SharedSignal<Set<T>>) {
		this.parent = parent
		this.value = value
	}

	private get v() {
		return DyneinState.sample(this.value);
	}

	add(entry: T) {
		if (this.has(entry)) {
			return;
		}
		DyneinState.sample(this.value).add(entry);
		this.value[localSignalSymbol](this.v);
		//@ts-ignore
		this.parent.broadcastUpdate({
			cmd: "update",
			method: "add",
			key: this.value.key,
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
		DyneinState.sample(this.value).delete(entry);
		this.value[localSignalSymbol](this.v);
		//@ts-ignore
		this.parent.broadcastUpdate({
			cmd: "update",
			method: "delete",
			key: this.value.key,
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
