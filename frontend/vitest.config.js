import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.js'

export default mergeConfig(viteConfig, defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    css: false,
    // Some timesheet and milestone tests take ~4 s alone and pass 5 s under full parallel load; the CLI's --testTimeout still overrides this.
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/test/**', 'src/main.jsx', '**/*.test.{js,jsx}'],
      reporter: ['text-summary', 'text'],
    },
  },
}))
