import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Tauri expects a stable localhost port and does not want Vite to silently move.
export default defineConfig(({ mode }) => {
  const excludeDevelopmentFontAssets = {
    name: 'exclude-development-font-comparison-assets',
    enforce: 'pre' as const,
    resolveId(source: string) {
      if (mode !== 'development' && source.endsWith('/styles/dev-fonts.css')) return '\0dev-font-comparison-stub'
      return undefined
    },
    load(id: string) {
      if (id === '\0dev-font-comparison-stub') return ''
      return undefined
    },
  }
  return {
  base: process.env.LUSTRA_E2E_FILE_MODE === '1' ? './' : '/',
  plugins: [excludeDevelopmentFontAssets, react(), tailwindcss()],
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
  }
})
