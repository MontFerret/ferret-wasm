import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GoRuntime } from '../js/bridge';
import { runGoRuntime } from '../js/factory';

describe('Go WASM runtime lifecycle', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('clears pending runtime timers after a normal exit', async () => {
        vi.useFakeTimers();
        const first = setTimeout(() => undefined, 1_000);
        const second = setTimeout(() => undefined, 2_000);
        const runtime = createRuntime(Promise.resolve(), [first, second]);
        const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

        await runGoRuntime(runtime, {} as WebAssembly.Instance);

        expect(clearTimeoutSpy).toHaveBeenCalledWith(first);
        expect(clearTimeoutSpy).toHaveBeenCalledWith(second);
        expect(runtime._scheduledTimeouts.size).toBe(0);
    });

    it('clears pending runtime timers after a failed exit', async () => {
        vi.useFakeTimers();
        const timeout = setTimeout(() => undefined, 1_000);
        const runtime = createRuntime(
            Promise.reject(new Error('runtime failed')),
            [timeout],
        );
        const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

        await expect(
            runGoRuntime(runtime, {} as WebAssembly.Instance),
        ).rejects.toThrow('runtime failed');

        expect(clearTimeoutSpy).toHaveBeenCalledWith(timeout);
        expect(runtime._scheduledTimeouts.size).toBe(0);
    });
});

function createRuntime(
    result: Promise<void>,
    timeouts: Array<ReturnType<typeof setTimeout>>,
): GoRuntime {
    return {
        _scheduledTimeouts: new Map(
            timeouts.map((timeout, index) => [index, timeout]),
        ),
        env: {},
        importObject: {},
        run: vi.fn(() => result),
    };
}
