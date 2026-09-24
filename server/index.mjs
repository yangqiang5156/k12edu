import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createTtsMiddleware } from './tts.mjs';
import { createContentGeneratorMiddleware } from './content-generator.mjs';
import { createDatabase, initializeDatabase } from './database.mjs';
import { createIdentityService } from './identity.mjs';
import { createUsageService } from './usage.mjs';
import { createAudioCache } from './audio-cache.mjs';

const root = resolve('dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg' };
const database = createDatabase();
await initializeDatabase(database);
const identity = createIdentityService(database);
const usage = createUsageService(database, identity);
const audioCache = createAudioCache();
const tts = createTtsMiddleware(process.env, fetch, { usage, cache: audioCache });
const contentGenerator = createContentGeneratorMiddleware(process.env, fetch, { usage });
const server = createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  void identity.handle(req, res, () => contentGenerator(req, res, () => tts(req, res, async () => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (path === '/healthz') {
        const healthy = !database.configured || await database.health();
        res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(healthy ? 'ok\n' : 'database unavailable\n');
        return;
      }
      if (path.startsWith('/api/')) { res.writeHead(404); res.end(); return; }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      let file = resolve(root, '.' + path);
      if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
      if (path.endsWith('/')) file = resolve(file, 'index.html');
      const data = await readFile(file);
      const noStore = path === '/' || path.endsWith('/index.html') || path.endsWith('/sw.js') || path.endsWith('/manifest.webmanifest');
      const cacheControl = path.startsWith('/assets/') || path.startsWith('/stories/')
        ? 'public, max-age=31536000, immutable'
        : noStore
          ? 'no-store, no-cache, must-revalidate, max-age=0'
          : 'no-cache, must-revalidate';
      const baseHeaders = {
        'Content-Type': mime[extname(file)] || 'application/octet-stream',
        'Cache-Control': cacheControl,
        ...(noStore ? { Pragma: 'no-cache', Expires: '0' } : {}),
      };
      if (extname(file) === '.mp3') {
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
        if (req.headers.range && !range) {
          res.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${data.length}` }); res.end(); return;
        }
        if (range) {
          const start = Number(range[1]);
          const end = range[2] ? Number(range[2]) : data.length - 1;
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= data.length || end < start) {
            res.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${data.length}` }); res.end(); return;
          }
          const last = Math.min(end, data.length - 1);
          res.writeHead(206, { ...baseHeaders, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${last}/${data.length}`, 'Content-Length': last - start + 1 });
          res.end(req.method === 'HEAD' ? undefined : data.subarray(start, last + 1)); return;
        }
      }
      res.writeHead(200, { ...baseHeaders, ...(extname(file) === '.mp3' ? { 'Accept-Ranges': 'bytes' } : {}), 'Content-Length': data.length });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(404); res.end('文件不存在'); }
  })));
});

server.listen(Number(process.env.PORT || 80), process.env.HOST || '0.0.0.0', () => {
  console.log(`乐学服务已启动；PostgreSQL=${database.configured ? '已配置' : '未配置'}；OSS=${audioCache.ossEnabled ? '已配置' : '未配置'}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.close(() => void database.close().finally(() => process.exit(0)));
});
