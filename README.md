# ferret-wasm

Ferret compiler and runtime ported to WASM

[![npm version](https://badge.fury.io/js/%40montferret%2Fferret-wasm.svg)](https://badge.fury.io/js/%40montferret%2Fferret-wasm)
[![Build Status](https://secure.travis-ci.org/montferret/ferret-wasm.svg?branch=master)](http://travis-ci.org/montferret/ferret-wasm)

## Installation

```sh
npm install @montferret/ferret-wasm
```

## Limitations

-   Supports only static HTTP driver (Go WASM does not support WebSocket yet)

## Quick start

```javascript
const { create } = require('@montferret/ferret-wasm');

async function test() {
    const compiler = await create();

    const out = await compiler.exec(`
      FOR i IN 1..10
          RETURN i * 2
  `);

    console.log(out); // [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]
}

test();
```

```javascript
const { create } = require('@montferret/ferret-wasm');

async function test() {
    const compiler = await create();

    const program = compiler.compile(`
      FOR i IN 1..10
          RETURN i * @factor
  `);

    const out1 = await program.run({ factor: 2 });

    console.log(out1); // [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]

    const out2 = await program.run({ factor: 3 });

    console.log(out2); // [3, 6, 9, 12, 15, 18, 21, 24, 27, 30]

    // Destroy when you are done with the program
    program.destroy();
}

test();
```

### Function registration

Sync functions

```javascript
const { create } = require('@montferret/ferret-wasm');

async function test() {
    const compiler = await create();
    compiler.register('MY_FUNC', (...args) => {
        return args.join('-');
    });

    const out = await compiler.exec(`
      RETURN MY_FUNC('foo', 'bar')
  `);

    console.log(out); // foo-bar
}

test();
```

Async functions

```javascript
const { create } = require('@montferret/ferret-wasm');

async function test() {
    const compiler = await create();
    compiler.register('MY_FUNC', (...args) => {
        return new Promise(resolve => {
            setTimeout(() => {
                resolve(args.join('-'));
            }, 10);
        });
    });

    const out = await compiler.exec(`
      RETURN MY_FUNC('foo', 'bar')
  `);

    console.log(out); // foo-bar
}

test();
```
