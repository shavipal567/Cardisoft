import { createReadStream, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

/** Serve OCR resources from this app in development and include them in builds. */
export function ocrAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const core = dirname(require.resolve('tesseract.js-core/package.json'));
  const assets = new Map([
    ['ocr/worker.min.js', require.resolve('tesseract.js/dist/worker.min.js')],
    ['ocr/lang/eng.traineddata.gz', require.resolve('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz')],
    ...readdirSync(core).filter((name) => /\.wasm(?:\.js)?$/.test(name))
      .map((name): [string, string] => [`ocr/core/${name}`, join(core, name)]),
  ]);
  return {
    name: 'local-ocr-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0];
        const key = pathname.startsWith(server.config.base)
          ? pathname.slice(server.config.base.length) : pathname.replace(/^\//, '');
        const path = assets.get(key);
        if (!path) return next();
        res.setHeader('Content-Type', key.endsWith('.js') ? 'text/javascript' : key.endsWith('.wasm') ? 'application/wasm' : 'application/gzip');
        createReadStream(path).on('error', next).pipe(res);
      });
    },
    async generateBundle() {
      for (const [fileName, path] of assets) {
        this.emitFile({ type: 'asset', fileName, source: await readFile(path) });
      }
    },
  };
}
