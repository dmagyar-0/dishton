import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  esbuild: { jsx: 'automatic' },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
    environmentMatchGlobs: [
      ['src/ui/**/*.test.tsx', 'jsdom'],
      ['src/lib/**/*.test.tsx', 'jsdom'],
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/routeTree.gen.ts',
        'src/main.tsx',
        'src/lib/database.types.ts',
        'src/observability/**',
        'src/feature-flags/registry.ts',
        'src/styles/**',
      ],
      thresholds: {
        'src/domain/**': {
          lines: 90,
          branches: 90,
          functions: 90,
        },
        lines: 70,
      },
    },
  },
});
