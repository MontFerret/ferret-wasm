import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['js/index.ts', 'js/index.node.ts'],
    format: ['esm', 'cjs'],
    target: 'es2022',
    platform: 'neutral',
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    treeshake: true,
    outDir: 'dist',
    outExtension({ format }) {
        return { js: format === 'cjs' ? '.cjs' : '.js' };
    },
});
