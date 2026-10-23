import { createServer } from 'node:http';
import { resolve } from 'node:path';
import express from 'express';
import { createApplication, fileStore } from './app';

const port = Number(process.env.PORT ?? 5173);
const app = createApplication(fileStore(resolve(process.env.DATA_FILE ?? '.data/operations.json')));
const server = createServer(app);
if (process.env.NODE_ENV === 'production' || process.argv.includes('--production')) {
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
  app.use(vite.middlewares);
}
server.listen(port, '0.0.0.0', () => console.log(`RelaySafe ready at http://localhost:${port} — local simulation, no authentication`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
