// The whole app in one Node process: serves public/ and the /api routes.
// `node server.js` (PORT defaults to 8080). Used by the Dockerfile for Coolify.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { servicesFromEnv, json } from './lib/http.js';
import { handle as config } from './api/config.mjs';
import { handle as createOrder } from './api/create-order.mjs';
import { handle as captureOrder } from './api/capture-order.mjs';
import { handle as admin } from './api/admin.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MAX_BODY = 100 * 1024;

const ROUTES = {
  '/api/config': config,
  '/api/create-order': createOrder,
  '/api/capture-order': captureOrder,
  '/api/admin': admin,
  '/api/health': () => json(200, { ok: true }),
};

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Request too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function sendResponse(res, response) {
  res.writeHead(response.status, { ...SECURITY_HEADERS, ...Object.fromEntries(response.headers) });
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, SECURITY_HEADERS).end();
    return;
  }
  let file;
  try {
    file = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
  } catch {
    file = ''; // malformed %-encoding
  }
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(404, SECURITY_HEADERS).end('Not found');
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) {
      // /admin → /admin/ so the page's relative links work
      if (!pathname.endsWith('/')) {
        res.writeHead(301, { ...SECURITY_HEADERS, Location: pathname + '/' }).end();
        return;
      }
      file = path.join(file, 'index.html');
    }
    const data = await readFile(file);
    const isAdmin = pathname.startsWith('/admin');
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': isAdmin || file.endsWith('.html') ? 'no-store' : 'public, max-age=300',
      ...(isAdmin ? { 'X-Robots-Tag': 'noindex' } : {}),
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' }).end('Not found');
  }
}

/** @param {object} [opts.services] fake services for tests; otherwise built from environment variables */
export function createServer({ services } = {}) {
  const svc = services ?? servicesFromEnv();
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      const route = ROUTES[url.pathname];
      if (!route) return await serveStatic(req, res, url.pathname);
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      const request = new Request(url, {
        method: req.method,
        headers: Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v]),
        body: hasBody ? await readBody(req) : undefined,
      });
      await sendResponse(res, await route(request, svc));
    } catch (err) {
      if (err.status === 413) return sendResponse(res, json(413, { error: 'Request too large' }));
      console.error(err);
      if (!res.headersSent) await sendResponse(res, json(500, { error: 'Something went wrong.' }));
    }
  });
}

// Run directly: node server.js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let server;
  try {
    server = createServer();
  } catch (err) {
    console.error(`Cannot start: ${err.message}. Set them in Coolify → Environment Variables.`);
    process.exit(1);
  }
  const port = Number(process.env.PORT || 8080);
  server.listen(port, () => console.log(`Bagdad registration listening on :${port} (PayPal ${process.env.PAYPAL_ENV || 'sandbox'})`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
