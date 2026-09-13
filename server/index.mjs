import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createTtsMiddleware } from './tts.mjs';
import { createContentGeneratorMiddleware } from './content-generator.mjs';

const root = resolve('dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const tts = createTtsMiddleware();
const contentGenerator = createContentGeneratorMiddleware();
createServer((req, res) => {
  void contentGenerator(req, res, () => tts(req, res, async () => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (path === '/healthz') { res.end('ok\n'); return; }
      if (path.startsWith('/api/')) { res.writeHead(404); res.end(); return; }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      let file = resolve(root, '.' + path);
      if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
      if (path.endsWith('/')) file = resolve(file, 'index.html');
      const data = await readFile(file);
      const noStore = path === '/' || path.endsWith('/index.html') || path.endsWith('/sw.js') || path.endsWith('/manifest.webmanifest');
      const cacheControl = path.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : noStore
          ? 'no-store, no-cache, must-revalidate, max-age=0'
          : 'no-cache, must-revalidate';
      res.writeHead(200, {
        'Content-Type': mime[extname(file)] || 'application/octet-stream',
        'Cache-Control': cacheControl,
        ...(noStore ? { Pragma: 'no-cache', Expires: '0' } : {}),
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(404); res.end('文件不存在'); }
  }));
}).listen(Number(process.env.PORT || 80), process.env.HOST || '0.0.0.0', () => console.log('乐学在线语音服务已启动'));
