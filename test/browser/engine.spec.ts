import { expect, test } from '@playwright/test';

test('loads the browser package and executes Ferret', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
        const modulePath = '/dist/index.js';
        const { create } = await import(modulePath);
        const engine = await create();
        try {
            const plan = await engine.compile('RETURN @value * 2');
            const session = await plan.createSession({
                params: { value: 21 },
            });

            return {
                version: engine.version,
                session: await session.run(),
                value: await engine.run(
                    'FOR value IN 1..3 RETURN value * @factor',
                    { params: { factor: 2 } },
                ),
                http: await engine.run(
                    `RETURN IO::NET::HTTP::GET('${location.origin}/api/value')`,
                ),
            };
        } finally {
            await engine.close();
        }
    });

    expect(result.version).toEqual({
        self: '2.0.0-alpha.1',
        ferret: '2.0.0-alpha.32',
    });
    expect(result.session).toBe(42);
    expect(result.value).toEqual([2, 4, 6]);
    expect(result.http).toBe('YnJvd3Nlcg==');
});

test('supports host functions and cancellation in a browser', async ({
    page,
}) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
        const modulePath = '/dist/index.js';
        const { create } = await import(modulePath);
        const wasmBuffer: ArrayBuffer = await fetch('/dist/ferret.wasm').then(
            (response) => response.arrayBuffer(),
        );
        const wasm = new Uint8Array(wasmBuffer);
        const engine = await create({
            wasm,
            functions: {
                value: (value: unknown) => ({ wrapped: value }),
                slow: () =>
                    new Promise((resolve) =>
                        setTimeout(() => resolve('late'), 100),
                    ),
            },
        });
        try {
            const value = await engine.run("RETURN VALUE('ok')");
            const controller = new AbortController();
            const pending = engine.run('RETURN SLOW()', {
                signal: controller.signal,
            });
            controller.abort();
            let cancellation = '';
            try {
                await pending;
            } catch (error) {
                cancellation = (error as Error).name;
            }
            return { value, cancellation };
        } finally {
            await engine.close();
        }
    });

    expect(result).toEqual({
        value: { wrapped: 'ok' },
        cancellation: 'AbortError',
    });
});
