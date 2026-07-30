import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Même alias que `tsconfig.json`.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Seule la logique pure est testée ici (CLAUDE.md §7) : pas de DOM.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
