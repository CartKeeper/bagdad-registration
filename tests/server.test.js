import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';
import { fakes } from './fakes.js';

let server, base;
before(async () => {
  server = createServer({ services: fakes().services });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((ok) => server.close(ok)));

test('serves the registration page and its assets', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.match(await res.text(), /Bagdad Mini-Conference/);
  assert.match((await fetch(base + '/register.js')).headers.get('content-type'), /javascript/);
  assert.equal((await fetch(base + '/images/one-day-at-a-time.jpg')).headers.get('content-type'), 'image/jpeg');
});

test('volunteer page redirects to its folder and is not indexed or cached', async () => {
  const redirect = await fetch(base + '/admin', { redirect: 'manual' });
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get('location'), '/admin/');
  const page = await fetch(base + '/admin/');
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('x-robots-tag'), 'noindex');
  assert.equal(page.headers.get('cache-control'), 'no-store');
});

test('cannot read files outside public/', async () => {
  for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%2f..%2fetc/passwd', '/%E0%A4%A']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 404, p);
  }
});

test('routes the API', async () => {
  assert.deepEqual(await (await fetch(base + '/api/health')).json(), { ok: true });
  const cfg = await (await fetch(base + '/api/config')).json();
  assert.equal(cfg.prices.registration, 30);
  const bad = await fetch(base + '/api/create-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"people":[]}' });
  assert.equal(bad.status, 400);
  assert.equal((await fetch(base + '/api/admin')).status, 401);
});

test('a full registration works through the server', async () => {
  const body = { people: [{ first: 'Pat', initial: 'M', role: 'AA' }], shirts: [], donation: 0, email: 'p@example.com' };
  const created = await (await fetch(base + '/api/create-order', { method: 'POST', body: JSON.stringify(body) })).json();
  const captured = await (await fetch(base + '/api/capture-order', { method: 'POST', body: JSON.stringify({ orderId: created.id }) })).json();
  assert.equal(captured.status, 'paid');
  assert.equal(captured.paid, '30.00');
});

test('rejects oversized requests', async () => {
  const res = await fetch(base + '/api/create-order', { method: 'POST', body: 'x'.repeat(200 * 1024) }).catch((e) => e);
  // The server answers 413 or drops the connection; either way nothing is processed.
  if (res instanceof Response) assert.equal(res.status, 413);
});

test('only GET/HEAD for pages', async () => {
  assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
});
