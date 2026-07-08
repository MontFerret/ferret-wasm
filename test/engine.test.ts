import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

// @ts-ignore The generated declaration exists only after the build step.
import { create } from '../dist/index.node.js';

describe('Ferret WASM v2', () => {
    it('reports exact versions and executes JSON-compatible results', async () => {
        const engine = await create();
        try {
            expect(engine.version).toEqual({
                wasm: '2.0.0-alpha.30',
                ferret: 'v2.0.0-alpha.30',
            });
            await expect(
                engine.run('RETURN { value: [1, 2, 3], ok: TRUE }'),
            ).resolves.toEqual({ value: [1, 2, 3], ok: true });
        } finally {
            await engine.close();
        }
    });

    it('compiles plans, exposes params, and reuses explicit sessions', async () => {
        const engine = await create();
        const plan = engine.compile('RETURN @factor * 2');
        expect(plan.params).toEqual(['factor']);

        await expect(plan.run({ params: { factor: 3 } })).resolves.toBe(6);

        const session = plan.createSession({ params: { factor: 4 } });
        await expect(session.run()).resolves.toBe(8);
        await expect(session.run()).resolves.toBe(8);

        await session.close();
        await plan.close();
        await engine.close();
        await engine.close();
        await expect(session.run()).rejects.toThrow('Session is closed');
    });

    it('binds canonical synchronous and asynchronous host functions', async () => {
        const engine = await create({
            functions: {
                echo: (value: unknown) => value,
                async_value: async () => ({
                    nested: ['ok', new Uint8Array([1, 2, 3])],
                }),
                'custom::value': () => 'namespaced',
                fail: async () => {
                    throw new Error('host failure');
                },
            },
        });
        try {
            await expect(
                engine.run("RETURN ECHO({ value: ['a', 2] })"),
            ).resolves.toEqual({ value: ['a', 2] });
            await expect(engine.run('RETURN ASYNC_VALUE()')).resolves.toEqual({
                nested: ['ok', 'AQID'],
            });
            await expect(engine.run('RETURN CUSTOM::VALUE()')).resolves.toBe(
                'namespaced',
            );
            await expect(engine.run('RETURN FAIL()')).rejects.toThrow(
                'host failure',
            );
        } finally {
            await engine.close();
        }
    });

    it('rejects duplicate canonical function names', async () => {
        await expect(
            create({
                functions: {
                    test: () => 1,
                    TEST: () => 2,
                },
            }),
        ).rejects.toThrow('duplicate function name');
    });

    it('cancels a run and rejects concurrent session reuse and close', async () => {
        const engine = await create({
            functions: {
                slow: () =>
                    new Promise((resolve) =>
                        setTimeout(() => resolve('done'), 50),
                    ),
            },
        });
        const plan = engine.compile('RETURN SLOW()');
        const session = plan.createSession();
        const controller = new AbortController();
        const running = session.run({ signal: controller.signal });

        await expect(session.run()).rejects.toThrow('already running');
        await expect(session.close()).rejects.toThrow('running session');
        await expect(engine.close()).rejects.toThrow('running session');

        controller.abort();
        await expect(running).rejects.toMatchObject({ name: 'AbortError' });
        await session.close();
        await plan.close();
        await engine.close();
    });

    it('isolates concurrently created engines', async () => {
        const [first, second] = await Promise.all([
            create({ functions: { VALUE: () => 'first' } }),
            create({ functions: { VALUE: () => 'second' } }),
        ]);
        try {
            await expect(first.run('RETURN VALUE()')).resolves.toBe('first');
            await expect(second.run('RETURN VALUE()')).resolves.toBe('second');
        } finally {
            await Promise.all([first.close(), second.close()]);
        }
    });

    it('rejects invalid host values and runtime errors', async () => {
        const engine = await create();
        try {
            const cyclic: Record<string, unknown> = {};
            cyclic.self = cyclic;
            await expect(
                engine.run('RETURN @value', {
                    params: { value: cyclic },
                }),
            ).rejects.toThrow('cyclic JavaScript value');
            await expect(engine.run('RETURN MISSING()')).rejects.toThrow(
                'unresolved function',
            );
        } finally {
            await engine.close();
        }
    });

    it('cascades close through idle plans and sessions', async () => {
        const engine = await create();
        const plan = engine.compile('RETURN TRUE');
        const session = plan.createSession();

        await engine.close();

        await expect(session.run()).rejects.toThrow('Session is closed');
        await expect(plan.run()).rejects.toThrow('Plan is closed');
        expect(() => engine.compile('RETURN TRUE')).toThrow('Engine is closed');
    });

    it('loads through the CommonJS export', async () => {
        const require = createRequire(import.meta.url);
        const commonjs = require('../dist/index.node.cjs') as {
            create: typeof create;
        };
        const engine = await commonjs.create();
        try {
            await expect(engine.run('RETURN 42')).resolves.toBe(42);
        } finally {
            await engine.close();
        }
    });

    it('loads a custom Uint8Array WASM source', async () => {
        const bytes = await readFile(
            new URL('../dist/ferret.wasm', import.meta.url),
        );
        const engine = await create({
            wasm: new Uint8Array(bytes),
        });
        try {
            await expect(engine.run('RETURN 21 * 2')).resolves.toBe(42);
        } finally {
            await engine.close();
        }
    });

    it('surfaces source-aware compile errors', async () => {
        const engine = await create();
        try {
            expect(() =>
                engine.compile({ name: 'broken.fql', text: 'RETURN (' }),
            ).toThrow(/compile query/i);
        } finally {
            await engine.close();
        }
    });
});
