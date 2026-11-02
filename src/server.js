import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { timingSafeEqual, createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openDb, ValidationError } from './db.js';
import { findStock } from './stock.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BODY = 5 * 1024 * 1024;
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const LOOPBACK_NAMES = new Set(['127.0.0.1', '[::1]', 'localhost']);

const STATIC = {
  '/': ['public/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['public/styles.css', 'text/css; charset=utf-8'],
  '/fitment.js': ['src/fitment.js', 'text/javascript; charset=utf-8'],
};
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sha = (s) => createHash('sha256').update(s).digest();

function passwordMatches(header, password) {
  const [scheme, encoded] = (header ?? '').split(' ');
  if (scheme !== 'Basic' || !encoded) return false;
  const decoded = Buffer.from(encoded, 'base64').toString();
  return timingSafeEqual(sha(decoded.slice(decoded.indexOf(':') + 1)), sha(password));
}

async function readJson(req) {
  if (!(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'That is too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new HttpError(400, 'That is not valid JSON.');
  }
}

function route(db, method, parts, body) {
  const [root, kind, rawId, sub] = parts;
  if (root !== 'api') throw new HttpError(404, 'Not found.');
  if (kind === 'export' && method === 'GET' && parts.length === 2) return [200, db.exportAll()];
  if (kind === 'import' && method === 'POST' && parts.length === 2) return [201, { imported: db.importAll(body()) }];

  const id = rawId === undefined ? null : Number(rawId);
  if (rawId !== undefined && !(Number.isInteger(id) && id > 0)) throw new HttpError(404, 'Not found.');
  const found = (ok) => {
    if (!ok) throw new HttpError(404, 'That item no longer exists.');
    return [200, { ok: true }];
  };
  const created = (newId) => {
    if (newId === null) throw new HttpError(404, 'That vehicle no longer exists.');
    return [201, { id: newId }];
  };

  if (kind === 'vehicles') {
    if (id === null && parts.length === 2) {
      if (method === 'GET') return [200, db.listVehicles()];
      if (method === 'POST') return created(db.addVehicle(body()));
    }
    if (id !== null && parts.length === 3) {
      if (method === 'GET') {
        const vehicle = db.getVehicle(id);
        if (!vehicle) throw new HttpError(404, 'That vehicle no longer exists.');
        return [200, vehicle];
      }
      if (method === 'PUT') return found(db.updateVehicle(id, body()));
      if (method === 'DELETE') return found(db.deleteVehicle(id));
    }
    if (id !== null && parts.length === 4 && method === 'GET' && sub === 'stock') {
      const vehicle = db.getVehicle(id);
      if (!vehicle) throw new HttpError(404, 'That vehicle no longer exists.');
      return [200, findStock(vehicle)];
    }
    if (id !== null && parts.length === 4 && method === 'POST') {
      if (sub === 'mods') return created(db.addMod(id, body()));
      if (sub === 'setups') return created(db.addSetup(id, body()));
    }
  }
  if (kind === 'mods' && id !== null && parts.length === 3) {
    if (method === 'PUT') return found(db.updateMod(id, body()));
    if (method === 'DELETE') return found(db.deleteMod(id));
  }
  if (kind === 'setups' && id !== null && parts.length === 3) {
    if (method === 'PUT') return found(db.updateSetup(id, body()));
    if (method === 'DELETE') return found(db.deleteSetup(id));
  }
  throw new HttpError(404, 'Not found.');
}

export function createApp(db, { password = '', loopbackOnly = true } = {}) {
  return createServer(async (req, res) => {
    const send = (status, type, payload, headers = {}) => {
      res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
      res.end(payload);
    };
    const json = (status, value, headers) => send(status, 'application/json; charset=utf-8', JSON.stringify(value), headers);

    try {
      const host = req.headers.host ?? '';
      const hostname = host.replace(/:\d+$/, '');
      if (loopbackOnly && !LOOPBACK_NAMES.has(hostname)) throw new HttpError(403, 'Host not allowed.');
      if (password && !passwordMatches(req.headers.authorization, password)) {
        return json(401, { error: 'Password required.' }, { 'WWW-Authenticate': 'Basic realm="Mod Fitment Log", charset="UTF-8"' });
      }

      const url = new URL(req.url, 'http://localhost');
      const method = req.method;
      if (url.pathname.startsWith('/api/')) {
        if (method !== 'GET') {
          const origin = req.headers.origin;
          if (origin && new URL(origin).host !== host) throw new HttpError(403, 'Cross-site request blocked.');
        }
        const parsed = method === 'POST' || method === 'PUT' ? await readJson(req) : undefined;
        const [status, value] = route(db, method, url.pathname.split('/').filter(Boolean), () => parsed);
        return json(status, value);
      }

      const file = STATIC[url.pathname];
      if (!file || (method !== 'GET' && method !== 'HEAD')) throw new HttpError(404, 'Not found.');
      return send(200, file[1], await readFile(join(ROOT, file[0])));
    } catch (err) {
      if (err instanceof ValidationError) return json(400, { error: err.message, fields: err.fields });
      if (err instanceof HttpError) return json(err.status, { error: err.message });
      if (err instanceof TypeError && err.code === 'ERR_INVALID_URL') return json(400, { error: 'Bad request.' });
      console.error(err);
      return json(500, { error: 'Something went wrong on the server. Your last change may not have saved.' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 3000);
  const password = process.env.MODLOG_PASSWORD ?? '';
  const loopbackOnly = LOOPBACK.has(host);
  if (!loopbackOnly && !password) {
    console.error(`Refusing to listen on ${host} without MODLOG_PASSWORD, because anyone on the network could edit your log.`);
    process.exit(1);
  }
  const path = process.env.MODLOG_DB ?? join(ROOT, 'data', 'modlog.db');
  await mkdir(dirname(path), { recursive: true });
  const db = openDb(path);
  createApp(db, { password, loopbackOnly }).listen(port, host, () => {
    console.log(`Mod Fitment Log is running at http://${host.includes(':') ? `[${host}]` : host}:${port}`);
  });
}
