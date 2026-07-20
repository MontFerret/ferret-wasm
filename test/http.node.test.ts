import { describe, expect, it, vi } from 'vitest';

import { createPinnedLookup, resolveNodeAddress } from '../js/node_http';

describe('Node HTTP transport address selection', () => {
    it('rejects a DNS result set when any address is denied', async () => {
        const validate = vi.fn((address: string) =>
            address === '127.0.0.1' ? 'localhost is not allowed' : undefined,
        );

        await expect(
            resolveNodeAddress('mixed.example', validate, async () => [
                { address: '93.184.216.34', family: 4 },
                { address: '127.0.0.1', family: 4 },
            ]),
        ).rejects.toThrow('localhost is not allowed');
        expect(validate).toHaveBeenCalledTimes(2);
    });

    it('pins the selected validated address in the request lookup', async () => {
        const selected = await resolveNodeAddress(
            'safe.example',
            () => undefined,
            async () => [
                { address: '93.184.216.34', family: 4 },
                { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
            ],
        );
        const lookup = createPinnedLookup(selected);

        const result = await new Promise<{ address: string; family: number }>(
            (resolve, reject) => {
                lookup('changed.example', {}, (error, address, family) => {
                    if (error != null) {
                        reject(error);
                        return;
                    }
                    if (Array.isArray(address) || family == null) {
                        reject(new Error('lookup did not return one address'));
                        return;
                    }
                    resolve({ address, family });
                });
            },
        );

        expect(result).toEqual({
            address: '93.184.216.34',
            family: 4,
        });
    });
});
