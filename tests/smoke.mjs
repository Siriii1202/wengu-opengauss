import assert from 'node:assert/strict';
import { createRecord, complete, shift, today } from '../lib/review.mjs';

const base = process.env.PUBLIC_URL || 'http://localhost:8788';
assert.ok(process.env.APP_PASSWORD, 'Set APP_PASSWORD');
const health = await fetch(new URL('/health', base));
assert.deepEqual(await health.json(), { ok: true, database: 'openGauss' });
const login = await fetch(new URL('/login', base), {
  method: 'POST',
  redirect: 'manual',
  headers: { Origin: new URL(base).origin },
  body: new URLSearchParams({ password: process.env.APP_PASSWORD }),
});
assert.equal(login.status, 303);
const cookie = login.headers.get('set-cookie').split(';')[0];
const headers = { Cookie: cookie, Origin: new URL(base).origin };
const url = new URL('/api/state', base);

async function get() {
  const response = await fetch(url, { headers });
  assert.equal(response.status, 200);
  return response.json();
}
async function put(payload, status = 200) {
  const response = await fetch(url, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  assert.equal(response.status, status, JSON.stringify(data));
  return data;
}

const initial = await get();
assert.ok(initial.state.subjects.length, 'Add at least one subject first');
const record = createRecord({
  title: '验收：事务与复习任务',
  subject: initial.state.subjects[0],
  date: shiftBackOneDay(),
  cycle: ['1d', '7d'],
  note: '',
});
function shiftBackOneDay() {
  const date = new Date(today() + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

try {
  const created = structuredClone(initial);
  created.state.records.unshift(record);
  await put(created);
  await put(created, 409);
  const current = await get();
  const saved = current.state.records.find(item => item.id === record.id);
  assert.equal(saved.tasks.length, 2);
  assert.equal(saved.tasks[0].date, shift(record.date, '1d'));
  assert.equal(saved.note, '');
  saved.title = '验收：已修改的知识点';
  complete(saved, today(), 'forgot');
  await put(current);
  const loaded = await get();
  const reviewed = loaded.state.records.find(item => item.id === record.id);
  assert.equal(reviewed.title, saved.title);
  assert.equal(reviewed.tasks.filter(task => task.done).length, 1);
  assert.equal(reviewed.history[0].effect, 'forgot');
  assert.equal(reviewed.history[0].before[0].done, false);
} finally {
  const current = await get();
  if (current.state.records.some(item => item.id === record.id)) {
    current.state.records = current.state.records.filter(item => item.id !== record.id);
    await put(current);
    assert.ok(!(await get()).state.records.some(item => item.id === record.id));
  }
}
console.log('通过：openGauss 健康检查、登录、学习记录新增和编辑、复习任务和历史回读、冲突检测、删除');

