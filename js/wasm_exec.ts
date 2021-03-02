import { Platform } from './platform';

export interface ImportObject {
    go: {
        'runtime.wasmExit': (sp: number) => void;
        'runtime.wasmWrite': (sp: number) => void;
        'runtime.clearTimeoutEvent': (sp: number) => void;
        'syscall/js.valueInvoke': (sp: number) => void;
        debug: (value: any) => void;
        'syscall/js.valueSet': (sp: number) => void;
        'syscall/js.valueDelete': (sp: number) => void;
        'runtime.walltime': (sp: number) => void;
        'syscall/js.valueNew': (sp: number) => void;
        'syscall/js.valueInstanceOf': (sp: number) => void;
        'syscall/js.copyBytesToGo': (sp: number) => void;
        'syscall/js.copyBytesToJS': (sp: number) => void;
        'syscall/js.valueLoadString': (sp: number) => void;
        'syscall/js.stringVal': (sp: number) => void;
        'syscall/js.valueIndex': (sp: number) => void;
        'syscall/js.valueLength': (sp: number) => void;
        'syscall/js.valueCall': (sp: number) => void;
        'runtime.resetMemoryDataView': (sp: number) => void;
        'runtime.nanotime1': (sp: number) => void;
        'runtime.walltime1': (sp: number) => void;
        'runtime.nanotime': (sp: number) => void;
        'runtime.getRandomData': (sp: number) => void;
        'syscall/js.finalizeRef': (sp: number) => void;
        'syscall/js.valueGet': (sp: number) => void;
        'syscall/js.valuePrepareString': (sp: number) => void;
        'runtime.scheduleTimeoutEvent': (sp: number) => void;
        'syscall/js.valueSetIndex': (sp: number) => void;
    };
}

export class Go {
    public platform: Platform;
    public argv: string[];
    public env: { [key: string]: any };
    public exit: (code: any) => void;
    public importObject: any;
    public exited: boolean;
    public mem?: DataView;

    private readonly _exitPromise: Promise<any>;
    private _resolveExitPromise?: Function;
    private _scheduledTimeouts: Map<any, any>;
    private _nextCallbackTimeoutID: number;
    private _inst: any;
    private _values: any;
    // @ts-ignore
    private _pendingEvent: any;
    private _goRefCounts: any[];
    private _ids: Map<number | null, number>;
    private _idPool: any[];

