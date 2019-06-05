import isNodeJS from './is-node';
import Global = NodeJS.Global;

export class Platform implements Global {
    public Array: typeof Array;
    public ArrayBuffer: typeof ArrayBuffer;
    public Boolean: typeof Boolean;
    public Buffer: typeof Buffer;
    public DataView: typeof DataView;
    public Date: typeof Date;
    public Error: typeof Error;
    public EvalError: typeof EvalError;
    public Float32Array: typeof Float32Array;
    public Float64Array: typeof Float64Array;
    public Function: typeof Function;
    public GLOBAL: NodeJS.Global;
    public Infinity: typeof Infinity;
    public Int16Array: typeof Int16Array;
    public Int32Array: typeof Int32Array;
    public Int8Array: typeof Int8Array;
    public Intl: typeof Intl;
    public JSON: typeof JSON;
    public Map: MapConstructor;
    public Math: typeof Math;
    public NaN: typeof NaN;
    public Number: typeof Number;
    public Object: typeof Object;
    public Promise: Function;
    public RangeError: typeof RangeError;
    public ReferenceError: typeof ReferenceError;
    public RegExp: typeof RegExp;
    public Set: SetConstructor;
    public String: typeof String;
    public Symbol: Function;
    public SyntaxError: typeof SyntaxError;
    public TypeError: typeof TypeError;
    public URIError: typeof URIError;
    public Uint16Array: typeof Uint16Array;
    public Uint32Array: typeof Uint32Array;
    public Uint8Array: typeof Uint8Array;
    public Uint8ClampedArray: Function;
    public WeakMap: WeakMapConstructor;
    public WeakSet: WeakSetConstructor;
    public clearImmediate: (immediateId: NodeJS.Immediate) => void;
    public clearInterval: (intervalId: NodeJS.Timeout) => void;
    public clearTimeout: (timeoutId: NodeJS.Timeout) => void;
    public console: typeof console;
    public decodeURI: typeof decodeURI;
    public decodeURIComponent: typeof decodeURIComponent;
    public encodeURI: typeof encodeURI;
    public encodeURIComponent: typeof encodeURIComponent;
    public escape: (str: string) => string;
    public eval: typeof eval;
    public gc: () => void;
    public global: NodeJS.Global;
    public isFinite: typeof isFinite;
    public isNaN: typeof isNaN;
    public parseFloat: typeof parseFloat;
    public parseInt: typeof parseInt;
    public process: NodeJS.Process;
    public queueMicrotask: typeof queueMicrotask;
    public root: NodeJS.Global;
    public setImmediate: (
        callback: (...args: any[]) => void,
        ...args: any[]
    ) => NodeJS.Immediate;
    public setInterval: (
        callback: (...args: any[]) => void,
        ms: number,
        ...args: any[]
    ) => NodeJS.Timeout;
    public setTimeout: (
        callback: (...args: any[]) => void,
        ms: number,
        ...args: any[]
    ) => NodeJS.Timeout;
    public undefined: typeof undefined;
    public unescape: (str: string) => string;
    public v8debug: any;
    public fs: any;
    public crypto: any;
    public performance: any;
    public encoder: TextEncoder;
    public decoder: TextDecoder;

    [key: string]: any;

