export function sendJson(res, status, data, headers = {}) {
  if (res.destroyed) return;
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(data));
}

export async function readJson(req, maxBytes = 64 * 1024, timeoutMs = 10000) {
  if (!req.headers['content-type']?.startsWith('application/json')) {
    const error = new Error('请使用 JSON 请求');
    error.status = 415;
    throw error;
  }
  req.setEncoding('utf8');
  let body = '';
  const timer = setTimeout(() => req.destroy(Object.assign(new Error('请求正文读取超时'), { status: 408 })), timeoutMs);
  timer.unref?.();
  try { for await (const chunk of req) {
    body += chunk.toString();
    if (Buffer.byteLength(body) > maxBytes) {
      const error = new Error('请求内容过长');
      error.status = 413;
      throw error;
    }
  } } finally { clearTimeout(timer); }
  try {
    return JSON.parse(body || '{}');
  } catch {
    const error = new Error('请求内容不是有效 JSON');
    error.status = 400;
    throw error;
  }
}

export function requestIp(req) {
  return req.clientIp || req.socket?.remoteAddress || 'unknown';
}

export function apiError(res, error, fallback = '服务暂时不可用') {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error(fallback, error?.message);
  sendJson(res, status, { error: status >= 500 ? fallback : error?.message || fallback }, error?.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {});
}

// 对供应商响应设置实际读取上限，避免无 Content-Length 的大响应耗尽内存。
export async function boundedResponse(response, maxBytes = 20 * 1024 * 1024) {
  if (!(response instanceof Response) || !response.body) return response;
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('供应商响应过大');
      chunks.push(Buffer.from(value));
    }
    return new Response(Buffer.concat(chunks), { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
}
