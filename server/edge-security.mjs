import { isIP } from 'node:net';
import { apiError } from './http.mjs';

export function trustedClientIp(req, env = process.env) {
  const normalized = value => String(value || '').replace(/^::ffff:/, '');
  const peer = normalized(req.socket?.remoteAddress);
  const trusted = new Set(String(env.TRUSTED_PROXY_IPS || '127.0.0.1,::1').split(',').map(value => normalized(value.trim())));
  const supplied = normalized(req.headers['x-real-ip']);
  return trusted.has(peer) && isIP(supplied) ? supplied : peer || 'unknown';
}
export function createEdgeSecurity(usage, env = process.env) {
  let activeRequests = 0;
  const maximum = Number(env.API_MAX_CONCURRENCY || 40), globalLimit = Number(env.API_GLOBAL_PER_MINUTE_LIMIT || 600);
  if (![maximum, globalLimit].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('入口限流配置必须为正整数');
  return async (req, res, next) => {
    req.clientIp = trustedClientIp(req, env);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    let admitted = false;
    try {
      let path;
      try { path = new URL(req.url || '/', 'http://localhost').pathname; }
      catch { throw Object.assign(new Error('请求地址无效'), { status: 400 }); }
      if (!path.startsWith('/api/')) return await next();
      if (activeRequests >= maximum) throw Object.assign(new Error('服务繁忙，请稍后重试'), { status: 429, retryAfter: 2 });
      activeRequests++; admitted = true;
      if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) throw Object.assign(new Error('不支持的请求方法'), { status: 405 });
      if (!['GET', 'HEAD'].includes(req.method)) {
        if (req.headers['sec-fetch-site'] === 'cross-site') throw Object.assign(new Error('不允许跨站请求'), { status: 403 });
        const expected = env.PUBLIC_ORIGIN || 'https://ai.liqi123.com';
        if (req.headers.origin && req.headers.origin !== expected) throw Object.assign(new Error('请求来源无效'), { status: 403 });
      }
      await usage.rate('ingress:global', globalLimit, 60000);
      await usage.rate(`ingress:${req.clientIp}`, 180, 60000);
      return await next();
    } catch (error) { apiError(res, error); }
    finally { if (admitted) activeRequests--; }
  };
}
