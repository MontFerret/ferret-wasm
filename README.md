# Ferret WASM

Ferret v2 compiled to WebAssembly for Node.js and modern browsers.

This package contains `github.com/MontFerret/ferret/v2` at
`v2.0.0-alpha.30`. It exposes explicit engine, plan, and session lifecycles and
returns JSON-decoded JavaScript values.

## Requirements

- Node.js 22 or newer, or a modern browser with WebAssembly, `fetch`, and
  `crypto.getRandomValues`
- Go 1.25 or newer when building from source

## Installation

```sh
npm install @montferret/ferret-wasm
```

## Direct execution

ES modules:

```javascript
import { create } from '@montferret/ferret-wasm';

const engine = await create();

try {
    const result = await engine.run(
        `FOR value IN 1..3 RETURN value * @factor`,
        { params: { factor: 2 } },
    );

    console.log(result); // [2, 4, 6]
} finally {
    await engine.close();
}
```

CommonJS:

```javascript
const { create } = require('@montferret/ferret-wasm');
```

## Plans and sessions

Compiled plans can be run with one-off parameters or used to create an explicit
session. A session captures its parameters when it is created and may be reused
sequentially.

```javascript
const engine = await create();
const plan = engine.compile(`RETURN @factor * 2`);

console.log(plan.params); // ['factor']
console.log(await plan.run({ params: { factor: 3 } })); // 6

const session = plan.createSession({ params: { factor: 4 } });

try {
    console.log(await session.run()); // 8
    console.log(await session.run()); // 8
} finally {
    await session.close();
    await plan.close();
    await engine.close();
}
```

Sessions reject concurrent runs. Closing a plan or engine closes all idle child
resources, but rejects without closing anything while a child session is
running. Every `close()` method is idempotent.

## JavaScript functions

Functions are registered when the engine is created and cannot be mutated
afterward. Names are canonicalized to uppercase, including namespace segments.
Functions may return a value or a promise.

```javascript
const engine = await create({
    functions: {
        join: (...values) => values.join('-'),
        async_value: async () => ({ status: 'ok' }),
    },
});

try {
    console.log(await engine.run(`RETURN JOIN('a', 'b')`)); // a-b
    console.log(await engine.run(`RETURN ASYNC_VALUE()`)); // { status: 'ok' }
} finally {
    await engine.close();
}
```

Parameters and function values support JSON-compatible values plus
`Uint8Array`. JavaScript `undefined` maps to Ferret `NONE`. Cycles, non-finite
numbers, class instances, and other unsupported values fail explicitly.

## Cancellation

Pass an `AbortSignal` to a direct, plan, or session run:

```javascript
const controller = new AbortController();
const pending = engine.run(`WAIT(10000) RETURN TRUE`, {
    signal: controller.signal,
});

controller.abort();

try {
    await pending;
} catch (error) {
    console.log(error.name); // AbortError
}
```

Ferret execution and HTTP calls observe cancellation. A JavaScript promise
returned by a registered function cannot be forcibly cancelled; the package
keeps the WASM runtime alive until that promise settles and then reports the
run as aborted.

## Browser loading

The browser export loads `ferret.wasm` and `wasm_exec.js` relative to the
package entrypoint. Both assets must be served with the generated JavaScript.
You can override the WASM source:

```javascript
const engine = await create({
    wasm: new URL('/assets/ferret.wasm', location.href),
});
```

`wasm` also accepts a file path in Node.js, an `ArrayBuffer`, a `Uint8Array`, or
a precompiled `WebAssembly.Module`.

The full Ferret v2 standard library is registered. Browser HTTP calls use the
browser networking stack and are subject to CORS.

## Migrating from v1

| v1                             | v2                                      |
| ------------------------------ | --------------------------------------- |
| `compiler.exec(query, params)` | `engine.run(query, { params })`         |
| `compiler.compile(query)`      | `engine.compile(query)`                 |
| `program.run(params)`          | `plan.run({ params })`                  |
| `program.destroy()`            | `await plan.close()`                    |
| `compiler.register(name, fn)`  | `create({ functions: { [name]: fn } })` |
| `compiler.version()`           | `engine.version`                        |

There is no v1 compatibility facade.

## Development

```sh
npm ci
npm run build
npm run check
npm run test:browser
```

The build copies `wasm_exec.js` from the same Go installation used to compile
`ferret.wasm`; these files must always be published together.
