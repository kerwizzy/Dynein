import { DestructionContext } from "dynein";
declare enum RenderState {
    keep = 0,
    add = 1,
    remove = 2
}
interface Render<T> {
    state: RenderState;
    value: T;
    start: Node | null;
    end: Node | null;
    prev: Render<T> | null;
    next: Render<T> | null;
    ctx: DestructionContext;
}
export default class Hyperfor<T> {
    startItem: Render<T> | null;
    toPatch: Render<T>[];
    start: Node;
    end: Node;
    render: (item: T) => void;
    boundPatch: () => void;
    constructor(init: T[], render: (item: T) => void);
    clear(): void;
    set(val: T[]): void;
    getItem(i: number): T;
    splice(start: number, remove: number, ...insert: T[]): T[];
    spliceArr(start: number, remove: number, insert: T[]): T[];
    findIndex(fn: (item: T) => boolean): number;
    get length(): number;
    patch(): void;
}
export {};
