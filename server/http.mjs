export function sendJson(res, status, data, headers = {}) {
  if (res.destroyed) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(data));
}

export async function readJson(req, maxBytes = 64 * 1024) {
  if (!req.headers['content-type']?.startsWith('application/json')) {
    const error = new Error('请使用 JSON 请求');
    error.status = 415;
    throw error;
  }
  req.setEncoding('utf8');
  let body = '';
  for await (const chunk of req) {
    body += chunk.toString();
    if (Buffer.byteLength(body) > maxBytes) {
      const error = new Error('请求内容过长');
      error.status = 413;
      throw error;
    }
  }
  try {
    return JSON.parse(body || '{}');
  } catch {
    const error = new Error('请求内容不是有效 JSON');
    error.status = 400;
    throw error;
  }
}

export function requestIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

export function apiError(res, error, fallback = '服务暂时不可用') {
  sendJson(res, Number(error?.status) || 500, { error: error instanceof Error ? error.message : fallback });
}
