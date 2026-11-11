import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { validateState } from './lib/review.mjs';
import { initialize, pool, readState, saveState } from './db/store.mjs';

const password = process.env.APP_PASSWORD;
if (!password || password.length < 12) throw Error('APP_PASSWORD 至少需要 12 个字符');
const port = Number(process.env.PORT || 8788);
const origin = new URL(process.env.PUBLIC_URL || 'http://localhost:8788').origin;
const secure = origin.startsWith('https:') ? '; Secure' : '';
const publicDir = fileURLToPath(new URL('./dist/', import.meta.url));
const sessionLifetime = 30 * 86400;
const hash = value => createHash('sha256').update(value).digest('hex');
const passwordHash = Buffer.from(hash(password));
const htmlEntities = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const passwordHint = password.replace(/[&<>]/g, character => htmlEntities[character]);
let failedLogins = 0;
let retryAt = 0;

const loginPage = (failed = false) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>登录温故</title><link rel="icon" href="/favicon.svg">
<style>
body{margin:0;background:#f6f8fc;color:#23344c;font:15px system-ui;display:grid;place-items:center;min-height:100vh}
form{box-sizing:border-box;background:white;padding:32px;border:1px solid #e5eaf2;border-radius:16px;width:min(90vw,380px)}
h1{margin:0;color:#2463ce}p{margin-bottom:24px}input,button{box-sizing:border-box;font:inherit;width:100%;border-radius:8px;padding:12px}
input{margin:8px 0 0;border:1px solid #cdd9eb}button{background:#2463ce;border:0;color:white;cursor:pointer}
.password-hint{margin:8px 0 18px;color:#50617a;font-size:13px;line-height:1.6;overflow-wrap:anywhere}
.password-hint code{white-space:pre-wrap}
</style></head><body><form action="/login" method="post">
<h1>温故</h1><p>滚动复习</p>
${failed ? '<p role="alert">密码不正确，请重试。</p>' : ''}
<label>访问密码<input name="password" type="password" required autocomplete="current-password" aria-describedby="password-hint"></label>
<p id="password-hint" class="password-hint">可用密码 <code>${passwordHint}</code></p>
<button>进入学习空间</button></form></body></html>`;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};
function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function showLogin(res, failed = false) {
  res.writeHead(failed ? 401 : 200, { 'Content-Type': mime['.html'], 'Cache-Control': 'no-store' });
  res.end(loginPage(failed));
}
async function body(req, max) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= max) chunks.push(chunk);
    if (size > max) {
      req.resume();
      throw Object.assign(Error('请求过大'), { status: 413 });
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}
async function login(req, res) {
  if (retryAt > Date.now()) return json(res, { error: '尝试次数过多，请稍后重试' }, 429);
  const provided = new URLSearchParams(await body(req, 2048)).get('password') || '';
  if (!timingSafeEqual(Buffer.from(hash(provided)), passwordHash)) {
    if (++failedLogins >= 10) {
      retryAt = Date.now() + 900_000;
      failedLogins = 0;
    }
    return showLogin(res, true);
  }
  failedLogins = 0;
  const token = randomBytes(32).toString('hex');
  await pool.query('DELETE FROM wengu_session WHERE expires <= $1', [Date.now()]);
  await pool.query('INSERT INTO wengu_session(token,expires) VALUES ($1,$2)', [
    hash(token), Date.now() + sessionLifetime * 1000,
  ]);
  res.writeHead(303, {
    Location: '/',
    'Set-Cookie': `wengu_lab=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionLifetime}${secure}`,
  });
  res.end();
}
async function authorized(req) {
  const token = /(?:^|;\s*)wengu_lab=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  if (!token) return false;
  const result = await pool.query('SELECT token FROM wengu_session WHERE token=$1 AND expires>$2', [hash(token), Date.now()]);
  return result.rowCount === 1;
}
async function serveFile(req, res, pathname) {
  const file = path.resolve(publicDir, '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(publicDir)) return json(res, { error: '页面不存在' }, 404);
  let content;
  try {
    content = await readFile(file);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') return json(res, { error: '页面不存在' }, 404);
    throw error;
  }
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : content);
}
const server = http.createServer(async (req, res) => {
  try {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    const { pathname } = new URL(req.url, origin);
    const safeMethod = req.method === 'GET' || req.method === 'HEAD';
    if (!safeMethod && req.headers.origin !== origin) return json(res, { error: '请求来源不正确' }, 403);

    if (pathname === '/health' && req.method === 'GET') {
      try {
        await pool.query('SELECT revision FROM wengu_workspace WHERE id=1');
        return json(res, { ok: true, database: 'openGauss' });
      } catch {
        return json(res, { ok: false, database: 'openGauss' }, 503);
      }
    }
    if (pathname === '/login' && req.method === 'GET') return showLogin(res);
    if (pathname === '/login' && req.method === 'POST') return await login(req, res);
    if (pathname === '/favicon.svg' && safeMethod) return await serveFile(req, res, pathname);

    if (!await authorized(req)) {
      if (pathname.startsWith('/api/')) return json(res, { error: '请先登录' }, 401);
      res.writeHead(303, { Location: '/login' });
      return res.end();
    }
    if (pathname === '/api/state') {
      if (req.method === 'GET') return json(res, await readState());
      if (req.method === 'PUT') {
        const payload = await body(req, 8_000_000);
        let version, state;
        try {
          ({ version, state } = JSON.parse(payload));
          validateState(state);
          const subjects = new Set(state.subjects);
          if (state.records.some(record => !subjects.has(record.subject) || record.id.length > 128 ||
            record.tasks.some(task => task.id.length > 128) ||
            new Set(record.tasks.map(task => task.id)).size !== record.tasks.length)) {
            throw Error('科目或记录编号无效');
          }
          if (!Number.isInteger(version) || version < 0 || version >= 2147483647) throw Error('版本不正确');
        } catch (error) {
          return json(res, { error: error.message }, 400);
        }
        if (!await saveState(version, state)) return json(res, { error: '数据已有更新，请刷新后重新操作' }, 409);
        return json(res, { version: version + 1 });
      }
      return json(res, { error: '不支持的操作' }, 405);
    }
    if (pathname.startsWith('/api/')) return json(res, { error: '接口不存在' }, 404);
    if (!safeMethod) return json(res, { error: '不支持的操作' }, 405);
    return await serveFile(req, res, pathname);
  } catch (error) {
    if (error.status) return json(res, { error: error.message }, error.status);
    console.error('请求失败:', error.code || error.message);
    json(res, { error: '服务暂时不可用，请稍后重试' }, 503);
  }
});

for (let attempt = 1; ; attempt++) {
  try {
    console.log(await initialize());
    break;
  } catch (error) {
    if (attempt >= 30 || !['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', '57P03'].includes(error.code)) throw error;
    console.log('正在等待 openGauss 启动');
    await delay(2000);
  }
}
server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`温故已启动 ${origin}`));
process.on('SIGTERM', () => server.close(async () => {
  await pool.end();
  process.exit(0);
}));
