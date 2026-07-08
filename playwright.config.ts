import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './test/browser',
    use: {
        baseURL: 'http://127.0.0.1:4173',
        headless: true,
    },
    webServer: {
        command: 'node test/server.mjs',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: false,
    },
});
