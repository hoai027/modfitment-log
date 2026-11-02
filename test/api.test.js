import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/server.js';
import { STOCK } from '../src/stock.js';

let db, server, url;
const call = async (method, path, body, headers = {}) => {
  const res = await fetch(url + path, {
    method,
    headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const vehicle = { year: 2015, make: 'Honda', model: 'Accord', trim: 'V6' };
const setup = { name: 'Stock', axle: 'front', wheelDiameter: 18, wheelWidth: 8, offset: 45, tireWidth: 235, aspect: 45 };

before(async () => {
  db = openDb(':memory:');
  server = createApp(db);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  db.close();
});

test('vehicle create, read, update and cascade delete', async () => {
  const { status, body } = await call('POST', '/api/vehicles', vehicle);
  assert.equal(status, 201);
  await call('POST', `/api/vehicles/${body.id}/mods`, { name: 'Intake' });
  assert.equal((await call('PUT', `/api/vehicles/${body.id}`, { ...vehicle, trim: 'Touring' })).status, 200);
  const read = await call('GET', `/api/vehicles/${body.id}`);
  assert.equal(read.body.trim, 'Touring');
  assert.equal(read.body.mods[0].status, 'planned');
  assert.equal(read.body.mods[0].evidence, 'unverified');
  assert.equal((await call('DELETE', `/api/vehicles/${body.id}`)).status, 200);
  assert.equal((await call('GET', `/api/vehicles/${body.id}`)).status, 404);
  assert.equal(db.exportAll().vehicles.some((v) => v.mods.length), false);
});

test('rejects bad input and names the field', async () => {
  const noMake = await call('POST', '/api/vehicles', { ...vehicle, make: ' ' });
  assert.equal(noMake.status, 400);
  assert.ok(noMake.body.fields.make);
  const { body: v } = await call('POST', '/api/vehicles', vehicle);
  const badDate = await call('POST', `/api/vehicles/${v.id}/mods`, { name: 'X', installDate: '2026-02-31' });
  assert.ok(badDate.body.fields.installDate);
  const badStatus = await call('POST', `/api/vehicles/${v.id}/mods`, { name: 'X', status: 'maybe' });
  assert.ok(badStatus.body.fields.status);
  const badOffset = await call('POST', `/api/vehicles/${v.id}/setups`, { ...setup, offset: 'abc' });
  assert.ok(badOffset.body.fields.offset);
  const blankOffset = await call('POST', `/api/vehicles/${v.id}/setups`, { ...setup, offset: '  ' });
  assert.ok(blankOffset.body.fields.offset);
  const listOffset = await call('POST', `/api/vehicles/${v.id}/setups`, { ...setup, offset: [5] });
  assert.ok(listOffset.body.fields.offset);
  const negative = await call('POST', `/api/vehicles/${v.id}/setups`, { ...setup, offset: '-12' });
  assert.equal(negative.status, 201);
  assert.equal((await call('POST', '/api/vehicles/99999/mods', { name: 'X' })).status, 404);
  assert.equal((await call('PUT', '/api/mods/99999', { name: 'X' })).status, 404);
  assert.equal((await call('GET', '/api/vehicles/abc')).status, 404);
});

test('each axle keeps exactly one baseline', async () => {
  const { body: v } = await call('POST', '/api/vehicles', vehicle);
  const first = (await call('POST', `/api/vehicles/${v.id}/setups`, setup)).body.id;
  const second = (await call('POST', `/api/vehicles/${v.id}/setups`, { ...setup, name: 'New' })).body.id;
  const rear = (await call('POST', `/api/vehicles/${v.id}/setups`, { ...setup, name: 'Rear', axle: 'rear' })).body.id;
  const flags = async () => Object.fromEntries((await call('GET', `/api/vehicles/${v.id}`)).body.setups.map((s) => [s.id, s.isBaseline]));
  assert.deepEqual(await flags(), { [first]: true, [second]: false, [rear]: true });
  await call('PUT', `/api/setups/${second}`, { ...setup, name: 'New', isBaseline: true });
  assert.deepEqual(await flags(), { [first]: false, [second]: true, [rear]: true });
  await call('PUT', `/api/setups/${first}`, { ...setup, name: 'Stock', axle: 'rear', isBaseline: true });
  assert.deepEqual(await flags(), { [first]: true, [second]: true, [rear]: false });
});

test('export then import restores data, and bad imports change nothing', async () => {
  const fresh = openDb(':memory:');
  const id = fresh.addVehicle(vehicle);
  fresh.addMod(id, { name: 'Coilovers', status: 'installed', evidence: 'confirmed', cost: 900 });
  fresh.addSetup(id, setup);
  const backup = fresh.exportAll();
  const target = openDb(':memory:');
  assert.equal(target.importAll(JSON.parse(JSON.stringify(backup))), 1);
  assert.deepEqual(target.exportAll(), backup);
  const before = target.exportAll();
  const broken = { ...backup, vehicles: [backup.vehicles[0], { ...vehicle, mods: [{ name: '' }] }] };
  assert.throws(() => target.importAll(broken));
  assert.deepEqual(target.exportAll(), before);
  assert.throws(() => target.importAll({ hello: 1 }));
  assert.throws(() => target.importAll({ ...backup, vehicles: [{ ...vehicle, mods: 5 }] }), /Check the highlighted|damaged/);
  assert.deepEqual(target.exportAll(), before);
  fresh.close();
  target.close();
});

test('blocks other sites, wrong hosts and non-JSON writes', async () => {
  assert.equal((await call('POST', '/api/vehicles', vehicle, { Origin: 'https://evil.example' })).status, 403);
  const form = await fetch(`${url}/api/vehicles`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(form.status, 415);
  const { request } = await import('node:http');
  const status = await new Promise((resolve, reject) => {
    const r = request(url + '/api/vehicles', { headers: { Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); });
    r.on('error', reject);
    r.end();
  });
  assert.equal(status, 403);
});

test('static files cannot escape the allowed list', async () => {
  assert.equal((await fetch(`${url}/`)).status, 200);
  assert.equal((await fetch(`${url}/package.json`)).status, 404);
  assert.equal((await fetch(`${url}/..%2f..%2fpackage.json`)).status, 404);
});

test('password protects everything when set', async () => {
  const locked = createApp(db, { password: 'hunter2' });
  await new Promise((r) => locked.listen(0, '127.0.0.1', r));
  const u = `http://127.0.0.1:${locked.address().port}/api/vehicles`;
  assert.equal((await fetch(u)).status, 401);
  const auth = (p) => ({ headers: { Authorization: `Basic ${Buffer.from(`me:${p}`).toString('base64')}` } });
  assert.equal((await fetch(u, auth('wrong'))).status, 401);
  assert.equal((await fetch(u, auth('hunter2'))).status, 200);
  locked.close();
});

test('stock specs come back for a Honda and stay empty for other makes', { skip: STOCK.length === 0 && 'no spec file present' }, async () => {
  const honda = await call('POST', '/api/vehicles', vehicle);
  const found = await call('GET', `/api/vehicles/${honda.body.id}/stock`);
  assert.equal(found.status, 200);
  assert.ok(found.body.some((r) => r.trim === 'EX-L V-6' && r.tires === '215/55 R17 94V'));
  const other = await call('POST', '/api/vehicles', { ...vehicle, make: 'Toyota' });
  assert.deepEqual((await call('GET', `/api/vehicles/${other.body.id}/stock`)).body, []);
  assert.equal((await call('GET', '/api/vehicles/999999/stock')).status, 404);
  const before = db.getVehicle(honda.body.id);
  assert.deepEqual(before.setups, []);
  assert.deepEqual(before.mods, []);
});
