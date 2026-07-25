import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * Redirect @testing-library/react imports in test files to a wrapper that
 * supplies the root TooltipProvider. This keeps individual test files from
 * having to repeat the wrapper while still using the familiar testing-library
 * import path.
 */
function testLibraryWrapperPlugin() {
  return {
    name: 'test-library-wrapper',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!/\.(test|spec)\.(tsx|ts)$/.test(id)) return
      if (!code.includes('@testing-library/react')) return
      return code.replace(
        /from\s+['"]@testing-library\/react['"]/g,
        "from '@/test/testing-library'",
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), testLibraryWrapperPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    css: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
        'src/types/**',
        'src/mocks/**',
        'src/vite-env.d.ts',
      ],
    },
  },
})