    constructor(encoding = 'utf-8') {
        const env: Global = (isNodeJS ? global : window) as any;

        this.Array = env.Array;
        this.ArrayBuffer = env.ArrayBuffer;
        this.Boolean = env.Boolean;
        this.Buffer = env.Buffer;
        this.DataView = env.DataView;
        this.Date = env.Date;
        this.Error = env.Error;
        this.EvalError = env.EvalError;
        this.Float32Array = env.Float32Array;
        this.Float64Array = env.Float64Array;
        this.Function = env.Function;
        this.GLOBAL = this;
        this.Infinity = env.Infinity;
        this.Int8Array = env.Int8Array;
        this.Int16Array = env.Int16Array;
        this.Int32Array = env.Int32Array;
        this.Intl = env.Intl;
        this.JSON = env.JSON;
        this.Map = env.Map;
        this.Math = env.Math;
        this.NaN = env.NaN;
        this.Number = env.Number;
        this.Object = env.Object;
        this.Promise = env.Promise;
        this.RangeError = env.RangeError;
        this.ReferenceError = env.ReferenceError;
        this.RegExp = env.RegExp;
        this.Set = env.Set;
        this.String = env.String;
        this.Symbol = env.Symbol;
        this.SyntaxError = env.SyntaxError;
        this.TypeError = env.TypeError;
        this.URIError = env.URIError;
        this.Uint8Array = env.Uint8Array;
        this.Uint8ClampedArray = env.Uint8ClampedArray;
        this.Uint16Array = env.Uint16Array;
        this.Uint32Array = env.Uint32Array;
        this.WeakMap = env.WeakMap;
        this.WeakSet = env.WeakSet;
        this.clearImmediate = env.clearImmediate;
        this.clearInterval = env.clearInterval;
        this.clearTimeout = env.clearTimeout;
        this.console = env.console;
        this.decodeURI = env.decodeURI;
        this.decodeURIComponent = env.decodeURIComponent;
        this.encodeURI = env.encodeURI;
        this.encodeURIComponent = env.encodeURIComponent;
        this.escape = env.escape;
        this.eval = env.eval;
        this.gc = isNodeJS ? env.gc : () => {};
        this.global = this;
        this.isFinite = env.isFinite;
        this.isNaN = env.isNaN;
        this.parseFloat = env.parseFloat;
        this.parseInt = env.parseInt;
        this.process = env.process;
        this.queueMicrotask = env.queueMicrotask;
        this.root = this;
        this.setImmediate = env.setImmediate;
        this.setInterval = env.setInterval;
        this.setTimeout = env.setTimeout;
        this.undefined = env.undefined;
        this.unescape = env.unescape;
        this.v8debug = env.v8debug;

        if (isNodeJS) {
            const fs = require('fs');
            const nodeCrypto = require('crypto');

            this.fs = fs;
            this.crypto = {
                getRandomValues(b: any) {
                    nodeCrypto.randomFillSync(b);
                },
            };
            this.performance = {
                now() {
                    const [sec, nsec] = process.hrtime();
                    return sec * 1000 + nsec / 1000000;
                },
            };

            const util = require('util');
            this.encoder = new util.TextEncoder(encoding);
            this.decoder = new util.TextDecoder(encoding);
        } else {
            let outputBuf = '';
            const platform = this;
            this.fs = {
                constants: {
                    O_WRONLY: -1,
                    O_RDWR: -1,
                    O_CREAT: -1,
                    O_TRUNC: -1,
                    O_APPEND: -1,
                    O_EXCL: -1,
                }, // unused
                writeSync(fd, buf) {
                    outputBuf += platform.decoder.decode(buf);
                    const nl = outputBuf.lastIndexOf('\n');
                    if (nl != -1) {
                        console.log(outputBuf.substr(0, nl));
                        outputBuf = outputBuf.substr(nl + 1);
                    }
                    return buf.length;
                },
                write(fd, buf, offset, length, position, callback) {
                    if (
                        offset !== 0 ||
                        length !== buf.length ||
                        position !== null
                    ) {
                        throw new Error('not implemented');
                    }
                    const n = this.writeSync(fd, buf);
                    callback(null, n);
                },
                open(path, flags, mode, callback) {
                    const err = new Error('not implemented');
                    (err as any).code = 'ENOSYS';
                    callback(err);
                },
                read(fd, buffer, offset, length, position, callback) {
                    const err = new Error('not implemented');
                    (err as any).code = 'ENOSYS';
                    callback(err);
                },
                fsync(fd, callback) {
                    callback(null);
                },
            };

            this.crypto = window.crypto;
            this.performance = window.performance;
            this.encoder = new (window.TextEncoder as any)(encoding);
            this.decoder = new window.TextDecoder(encoding);
        }
    }
}
