import test from 'node:test';
import assert from 'node:assert/strict';
import { measure, compare, checks } from '../src/fitment.js';

const base = { wheelDiameter: 18, wheelWidth: 8, offset: 45, spacer: null, tireWidth: 235, aspect: 45, roomFender: null, roomStrut: null };
const big = { ...base, wheelDiameter: 19, wheelWidth: 9.5, offset: 35, tireWidth: 245, aspect: 35 };

test('measures a wheel and tire by hand-checked values', () => {
  assert.deepEqual(measure(base), { wheelWidthMm: 203.2, effectiveOffset: 45, outer: 56.6, inner: 146.6, sidewall: 105.75, overallDiameter: 668.7 });
});

test('lower offset and wider wheel move the outer lip out and the inner lip in', () => {
  const c = compare(big, base);
  assert.equal(c.outerChange, 29.05);
  assert.equal(c.innerChange, 9.05);
});

test('more offset alone moves the wheel inboard by exactly that amount', () => {
  const c = compare({ ...base, offset: 55 }, base);
  assert.equal(c.outerChange, -10);
  assert.equal(c.innerChange, 10);
});

test('a spacer behaves as lost offset', () => {
  assert.deepEqual(compare({ ...base, spacer: 10 }, base), compare({ ...base, offset: 35 }, base));
  assert.equal(compare({ ...base, spacer: 10 }, base).outerChange, 10);
  assert.equal(compare({ ...base, spacer: 10 }, base).innerChange, -10);
});

test('larger overall diameter means true speed is above the indicated 60', () => {
  const c = compare({ ...base, aspect: 50 }, base);
  // 18 x 25.4 + 2 x 117.5 = 692.2; 692.2 / 668.7 x 60 = 62.11
  assert.equal(c.diameterChange, 23.5);
  assert.equal(c.axleHeightChange, 11.75);
  assert.equal(c.diameterChangePercent, 3.51);
  assert.equal(c.actualSpeedAt60, 62.11);
});

test('identical setups report no change and no checks', () => {
  const c = compare(base, base);
  assert.equal(c.outerChange, 0);
  assert.equal(c.actualSpeedAt60, 60);
  assert.deepEqual(checks(base, base), []);
});

const levels = (setup, baseline, word) => checks(setup, baseline).filter((x) => x.text.includes(word)).map((x) => x.level);

test('fender room: over is danger, tight is warn, comfortable is silent', () => {
  const measured = { ...base, roomFender: 20 };
  assert.deepEqual(levels({ ...base, offset: 24 }, measured, 'fender'), ['danger']);
  assert.deepEqual(levels({ ...base, offset: 28 }, measured, 'fender'), ['warn']);
  assert.deepEqual(levels({ ...base, offset: 40 }, measured, 'fender'), []);
});

test('exactly using the measured room is tight, not contact', () => {
  assert.deepEqual(levels({ ...base, offset: 25 }, { ...base, roomFender: 20 }, 'fender'), ['warn']);
});

test('strut room is checked against inward movement only', () => {
  const measured = { ...base, roomStrut: 10 };
  assert.deepEqual(levels({ ...base, offset: 60 }, measured, 'strut'), ['danger']);
  assert.deepEqual(levels({ ...base, offset: 30 }, measured, 'strut'), []);
});

test('unmeasured room asks for a measurement rather than claiming it fits', () => {
  assert.deepEqual(levels({ ...base, offset: 30 }, base, 'Measure your fender'), ['info']);
});

test('flags stretch, spacers and large diameter changes', () => {
  assert.deepEqual(levels({ ...base, tireWidth: 195 }, base, 'stretched'), ['warn']);
  assert.deepEqual(levels({ ...base, spacer: 5 }, base, 'Spacer'), ['warn']);
  assert.deepEqual(levels({ ...base, aspect: 55 }, base, 'rule of thumb'), ['warn']);
});
