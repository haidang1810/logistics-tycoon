import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Dev-only: POST a JPEG data URL to /__shot and it is saved to .shots/<name>.jpg.
 * Lets tooling capture the game canvas even when the window isn't being painted.
 */
function devScreenshots(): Plugin {
  return {
    name: 'dev-screenshots',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const { name, data } = JSON.parse(body) as { name: string; data: string };
          const dir = path.resolve(__dirname, '.shots');
          fs.mkdirSync(dir, { recursive: true });
          const file = path.join(dir, `${name.replace(/[^\w-]/g, '_')}.jpg`);
          fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
          res.end(file);
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devScreenshots()],
  server: { port: 5173 },
});
