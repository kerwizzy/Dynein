import D from "dynein";
var RenderState;
(function (RenderState) {
    RenderState[RenderState["keep"] = 0] = "keep";
    RenderState[RenderState["add"] = 1] = "add";
    RenderState[RenderState["remove"] = 2] = "remove";
})(RenderState || (RenderState = {}));
export default class Hyperfor {
    startItem;
    toPatch;
    start;
    end;
    render;
    boundPatch;
    constructor(init, render) {
        this.render = render;
        this.start = D.dom.node(document.createComment("<hyperfor>"));
        this.toPatch = [];
        this.startItem = null;
        this.end = D.dom.node(document.createComment("</hyperfor>"));
        this.boundPatch = this.patch.bind(this);
        this.set(init);
    }
    clear() {
        if (this.start.previousSibling === null && this.end.nextSibling === null) {
            const parent = this.start.parentNode;
            parent.textContent = "";
            parent.appendChild(this.start);
            parent.appendChild(this.end);
        }
        else {
            const range = document.createRange();
            range.setStartAfter(this.start);
            range.setEndBefore(this.end);
            range.deleteContents();
        }
    }
    set(val) {
        this.clear();
        this.toPatch = [];
        this.startItem = null;
        D.dom.runInNodeContext(this.end.parentNode, this.end, () => {
            D.state.expectStatic(() => {
                for (let i = 0; i < val.length; i++) {
                    const value = val[i];
                    const start = D.dom.node(document.createComment(""));
                    const ctx = new D.state.DestructionContext();
                    ctx.resume(() => {
                        this.render(value);
                    });
                    const end = D.dom.node(document.createComment(""));
                    const render = {
                        state: RenderState.keep,
                        value,
                        start,
                        end,
                        prev: null,
                        next: null,
                        ctx
                    };
                    if (i === 0) {
                        this.startItem = render;
                    }
                    else {
                        render.prev = this.toPatch[i - 1];
                        render.prev.next = render;
                    }
                    this.toPatch.push(render);
                }
            });
        });
    }
    getItem(i) {
        return this.toPatch[i].value;
    }
    splice(start, remove, ...insert) {
        return this.spliceArr(start, remove, insert);
    }
    spliceArr(start, remove, insert) {
        const values = [];
        for (let i = start; i < start + remove; i++) {
            values.push(this.toPatch[i].value);
            this.toPatch[i].state = RenderState.remove;
        }
        const afterIndex = start + remove;
        let prev = afterIndex >= 1 ? this.toPatch[afterIndex - 1] : null;
        const toInsert = [];
        for (let j = 0; j < insert.length; j++) {
            const value = insert[j];
            const render = {
                state: RenderState.add,
                value,
                start: null,
                end: null,
                prev: prev,
                next: null,
                ctx: new D.state.DestructionContext()
            };
            if (prev === null) {
                this.startItem = render;
            }
            else {
                prev.next = render;
            }
            prev = render;
            toInsert.push(render);
        }
        if (afterIndex < this.toPatch.length) {
            const afterRender = this.toPatch[afterIndex];
            if (prev) {
                prev.next = afterRender;
                afterRender.prev = prev;
            }
        }
        this.toPatch.splice(start, remove, ...toInsert);
        return values;
    }
    findIndex(fn) {
        for (let i = 0; i < this.toPatch.length; i++) {
            if (fn(this.toPatch[i].value)) {
                return i;
            }
        }
        return -1;
    }
    get length() {
        return this.toPatch.length;
    }
    patch() {
        const rendered = [];
        let item = this.startItem;
        let prevNode = this.start;
        D.state.expectStatic(() => {
            while (item) {
                if (item.state === RenderState.add) {
                    D.dom.runInNodeContext(prevNode.parentNode, prevNode.nextSibling, () => {
                        item.start = D.dom.node(document.createComment(""));
                        item.ctx.reset();
                        item.ctx.resume(() => {
                            this.render(item.value);
                        });
                        item.end = D.dom.node(document.createComment(""));
                    });
                    prevNode = item.end;
                    rendered.push(item);
                    item.state = RenderState.keep;
                }
                else if (item.state === RenderState.remove) {
                    const range = document.createRange();
                    range.setStartBefore(item.start);
                    range.setEndAfter(item.end);
                    range.deleteContents();
                    if (item.prev) {
                        item.prev.next = item.next;
                    }
                    if (item.next) {
                        item.next.prev = item.prev;
                    }
                    item.ctx.destroy();
                    // don't change prevNode
                }
                else {
                    //nothing to do, continue
                    prevNode = item.end;
                    rendered.push(item);
                }
                item = item.next;
            }
        });
        this.toPatch = rendered;
    }
}
//# sourceMappingURL=hyperfor.js.map