# ferret-wasm

Engine compiler and runtime ported to WASM

## Installation

```sh
npm install @montferret/ferret-wasm
```

## Quick start


```javascript
const create = require('@montferret/ferret-wasm');

async function test() {
  const compiler = await create();
  
  const out = await compiler.exec(`
      FOR i IN 1..10
          RETURN i * 2
  `)
  
  console.log(out); // [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]
}

test();
```

```javascript
const create = require('@montferret/ferret-wasm');

async function test() {
  const compiler = await create();
  
  const program = compiler.compile(`
      FOR i IN 1..10
          RETURN i * @factor
  `)
  
  const out1 = await program.run({ factor: 2 });
  
  console.log(out1); // [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]
  
    const out2 = await program.run({ factor: 3 });

    console.log(out2); // [3, 6, 9, 12, 15, 18, 21, 24, 27, 30]
}

test();
```