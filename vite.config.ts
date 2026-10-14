import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      // Native compilation creates locked executables on Windows. Generated
      // builds and test evidence must not be watched as frontend source.
      ignored: ['**/builds/**', '**/src-tauri/target/**', '**/output/**', '**/artifacts/**', '**/portable/**'],
    },
  },
  build: {
    rollupOptions: {
      input: {
        app: fileURLToPath(new URL('./index.html', import.meta.url)),
      },
    },
  },
})
