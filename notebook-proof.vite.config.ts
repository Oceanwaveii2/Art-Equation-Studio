import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

/** Separate opt-in build; the production App/build entry points stay untouched. */
export default defineConfig({ plugins: [react()], build: { outDir: 'dist-notebook-proof', rollupOptions: { input: fileURLToPath(new URL('./notebook-proof.html', import.meta.url)) } } })