    constructor() {
        this.platform = new Platform();
        this.argv = ['js'];
        this.env = {};
        this.exit = (code) => {
            if (code !== 0) {
                console.warn('exit code:', code);
            }
        };
        this._exitPromise = new Promise((resolve) => {
            this._resolveExitPromise = resolve;
        });
        this._pendingEvent = null;
        this._scheduledTimeouts = new Map();
        this._nextCallbackTimeoutID = 1;
        this.exited = false;
        this._goRefCounts = [];
        this._ids = new Map();
        this._idPool = [];

        const setInt64 = (addr: number, v: number) => {
            this.mem?.setUint32(addr + 0, v, true);
            this.mem?.setUint32(addr + 4, Math.floor(v / 4294967296), true);
        };

        const getInt64 = (addr: number) => {
            const low = this.mem?.getUint32(addr + 0, true) || 0;
            const high = this.mem?.getInt32(addr + 4, true) || 0;
            return low + high * 4294967296;
        };

        const loadValue = (addr: number) => {
            const f = this.mem?.getFloat64(addr, true) || 0;
            if (f === 0) {
                return undefined;
            }
            if (!isNaN(f)) {
                return f;
            }

            const id = this.mem?.getUint32(addr, true) || 0;
            return this._values[id];
        };

        const storeValue = (addr: number, v: number) => {
            const nanHead = 0x7ff80000;

            if (typeof v === 'number' && v !== 0) {
                if (isNaN(v)) {
                    this.mem?.setUint32(addr + 4, nanHead, true);
                    this.mem?.setUint32(addr, 0, true);
                    return;
                }
                this.mem?.setFloat64(addr, v, true);
                return;
            }

            if (v === undefined) {
                this.mem?.setFloat64(addr, 0, true);
                return;
            }

            let id = this._ids.get(v) || 0;
            if (id === undefined) {
                id = this._idPool.pop();
                if (id === undefined) {
                    id = this._values.length;
                }
                this._values[id] = v;
                this._goRefCounts[id] = 0;
                this._ids.set(v, id);
            }
            this._goRefCounts[id]++;
            let typeFlag = 0;
            switch (typeof v) {
                case 'object':
                    if (v !== null) {
                        typeFlag = 1;
                    }
                    break;
                case 'string':
                    typeFlag = 2;
                    break;
                case 'symbol':
                    typeFlag = 3;
                    break;
                case 'function':
                    typeFlag = 4;
                    break;
            }
            this.mem?.setUint32(addr + 4, nanHead | typeFlag, true);
            this.mem?.setUint32(addr, id, true);
        };

        const loadSlice = (addr: number) => {
            const array = getInt64(addr + 0);
            const len = getInt64(addr + 8);
            return new Uint8Array(this._inst.exports.mem.buffer, array, len);
        };

        const loadSliceOfValues = (addr: number) => {
            const array = getInt64(addr + 0);
            const len = getInt64(addr + 8);
            const a = new Array(len);
            for (let i = 0; i < len; i++) {
                a[i] = loadValue(array + i * 8);
            }
            return a;
        };

        const loadString = (addr: number) => {
            const saddr = getInt64(addr + 0);
            const len = getInt64(addr + 8);
            return this.platform.decoder.decode(
                new DataView(this._inst.exports.mem.buffer, saddr, len),
            );
        };

        const timeOrigin = Date.now() - this.platform.performance.now();
        this.importObject = {
            go: {
                // Go's SP does not change as long as no Go code is running. Some operations (e.g. calls, getters and setters)
                // may synchronously trigger a Go event handler. This makes Go code get executed in the middle of the imported
                // function. A goroutine can switch to a new stack if the current stack is too small (see morestack function).
                // This changes the SP, thus we have to update the SP used by the imported function.

                // func wasmExit(code int32)
                'runtime.wasmExit': (sp: number) => {
                    sp >>>= 0;
                    const code = this.mem?.getInt32(sp + 8, true);
                    this.exited = true;
                    delete this._inst;
                    delete this._values;
                    delete (this as any)._goRefCounts;
                    delete (this as any)._ids;
                    delete (this as any)._idPool;
                    this.exit(code);
                },

                // func wasmWrite(fd uintptr, p unsafe.Pointer, n int32)
                'runtime.wasmWrite': (sp: number) => {
                    sp >>>= 0;
                    const fd = getInt64(sp + 8);
                    const p = getInt64(sp + 16);
                    const n = this.mem?.getInt32(sp + 24, true);
                    this.platform.fs.writeSync(
                        fd,
                        new Uint8Array(this._inst.exports.mem.buffer, p, n),
                    );
                },

                // func resetMemoryDataView()
                // eslint-ignore-next-line
                // @ts-ignore
                'runtime.resetMemoryDataView': (sp: number) => {
                    sp >>>= 0;
                    this.mem = new DataView(this._inst.exports.mem.buffer);
                },

                // func nanotime1() int64
                'runtime.nanotime1': (sp: number) => {
                    sp >>>= 0;
                    setInt64(
                        sp + 8,
                        (timeOrigin + performance.now()) * 1000000,
                    );
                },

                // func walltime1() (sec int64, nsec int32)
                'runtime.walltime1': (sp: number) => {
                    sp >>>= 0;
                    const msec = new Date().getTime();
                    setInt64(sp + 8, msec / 1000);
                    this.mem?.setInt32(sp + 16, (msec % 1000) * 1000000, true);
                },

                // func scheduleTimeoutEvent(delay int64) int32
                'runtime.scheduleTimeoutEvent': (sp: number) => {
                    sp >>>= 0;
                    const id = this._nextCallbackTimeoutID;
                    this._nextCallbackTimeoutID++;
                    this._scheduledTimeouts.set(
                        id,
                        setTimeout(
                            () => {
                                this._resume();
                                while (this._scheduledTimeouts.has(id)) {
                                    // for some reason Go failed to register the timeout event, log and try again
                                    // (temporary workaround for https://github.com/golang/go/issues/28975)
                                    console.warn(
                                        'scheduleTimeoutEvent: missed timeout event',
                                    );
                                    this._resume();
                                }
                            },
                            getInt64(sp + 8) + 1, // setTimeout has been seen to fire up to 1 millisecond early
                        ),
                    );
                    this.mem?.setInt32(sp + 16, id, true);
                },

                // func clearTimeoutEvent(id int32)
                'runtime.clearTimeoutEvent': (sp: number) => {
                    sp >>>= 0;
                    const id = this.mem?.getInt32(sp + 8, true);
                    clearTimeout(this._scheduledTimeouts.get(id));
                    this._scheduledTimeouts.delete(id);
                },

                // func getRandomData(r []byte)
                'runtime.getRandomData': (sp: number) => {
                    sp >>>= 0;
                    crypto.getRandomValues(loadSlice(sp + 8));
                },

                // func finalizeRef(v ref)
                'syscall/js.finalizeRef': (sp: number) => {
                    sp >>>= 0;
                    const id = this.mem?.getUint32(sp + 8, true) || 0;
                    this._goRefCounts[id]--;
                    if (this._goRefCounts[id] === 0) {
                        const v = this._values[id];
                        this._values[id] = null;
                        this._ids.delete(v);
                        this._idPool.push(id);
                    }
                },

                // func stringVal(value string) ref
                'syscall/js.stringVal': (sp: number) => {
                    sp >>>= 0;
                    storeValue(sp + 24, loadString(sp + 8) as any);
                },

                // func valueGet(v ref, p string) ref
                'syscall/js.valueGet': (sp: number) => {
                    sp >>>= 0;
                    const result = Reflect.get(
                        loadValue(sp + 8),
                        loadString(sp + 16),
                    );
                    sp = this._inst.exports.getsp() >>> 0; // see comment above
                    storeValue(sp + 32, result);
                },

                // func valueSet(v ref, p string, x ref)
                'syscall/js.valueSet': (sp: number) => {
                    sp >>>= 0;
                    Reflect.set(
                        loadValue(sp + 8),
                        loadString(sp + 16),
                        loadValue(sp + 32),
                    );
                },

                // func valueDelete(v ref, p string)
                'syscall/js.valueDelete': (sp: number) => {
                    sp >>>= 0;
                    Reflect.deleteProperty(
                        loadValue(sp + 8),
                        loadString(sp + 16),
                    );
                },

                // func valueIndex(v ref, i int) ref
                'syscall/js.valueIndex': (sp: number) => {
                    sp >>>= 0;
                    storeValue(
                        sp + 24,
                        Reflect.get(loadValue(sp + 8), getInt64(sp + 16)),
                    );
                },

                // valueSetIndex(v ref, i int, x ref)
                'syscall/js.valueSetIndex': (sp: number) => {
                    sp >>>= 0;
                    Reflect.set(
                        loadValue(sp + 8),
                        getInt64(sp + 16),
                        loadValue(sp + 24),
                    );
                },

                // func valueCall(v ref, m string, args []ref) (ref, bool)
                'syscall/js.valueCall': (sp: number) => {
                    sp >>>= 0;
                    try {
                        const v = loadValue(sp + 8);
                        const m = Reflect.get(v, loadString(sp + 16));
                        const args = loadSliceOfValues(sp + 32);
                        const result = Reflect.apply(m, v, args);
                        sp = this._inst.exports.getsp() >>> 0; // see comment above
                        storeValue(sp + 56, result);
                        this.mem?.setUint8(sp + 64, 1);
                    } catch (err) {
                        storeValue(sp + 56, err);
                        this.mem?.setUint8(sp + 64, 0);
                    }
                },

                // func valueInvoke(v ref, args []ref) (ref, bool)
                'syscall/js.valueInvoke': (sp: number) => {
                    sp >>>= 0;
                    try {
                        const v = loadValue(sp + 8);
                        const args = loadSliceOfValues(sp + 16);
                        const result = Reflect.apply(v, undefined, args);
                        sp = this._inst.exports.getsp() >>> 0; // see comment above
                        storeValue(sp + 40, result);
                        this.mem?.setUint8(sp + 48, 1);
                    } catch (err) {
                        storeValue(sp + 40, err);
                        this.mem?.setUint8(sp + 48, 0);
                    }
                },

                // func valueNew(v ref, args []ref) (ref, bool)
                'syscall/js.valueNew': (sp: number) => {
                    sp >>>= 0;
                    try {
                        const v = loadValue(sp + 8);
                        const args = loadSliceOfValues(sp + 16);
                        const result = Reflect.construct(v, args);
                        sp = this._inst.exports.getsp() >>> 0; // see comment above
                        storeValue(sp + 40, result);
                        this.mem?.setUint8(sp + 48, 1);
                    } catch (err) {
                        storeValue(sp + 40, err);
                        this.mem?.setUint8(sp + 48, 0);
                    }
                },

                // func valueLength(v ref) int
                'syscall/js.valueLength': (sp: number) => {
                    sp >>>= 0;
                    setInt64(sp + 16, parseInt(loadValue(sp + 8).length));
                },

                // valuePrepareString(v ref) (ref, int)
                'syscall/js.valuePrepareString': (sp: number) => {
                    sp >>>= 0;
                    const str = this.platform.encoder.encode(
                        String(loadValue(sp + 8)),
                    );
                    storeValue(sp + 16, str as any);
                    setInt64(sp + 24, str.length);
                },

                // valueLoadString(v ref, b []byte)
                'syscall/js.valueLoadString': (sp: number) => {
                    sp >>>= 0;
                    const str = loadValue(sp + 8);
                    loadSlice(sp + 16).set(str);
                },

                // func valueInstanceOf(v ref, t ref) bool
                'syscall/js.valueInstanceOf': (sp: number) => {
                    sp >>>= 0;
                    this.mem?.setUint8(
                        sp + 24,
                        loadValue(sp + 8) instanceof loadValue(sp + 16) ? 1 : 0,
                    );
                },

                // func copyBytesToGo(dst []byte, src ref) (int, bool)
                'syscall/js.copyBytesToGo': (sp: number) => {
                    sp >>>= 0;
                    const dst = loadSlice(sp + 8);
                    const src = loadValue(sp + 32);
                    if (
                        !(
                            src instanceof Uint8Array ||
                            src instanceof Uint8ClampedArray
                        )
                    ) {
                        this.mem?.setUint8(sp + 48, 0);
                        return;
                    }
                    const toCopy = src.subarray(0, dst.length);
                    dst.set(toCopy);
                    setInt64(sp + 40, toCopy.length);
                    this.mem?.setUint8(sp + 48, 1);
                },

                // func copyBytesToJS(dst ref, src []byte) (int, bool)
                'syscall/js.copyBytesToJS': (sp: number) => {
                    sp >>>= 0;
                    const dst = loadValue(sp + 8);
                    const src = loadSlice(sp + 16);
                    if (
                        !(
                            dst instanceof Uint8Array ||
                            dst instanceof Uint8ClampedArray
                        )
                    ) {
                        this.mem?.setUint8(sp + 48, 0);
                        return;
                    }
                    const toCopy = src.subarray(0, dst.length);
                    dst.set(toCopy);
                    setInt64(sp + 40, toCopy.length);
                    this.mem?.setUint8(sp + 48, 1);
                },

                debug: (value: any) => {
                    console.log(value);
                },
            } as any,
        };
    }

