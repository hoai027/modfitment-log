import test from 'node:test';
import assert from 'node:assert/strict';
import { findStock, STOCK } from '../src/stock.js';

const skip = STOCK.length === 0 && 'no spec file present';
const accord2015 = { year: 2015, make: 'Honda', model: 'Accord' };

test('finds factory specs for every 2015 Accord body and lists all trims', { skip }, () => {
  const rows = findStock(accord2015);
  const v6 = rows.find((r) => r.line === 'accord-sedan' && r.trim === 'EX-L V-6');
  assert.equal(v6.tires, '215/55 R17 94V');
  assert.equal(v6.wheels, '17" Alloy');
  assert.match(v6.source, /^https:\/\/hondanews\.com\//);
  assert.ok(rows.some((r) => r.line === 'accord-coupe'));
});

test('make and model matching ignores case and spacing', { skip }, () => {
  assert.equal(findStock({ year: 2015, make: ' honda ', model: 'ACCORD' }).length, findStock(accord2015).length);
  assert.ok(findStock({ year: 2018, make: 'Honda', model: 'CRV' }).length > 0);
  assert.ok(findStock({ year: 2018, make: 'Honda', model: 'CR-V' }).length > 0);
});

test('a more specific model name narrows the list', { skip }, () => {
  const rows = findStock({ year: 2015, make: 'Honda', model: 'Accord Sedan' });
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.line === 'accord-sedan'));
});

test('a civic does not pull in unrelated models', { skip }, () => {
  const rows = findStock({ year: 2019, make: 'Honda', model: 'Civic' });
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.line.startsWith('civic')));
});

test('returns nothing rather than guessing', { skip }, () => {
  assert.deepEqual(findStock({ year: 2015, make: 'Toyota', model: 'Accord' }), []);
  assert.deepEqual(findStock({ year: 2015, make: 'Acura', model: 'TLX' }), []);
  assert.deepEqual(findStock({ year: 1950, make: 'Honda', model: 'Accord' }), []);
  assert.deepEqual(findStock({ year: 2015, make: 'Honda', model: 'Banana' }), []);
  assert.deepEqual(findStock({ year: 2015, make: 'Honda', model: '' }), []);
});

test('the bundled data holds only rows that passed the checks', { skip }, () => {
  assert.ok(STOCK.length > 700);
  for (const row of STOCK) {
    assert.match(row.source, /^https:\/\/hondanews\.com\//);
    assert.ok(row.trim && row.tires && row.line && Number.isInteger(row.year));
    assert.ok(!['.', '..', 'CHASSIS', 'CVT', 'TOURING', '5-speed MT'].includes(row.trim));
  }
  assert.equal(STOCK.some((r) => r.year === 2021 && r.line === 'accord' && r.trim === 'Sport Special Edition'), false);
});
