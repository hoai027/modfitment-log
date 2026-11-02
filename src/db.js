import { DatabaseSync } from 'node:sqlite';

export const CATEGORIES = ['engine', 'intake', 'exhaust', 'tuning', 'drivetrain', 'suspension', 'brakes', 'wheels', 'exterior', 'interior', 'electrical', 'other'];
export const STATUSES = ['planned', 'installed', 'removed'];
export const EVIDENCE = ['unverified', 'community', 'manufacturer', 'confirmed'];
export const AXLES = ['front', 'rear'];

export class ValidationError extends Error {
  constructor(fields) {
    super('Check the highlighted fields.');
    this.fields = fields;
  }
}

const text = (max, required = false) => (v) => {
  const s = v == null ? '' : String(v).trim();
  if (required && !s) throw 'Required.';
  if (s.length > max) throw `Keep this under ${max} characters.`;
  return s;
};
const number = (min, max, { required = true, integer = false } = {}) => (v) => {
  if (v == null || (typeof v === 'string' && !v.trim())) {
    if (required) throw 'Required.';
    return null;
  }
  const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < min || n > max) throw `Enter a number from ${min} to ${max}.`;
  if (integer && !Number.isInteger(n)) throw 'Enter a whole number.';
  return n;
};
const oneOf = (list, fallback) => (v) => {
  const value = v == null || v === '' ? fallback : v;
  if (!list.includes(value)) throw `Choose one of: ${list.join(', ')}.`;
  return value;
};
const date = (v) => {
  if (v == null || v === '') return '';
  const s = String(v);
  const d = new Date(`${s}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw 'Enter a real date.';
  return s;
};

const SCHEMAS = {
  vehicle: {
    year: number(1886, 2100, { integer: true }),
    make: text(60, true),
    model: text(60, true),
    trim: text(60),
    engine: text(60),
    transmission: text(60),
    notes: text(5000),
  },
  mod: {
    name: text(120, true),
    category: oneOf(CATEGORIES, 'other'),
    brand: text(80),
    partNumber: text(80),
    status: oneOf(STATUSES, 'planned'),
    evidence: oneOf(EVIDENCE, 'unverified'),
    installDate: date,
    mileage: number(0, 3000000, { required: false, integer: true }),
    cost: number(0, 10000000, { required: false }),
    notes: text(5000),
  },
  setup: {
    name: text(80, true),
    axle: oneOf(AXLES, 'front'),
    wheelDiameter: number(10, 30),
    wheelWidth: number(3, 16),
    offset: number(-100, 100),
    spacer: number(0, 75, { required: false }),
    tireWidth: number(100, 455, { integer: true }),
    aspect: number(20, 90, { integer: true }),
    roomFender: number(0, 200, { required: false }),
    roomStrut: number(0, 200, { required: false }),
    notes: text(5000),
  },
};

export function validate(kind, input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError({ _: 'Expected an object.' });
  const clean = {};
  const fields = {};
  for (const [key, check] of Object.entries(SCHEMAS[kind])) {
    try {
      clean[key] = check(input[key]);
    } catch (message) {
      if (typeof message !== 'string') throw message;
      fields[key] = message;
    }
  }
  if (Object.keys(fields).length) throw new ValidationError(fields);
  return clean;
}

const VEHICLE_COLS = { year: 'year', make: 'make', model: 'model', trim: 'trim', engine: 'engine', transmission: 'transmission', notes: 'notes' };
const MOD_COLS = { name: 'name', category: 'category', brand: 'brand', partNumber: 'part_number', status: 'status', evidence: 'evidence', installDate: 'install_date', mileage: 'mileage', cost: 'cost', notes: 'notes' };
const SETUP_COLS = { name: 'name', axle: 'axle', wheelDiameter: 'wheel_diameter', wheelWidth: 'wheel_width', offset: 'wheel_offset', spacer: 'spacer', tireWidth: 'tire_width', aspect: 'aspect', roomFender: 'room_fender', roomStrut: 'room_strut', notes: 'notes' };

const fromRow = (cols, row) => {
  const out = { id: row.id };
  for (const [key, col] of Object.entries(cols)) out[key] = row[col];
  return out;
};

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY, year INTEGER NOT NULL, make TEXT NOT NULL, model TEXT NOT NULL,
      trim TEXT NOT NULL, engine TEXT NOT NULL, transmission TEXT NOT NULL, notes TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mods (
      id INTEGER PRIMARY KEY, vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      name TEXT NOT NULL, category TEXT NOT NULL, brand TEXT NOT NULL, part_number TEXT NOT NULL,
      status TEXT NOT NULL, evidence TEXT NOT NULL, install_date TEXT NOT NULL,
      mileage INTEGER, cost REAL, notes TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS setups (
      id INTEGER PRIMARY KEY, vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      name TEXT NOT NULL, axle TEXT NOT NULL, wheel_diameter REAL NOT NULL, wheel_width REAL NOT NULL,
      wheel_offset REAL NOT NULL, spacer REAL, tire_width INTEGER NOT NULL, aspect INTEGER NOT NULL,
      room_fender REAL, room_strut REAL, notes TEXT NOT NULL, is_baseline INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_baseline ON setups(vehicle_id, axle) WHERE is_baseline = 1;
  `);

  const tx = (fn) => {
    db.exec('BEGIN');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };

  const insert = (table, cols, data, extra = {}) => {
    const names = [...Object.values(cols), ...Object.keys(extra)];
    const values = [...Object.keys(cols).map((k) => data[k]), ...Object.values(extra)];
    const sql = `INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`;
    return Number(db.prepare(sql).run(...values).lastInsertRowid);
  };
  const update = (table, cols, id, data) => {
    const sql = `UPDATE ${table} SET ${Object.values(cols).map((c) => `${c} = ?`).join(',')} WHERE id = ?`;
    return db.prepare(sql).run(...Object.keys(cols).map((k) => data[k]), id).changes > 0;
  };
  const remove = (table, id) => db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id).changes > 0;

  const setupFromRow = (row) => ({ ...fromRow(SETUP_COLS, row), isBaseline: row.is_baseline === 1 });
  const hasBaseline = (vehicleId, axle) => db.prepare('SELECT 1 FROM setups WHERE vehicle_id = ? AND axle = ? AND is_baseline = 1').get(vehicleId, axle) !== undefined;
  const clearBaseline = (vehicleId, axle) => db.prepare('UPDATE setups SET is_baseline = 0 WHERE vehicle_id = ? AND axle = ?').run(vehicleId, axle);

  const insertSetup = (vehicleId, data, wantBaseline) => {
    const baseline = wantBaseline || !hasBaseline(vehicleId, data.axle);
    if (baseline) clearBaseline(vehicleId, data.axle);
    return insert('setups', SETUP_COLS, data, { vehicle_id: vehicleId, is_baseline: baseline ? 1 : 0 });
  };

  const api = {
    close: () => db.close(),

    listVehicles() {
      return db.prepare('SELECT * FROM vehicles ORDER BY year DESC, make, model, id').all().map((r) => fromRow(VEHICLE_COLS, r));
    },
    getVehicle(id) {
      const row = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
      if (!row) return null;
      return {
        ...fromRow(VEHICLE_COLS, row),
        mods: db.prepare('SELECT * FROM mods WHERE vehicle_id = ? ORDER BY id DESC').all(id).map((r) => fromRow(MOD_COLS, r)),
        setups: db.prepare('SELECT * FROM setups WHERE vehicle_id = ? ORDER BY axle, is_baseline DESC, id').all(id).map(setupFromRow),
      };
    },
    addVehicle: (input) => insert('vehicles', VEHICLE_COLS, validate('vehicle', input)),
    updateVehicle: (id, input) => update('vehicles', VEHICLE_COLS, id, validate('vehicle', input)),
    deleteVehicle: (id) => remove('vehicles', id),

    addMod(vehicleId, input) {
      const data = validate('mod', input);
      if (!api.getVehicle(vehicleId)) return null;
      return insert('mods', MOD_COLS, data, { vehicle_id: vehicleId });
    },
    updateMod: (id, input) => update('mods', MOD_COLS, id, validate('mod', input)),
    deleteMod: (id) => remove('mods', id),

    addSetup(vehicleId, input) {
      const data = validate('setup', input);
      if (!api.getVehicle(vehicleId)) return null;
      return tx(() => insertSetup(vehicleId, data, input.isBaseline === true));
    },
    updateSetup(id, input) {
      const data = validate('setup', input);
      const row = db.prepare('SELECT vehicle_id, is_baseline FROM setups WHERE id = ?').get(id);
      if (!row) return false;
      return tx(() => {
        const wanted = input.isBaseline === undefined ? row.is_baseline === 1 : input.isBaseline === true;
        db.prepare('UPDATE setups SET is_baseline = 0 WHERE id = ?').run(id);
        update('setups', SETUP_COLS, id, data);
        if (wanted) {
          clearBaseline(row.vehicle_id, data.axle);
          db.prepare('UPDATE setups SET is_baseline = 1 WHERE id = ?').run(id);
        }
        return true;
      });
    },
    deleteSetup: (id) => remove('setups', id),

    exportAll() {
      const strip = ({ id, ...rest }) => rest;
      return {
        app: 'modfitment-log',
        version: 1,
        vehicles: api.listVehicles().map(({ id }) => {
          const v = api.getVehicle(id);
          return { ...strip(v), mods: v.mods.map(strip), setups: v.setups.map(strip) };
        }),
      };
    },
    importAll(payload) {
      if (payload?.app !== 'modfitment-log' || payload.version !== 1 || !Array.isArray(payload.vehicles)) {
        throw new ValidationError({ _: 'This is not a Mod Fitment Log backup file.' });
      }
      return tx(() => {
        for (const v of payload.vehicles) {
          if ((v?.mods !== undefined && !Array.isArray(v.mods)) || (v?.setups !== undefined && !Array.isArray(v.setups))) {
            throw new ValidationError({ _: 'This backup file is damaged.' });
          }
          const id = insert('vehicles', VEHICLE_COLS, validate('vehicle', v));
          for (const m of v.mods ?? []) insert('mods', MOD_COLS, validate('mod', m), { vehicle_id: id });
          for (const s of v.setups ?? []) insertSetup(id, validate('setup', s), s.isBaseline === true);
        }
        return payload.vehicles.length;
      });
    },
  };
  return api;
}