    public async run(instance: any): Promise<any> {
        if (!(instance instanceof WebAssembly.Instance)) {
            throw new Error('Go.run: WebAssembly.Instance expected');
        }
        this._inst = instance;
        this.mem = new DataView(this._inst.exports.mem.buffer);
        this._values = [
            // JS values that Go currently has references to, indexed by reference id
            NaN,
            0,
            null,
            true,
            false,
            global,
            this,
        ];
        this._goRefCounts = new Array(this._values.length).fill(Infinity); // number of references that Go has to a JS value, indexed by reference id
        this._ids = new Map([
            // mapping from JS values to reference ids
            [0, 1],
            [null, 2],
            [true, 3],
            [false, 4],
            [global, 5],
            [this, 6],
        ] as any);
        this._idPool = []; // unused ids that have been garbage collected
        this.exited = false; // whether the Go program has exited

        // Pass command line arguments and environment variables to WebAssembly by writing them to the linear memory.
        let offset = 4096;

        const strPtr = (str: string) => {
            const ptr = offset;
            const bytes = this.platform.encoder.encode(str + '\0');
            new Uint8Array(
                (this.mem?.buffer || 0) as any,
                offset,
                bytes.length,
            ).set(bytes);
            offset += bytes.length;
            if (offset % 8 !== 0) {
                offset += 8 - (offset % 8);
            }
            return ptr;
        };

        const argc = this.argv.length;

        const argvPtrs = [];
        this.argv.forEach((arg) => {
            argvPtrs.push(strPtr(arg));
        });
        argvPtrs.push(0);

        const keys = Object.keys(this.env).sort();
        keys.forEach((key: string) => {
            argvPtrs.push(strPtr(`${key}=${this.env[key]}`));
        });
        argvPtrs.push(0);

        const argv = offset;
        argvPtrs.forEach((ptr) => {
            this.mem?.setUint32(offset, ptr, true);
            this.mem?.setUint32(offset + 4, 0, true);
            offset += 8;
        });

        this._inst.exports.run(argc, argv);
        if (this.exited && this._resolveExitPromise) {
            this._resolveExitPromise();
        }
        await this._exitPromise;
    }

    private _resume() {
        if (this.exited) {
            throw new Error('Go program has already exited');
        }

        this._inst.exports.resume();

        if (this.exited && this._resolveExitPromise) {
            this._resolveExitPromise();
        }
    }
}
