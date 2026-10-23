import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    // Use the library source directly; a real app would import the published package.
    alias: { 'lit-canon': fileURLToPath(new URL('../../src/index.ts', import.meta.url)) },
  },
});
