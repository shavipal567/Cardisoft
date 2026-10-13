import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { createReadStream, readFileSync, readdirSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { ocrAssets } from './ocrAssets.js'

// Keep the supplied OBJ source files in the project root. Serve them in dev and
// emit them as static assets for production without converting or duplicating them.
function heartObjAssets(): Plugin {
  const source = resolve(fileURLToPath(new URL('.', import.meta.url)), '../BP51782_FMA3_2_1_inference_isa_FMA67135_Postnatal_anatomical_structure')
  const files = readdirSync(source).filter((file) => file.endsWith('.obj'))
  return {
    name: 'heart-obj-assets',
    configureServer(server) {
      server.middlewares.use('/heart-parts', (req, res, next) => {
        let file
        try { file = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname.slice(1)) }
        catch { return next() }
        if (!files.includes(basename(file)) || file !== basename(file)) return next()
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.setHeader('Cache-Control', 'public, max-age=3600')
        createReadStream(resolve(source, file)).on('error', next).pipe(res)
      })
    },
    generateBundle() {
      for (const file of files) this.emitFile({ type: 'asset', fileName: `heart-parts/${file}`, source: readFileSync(resolve(source, file)) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), ocrAssets(), heartObjAssets()],
  optimizeDeps: { include: ['tesseract.js', 'pdfjs-dist'] },
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true, rewrite: (path) => path.replace(/^\/api/, '') } },
  },
})
