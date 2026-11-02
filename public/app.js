import { measure, compare, checks } from '/fitment.js';

const CATEGORIES = ['engine', 'intake', 'exhaust', 'tuning', 'drivetrain', 'suspension', 'brakes', 'wheels', 'exterior', 'interior', 'electrical', 'other'];
const STATUS = { planned: 'Planned', installed: 'Installed', removed: 'Removed' };
const EVIDENCE = { unverified: 'Unverified', community: 'Community report', manufacturer: 'Manufacturer spec', confirmed: 'Confirmed on my car' };
const LEVEL = { danger: 'Conflict', warn: 'Check', info: 'Measure' };
const SVG = 'http://www.w3.org/2000/svg';

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
let editing = null;
let modFilter = 'all';
let toastTimer;

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG, tag);
  setAttrs(el, attrs);
  el.append(...children);
  return el;
}
function setAttrs(el, attrs) {
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'value') el.value = value ?? '';
    else if (key === 'checked' || key === 'disabled') el[key] = value;
    else if (value !== null && value !== undefined && value !== false) el.setAttribute(key, value);
  }
}

class ApiError extends Error {
  constructor(message, fields) {
    super(message);
    this.fields = fields;
  }
}
async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Could not reach the app. Check that the server is still running.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? 'That did not work. Try again.', data.fields);
  return data;
}

function toast(message, bad = false) {
  toastEl.textContent = message;
  toastEl.className = bad ? 'bad' : '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.textContent = ''; }, bad ? 7000 : 3000);
}

function field(def, values, errors) {
  const id = `f-${def.name}`;
  const error = errors?.[def.name];
  const describe = [def.hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || null;
  const common = { id, name: def.name, 'aria-invalid': error ? 'true' : null, 'aria-describedby': describe, required: def.required ? 'required' : null };
  let control;
  if (def.options) {
    control = h('select', common, Object.entries(def.options).map(([value, label]) => h('option', { value }, label)));
    control.value = values[def.name] ?? def.default ?? Object.keys(def.options)[0];
  } else if (def.type === 'textarea') {
    control = h('textarea', { ...common, value: values[def.name] });
  } else {
    control = h('input', {
      ...common,
      type: def.type === 'number' ? 'text' : def.type ?? 'text',
      inputmode: def.type === 'number' ? def.inputmode ?? 'decimal' : null,
      autocomplete: 'off',
      placeholder: def.placeholder,
      value: values[def.name],
    });
  }
  return h('div', { class: `field${def.wide ? ' wide' : ''}` },
    h('label', { for: id }, def.label),
    control,
    def.hint && h('span', { class: 'hint', id: `${id}-hint` }, def.hint),
    error && h('span', { class: 'error', id: `${id}-error` }, error));
}

function editorForm({ title, defs, values, submitLabel, onSave, onCancel, extras, onInput, errors, message }) {
  const form = h('form', { class: 'editor', novalidate: 'novalidate' });
  const read = () => Object.fromEntries(new FormData(form).entries());
  const rerender = (newErrors, newMessage) => {
    const next = editorForm({ title, defs, values: { ...values, ...read(), isBaseline: form.elements.isBaseline?.checked ?? values.isBaseline }, submitLabel, onSave, onCancel, extras, onInput, errors: newErrors, message: newMessage });
    form.replaceWith(next);
    const bad = next.querySelector('[aria-invalid="true"]');
    (bad ?? next.querySelector('.form-error'))?.focus?.();
  };
  const preview = onInput ? h('div', { class: 'preview', 'aria-live': 'polite' }) : null;
  form.append(
    h('h2', {}, title),
    h('div', { class: 'fields' },
      defs.map((d) => (d.group ? h('div', { class: 'form-group-title' }, d.group) : field(d, values, errors))),
      extras?.(values),
      preview),
    message && h('p', { class: 'form-error', tabindex: '-1' }, message),
    h('div', { class: 'form-actions' },
      h('button', { class: 'primary', type: 'submit' }, submitLabel),
      onCancel && h('button', { type: 'button', onclick: onCancel }, 'Cancel')));
  if (onInput) {
    const update = () => {
      preview.replaceChildren(...onInput(read()));
    };
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    update();
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    const data = read();
    if (form.elements.isBaseline) data.isBaseline = form.elements.isBaseline.checked;
    try {
      await onSave(data);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      rerender(err.fields, err.message);
    }
  });
  return form;
}

function confirmDelete(label, action) {
  const button = h('button', { type: 'button', class: 'danger' }, 'Delete');
  let armed = false;
  let timer;
  button.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      button.textContent = `Yes, delete ${label}`;
      timer = setTimeout(() => { armed = false; button.textContent = 'Delete'; }, 5000);
      return;
    }
    clearTimeout(timer);
    button.disabled = true;
    try {
      await action();
    } catch (err) {
      button.disabled = false;
      toast(err.message, true);
    }
  });
  return button;
}

const VEHICLE_FIELDS = [
  { name: 'year', label: 'Year', type: 'number', inputmode: 'numeric', required: true },
  { name: 'make', label: 'Make', required: true },
  { name: 'model', label: 'Model', required: true },
  { name: 'trim', label: 'Trim or body' },
  { name: 'engine', label: 'Engine' },
  { name: 'transmission', label: 'Transmission' },
  { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
];
const MOD_FIELDS = [
  { name: 'name', label: 'Part or mod', required: true },
  { name: 'category', label: 'Category', options: Object.fromEntries(CATEGORIES.map((c) => [c, c[0].toUpperCase() + c.slice(1)])), default: 'other' },
  { name: 'status', label: 'Status', options: STATUS },
  { name: 'evidence', label: 'Fitment proof', options: EVIDENCE, hint: 'How you know it fits this exact car.' },
  { name: 'brand', label: 'Brand' },
  { name: 'partNumber', label: 'Part number' },
  { name: 'installDate', label: 'Install date', type: 'date' },
  { name: 'mileage', label: 'Mileage at install', type: 'number', inputmode: 'numeric' },
  { name: 'cost', label: 'Cost ($)', type: 'number' },
  { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
];
const SETUP_FIELDS = [
  { name: 'name', label: 'Name', required: true, placeholder: 'Winter wheels' },
  { name: 'axle', label: 'Axle', options: { front: 'Front', rear: 'Rear' } },
  { group: 'Wheel' },
  { name: 'wheelDiameter', label: 'Diameter (in)', type: 'number', required: true },
  { name: 'wheelWidth', label: 'Width (in)', type: 'number', required: true },
  { name: 'offset', label: 'Offset (mm)', type: 'number', inputmode: 'text', required: true, hint: 'Negative is allowed.' },
  { name: 'spacer', label: 'Spacer (mm)', type: 'number' },
  { group: 'Tire' },
  { name: 'tireWidth', label: 'Width (mm)', type: 'number', inputmode: 'numeric', required: true },
  { name: 'aspect', label: 'Aspect ratio (%)', type: 'number', inputmode: 'numeric', required: true },
  { group: 'Measured room (only used if this is the baseline)' },
  { name: 'roomFender', label: 'Lip to fender (mm)', type: 'number', hint: 'Room to move outward.' },
  { name: 'roomStrut', label: 'Barrel to strut (mm)', type: 'number', hint: 'Room to move inward.' },
  { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
];

const vehicleName = (v) => `${v.year} ${v.make} ${v.model}`;
const signed = (mm) => `${Math.abs(mm)} mm`;
const direction = (mm, more, less) => (mm === 0 ? 'No change' : `${signed(mm)} ${mm > 0 ? more : less}`);

async function homeView() {
  const vehicles = await api('GET', '/api/vehicles');
  if (editing?.kind !== 'vehicle' && vehicles.length === 0) editing = { kind: 'vehicle' };
  const form = editing?.kind === 'vehicle' ? vehicleForm(null, vehicles.length > 0) : null;
  return [
    h('div', { class: 'page-head' },
      h('h1', {}, 'Your cars'),
      !form && h('button', { class: 'primary', type: 'button', onclick: () => { editing = { kind: 'vehicle' }; render(); } }, 'Add a car')),
    vehicles.length === 0 && h('p', { class: 'sub', id: 'intro' }, 'Start with the exact car, since year, engine and body can all change what fits.'),
    form,
    vehicles.length > 0 && h('ul', { class: 'list' }, vehicles.map((v) => h('li', {},
      h('a', { class: 'vehicle-link', href: `#/vehicle/${v.id}/mods` }, vehicleName(v)),
      h('span', { class: 'meta' }, [v.trim, v.engine, v.transmission].filter(Boolean).join(' · '))))),
  ];
}

function vehicleForm(vehicle, canCancel = true) {
  const cancel = () => { editing = null; render(); };
  return editorForm({
    title: vehicle ? 'Edit car' : 'Add a car',
    defs: VEHICLE_FIELDS,
    values: vehicle ?? {},
    submitLabel: vehicle ? 'Save car' : 'Add car',
    onCancel: canCancel ? cancel : null,
    onSave: async (data) => {
      if (vehicle) {
        await api('PUT', `/api/vehicles/${vehicle.id}`, data);
        editing = null;
        toast('Car saved.');
        render();
      } else {
        const { id } = await api('POST', '/api/vehicles', data);
        editing = null;
        toast('Car added.');
        location.hash = `#/vehicle/${id}/mods`;
      }
    },
  });
}

async function vehicleView(id, tab) {
  const vehicle = await api('GET', `/api/vehicles/${id}`);
  const stock = tab === 'fitment' ? await api('GET', `/api/vehicles/${id}/stock`) : [];
  const head = h('div', { class: 'page-head' },
    h('div', {},
      h('h1', {}, vehicleName(vehicle)),
      h('p', { class: 'sub' }, [vehicle.trim, vehicle.engine, vehicle.transmission].filter(Boolean).join(' · ')),
      vehicle.notes && h('p', { class: 'notes' }, vehicle.notes)),
    editing?.kind !== 'editVehicle' && h('div', { class: 'row' },
      h('button', { type: 'button', onclick: () => { editing = { kind: 'editVehicle' }; render(); } }, 'Edit car'),
      confirmDelete('this car and its log', async () => {
        await api('DELETE', `/api/vehicles/${id}`);
        toast('Car deleted.');
        location.hash = '#/';
      })));
  const tabs = h('nav', { class: 'tabs', 'aria-label': 'Car sections' },
    h('a', { href: `#/vehicle/${id}/mods`, 'aria-current': tab === 'mods' ? 'page' : null }, 'Mods'),
    h('a', { href: `#/vehicle/${id}/fitment`, 'aria-current': tab === 'fitment' ? 'page' : null }, 'Wheels and tires'));
  return [
    head,
    editing?.kind === 'editVehicle' ? vehicleForm(vehicle) : null,
    tabs,
    ...(tab === 'fitment' ? [...fitmentTab(vehicle), stockSection(vehicle, stock)] : modsTab(vehicle)),
  ];
}

function modsTab(vehicle) {
  const adding = editing?.kind === 'mod' && !editing.id;
  const open = (next) => { editing = next; render(); };
  const form = (mod) => editorForm({
    title: mod ? `Edit ${mod.name}` : 'Add a mod',
    defs: MOD_FIELDS,
    values: mod ?? {},
    submitLabel: mod ? 'Save mod' : 'Add mod',
    onCancel: () => open(null),
    onSave: async (data) => {
      if (mod) await api('PUT', `/api/mods/${mod.id}`, data);
      else await api('POST', `/api/vehicles/${vehicle.id}/mods`, data);
      toast('Mod saved.');
      open(null);
    },
  });
  const counts = { all: vehicle.mods.length };
  for (const status of Object.keys(STATUS)) counts[status] = vehicle.mods.filter((m) => m.status === status).length;
  const shown = vehicle.mods.filter((m) => modFilter === 'all' || m.status === modFilter);
  const spent = vehicle.mods.filter((m) => m.status === 'installed' && m.cost != null).reduce((sum, m) => sum + m.cost, 0);

  if (vehicle.mods.length === 0 && !editing) {
    return [h('div', { class: 'empty' },
      h('h2', {}, 'No mods logged yet'),
      h('p', {}, 'Add what is already on the car, then anything you are planning. Mark how you know each part fits, so a forum rumor never looks like a confirmed fit.'),
      h('button', { class: 'primary', type: 'button', onclick: () => open({ kind: 'mod' }) }, 'Add a mod'))];
  }
  return [
    adding ? form(null) : !editing?.id && h('div', { class: 'page-head' },
      h('p', { class: 'sub' }, spent > 0 ? `$${spent.toLocaleString('en-US', { maximumFractionDigits: 2 })} logged on installed parts` : ''),
      h('button', { class: 'primary', type: 'button', onclick: () => open({ kind: 'mod' }) }, 'Add a mod')),
    h('div', { class: 'filters', role: 'group', 'aria-label': 'Filter by status' },
      Object.entries({ all: 'All', ...STATUS }).map(([key, label]) => h('button', {
        type: 'button',
        'aria-pressed': String(modFilter === key),
        onclick: () => { modFilter = key; render(); },
      }, `${label} ${counts[key]}`))),
    shown.length === 0
      ? h('p', { class: 'sub' }, modFilter === 'all' ? 'No mods yet.' : `No ${modFilter} mods.`)
      : h('ul', { class: 'list' }, shown.map((mod) => (editing?.kind === 'mod' && editing.id === mod.id
        ? h('li', {}, form(mod))
        : h('li', {},
          h('div', { class: 'item-head' },
            h('h3', {}, mod.name),
            h('div', { class: 'row' },
              h('button', { type: 'button', onclick: () => open({ kind: 'mod', id: mod.id }) }, 'Edit'),
              confirmDelete('this mod', async () => { await api('DELETE', `/api/mods/${mod.id}`); toast('Mod deleted.'); render(); }))),
          h('div', { class: 'tags' },
            h('span', { class: `tag ${mod.status}` }, STATUS[mod.status]),
            h('span', { class: `tag ${mod.evidence}` }, EVIDENCE[mod.evidence])),
          h('p', { class: 'meta' }, [
            mod.category[0].toUpperCase() + mod.category.slice(1),
            mod.brand,
            mod.partNumber && `Part ${mod.partNumber}`,
            mod.installDate,
            mod.mileage != null && `${mod.mileage.toLocaleString('en-US')} mi`,
            mod.cost != null && `$${mod.cost.toLocaleString('en-US')}`,
          ].filter(Boolean).join(' · ')),
          mod.status === 'planned' && mod.evidence === 'unverified' && h('p', { class: 'meta' }, 'Verify the fit before buying.'),
          mod.notes && h('p', { class: 'notes' }, mod.notes))))),
  ];
}

function diagram(setup, baseline) {
  const now = measure(setup);
  const base = measure(baseline);
  const limits = [
    baseline.roomFender != null ? base.outer + baseline.roomFender : null,
    baseline.roomStrut != null ? -(base.inner + baseline.roomStrut) : null,
  ];
  const extent = Math.max(now.outer, base.outer, now.inner, base.inner, ...limits.map((l) => Math.abs(l ?? 0)), 1) * 1.1;
  const width = 640;
  const x = (mm) => width / 2 + (mm / extent) * (width / 2 - 8);
  const bar = (m, y, cls) => s('rect', { x: x(-m.inner), y, width: x(m.outer) - x(-m.inner), height: 26, class: cls });
  const label = (text, tx, ty, anchor) => { const t = s('text', { x: tx, y: ty, 'text-anchor': anchor }); t.textContent = text; return t; };
  return s('svg', {
    class: 'diagram',
    viewBox: `0 0 ${width} 136`,
    role: 'img',
    'aria-label': `Wheel position. Outer lip ${now.outer} mm from the hub face, baseline ${base.outer} mm. Inner lip ${now.inner} mm, baseline ${base.inner} mm.`,
  },
  label('Toward strut', 8, 16, 'start'),
  label('Toward fender', width - 8, 16, 'end'),
  label('Hub face', width / 2, 16, 'middle'),
  bar(base, 30, 'base'),
  bar(now, 74, 'now'),
  s('line', { x1: x(0), x2: x(0), y1: 22, y2: 108, class: 'hub' }),
  ...limits.filter((l) => l != null).map((l) => s('line', { x1: x(l), x2: x(l), y1: 22, y2: 108, class: 'limit' })),
  label(`Dashed box: baseline. Solid: this setup.${limits.some((l) => l != null) ? ' Yellow: measured limit.' : ''}`, width / 2, 130, 'middle'));
}

function results(setup, baseline) {
  const now = measure(setup);
  const base = !baseline || baseline === setup;
  const change = base ? null : compare(setup, baseline);
  const found = base ? [] : checks(setup, baseline);
  return [
    h('dl', { class: 'stats' },
      base
        ? [stat('Overall diameter', `${now.overallDiameter} mm`), stat('Outer lip from hub', `${now.outer} mm`), stat('Inner lip from hub', `${now.inner} mm`)]
        : [
          stat('Outer lip', direction(change.outerChange, 'further out', 'further in'), `${now.outer} mm from hub`),
          stat('Inner lip', direction(change.innerChange, 'closer to strut', 'further from strut'), `${now.inner} mm from hub`),
          stat('Overall diameter', change.diameterChange === 0 ? 'No change' : `${signed(change.diameterChange)} ${change.diameterChange > 0 ? 'taller' : 'shorter'}`, `${now.overallDiameter} mm (${change.diameterChangePercent}%)`),
          stat('Real speed at 60 shown', `${change.actualSpeedAt60} mph`, 'if the speedometer was accurate on the baseline'),
        ]),
    !base && diagram(setup, baseline),
    found.length > 0 && h('ul', { class: 'checks' }, found.map((c) => h('li', { class: c.level },
      h('span', { class: 'level' }, LEVEL[c.level]),
      h('span', {}, c.text)))),
  ];
}
const stat = (term, value, note) => h('div', {}, h('dt', {}, term), h('dd', {}, value, note && h('small', {}, note)));

const SETUP_NUMBERS = ['wheelDiameter', 'wheelWidth', 'offset', 'spacer', 'tireWidth', 'aspect', 'roomFender', 'roomStrut'];
function parseSetup(raw) {
  const parsed = { ...raw };
  for (const key of SETUP_NUMBERS) {
    parsed[key] = raw[key] == null || !raw[key].trim() ? null : Number(raw[key]);
  }
  const needed = ['wheelDiameter', 'wheelWidth', 'offset', 'tireWidth', 'aspect'];
  const complete = needed.every((k) => Number.isFinite(parsed[k]));
  const inRange = parsed.wheelWidth > 0 && parsed.wheelDiameter > 0 && parsed.tireWidth > 0 && parsed.aspect > 0;
  return complete && inRange && SETUP_NUMBERS.every((k) => parsed[k] === null || Number.isFinite(parsed[k])) ? parsed : null;
}

const LINE_WORDS = { cr: 'CR', v: 'V', hr: 'HR', efcev: 'e:FCEV', si: 'Si', r: 'R' };
const lineName = (line) => line.split('-').map((w) => LINE_WORDS[w] ?? w[0].toUpperCase() + w.slice(1)).join(' ').replace('CR V', 'CR-V').replace('HR V', 'HR-V').replace('Type R', 'Type R');

function stockSection(vehicle, stock) {
  if (stock.length === 0) {
    if (vehicle.make.trim().toLowerCase() !== 'honda') return null;
    return h('section', { class: 'stock' },
      h('h2', {}, 'Factory specs'),
      h('p', { class: 'sub' }, `No Honda spec sheet is on file for a ${vehicleName(vehicle)}, so nothing is shown. Use your door-jamb sticker.`));
  }
  const lines = [...new Set(stock.map((row) => row.line))];
  return h('section', { class: 'stock' },
    h('div', { class: 'item-head' },
      h('h2', {}, 'Factory specs from Honda'),
      h('span', { class: 'tag unverified' }, 'Unverified on your car')),
    h('p', { class: 'sub' }, 'Published for this model year, so find your trim. Check it against your door-jamb sticker before relying on it. Honda does not list offset here, so read that off the back of the wheel.'),
    lines.map((line) => h('div', { class: 'stock-line' },
      h('h3', {}, lineName(line)),
      h('ul', { class: 'list' }, stock.filter((row) => row.line === line).map((row) => h('li', {},
        h('strong', {}, row.trim),
        h('p', {}, `${row.tires} · ${row.wheels}`),
        h('a', { class: 'meta', href: row.source, target: '_blank', rel: 'noopener noreferrer' }, 'Honda source'))))))); 
}

function fitmentTab(vehicle) {
  const baselineFor = (axle) => vehicle.setups.find((x) => x.axle === axle && x.isBaseline);
  const open = (next) => { editing = next; render(); };
  const form = (setup) => {
    return editorForm({
      title: setup ? `Edit ${setup.name}` : 'Add a wheel and tire setup',
      defs: SETUP_FIELDS,
      values: setup ?? { isBaseline: false },
      submitLabel: setup ? 'Save setup' : 'Add setup',
      onCancel: () => open(null),
      extras: (values) => h('label', { class: 'check field wide' },
        h('input', { type: 'checkbox', name: 'isBaseline', checked: values.isBaseline === true || values.isBaseline === 'on' }),
        'Use as the baseline for this axle'),
      onInput: (raw) => {
        const parsed = parseSetup(raw);
        if (!parsed) return [h('p', { class: 'sub' }, 'Fill in the wheel and tire numbers to see the fitment change.')];
        const baseline = baselineFor(parsed.axle);
        const compareTo = baseline && baseline.id !== setup?.id ? baseline : null;
        const against = raw.isBaseline === 'on' ? null : compareTo;
        return [
          h('h3', {}, against ? `Compared with ${against.name}` : 'Measurements'),
          ...results(parsed, against),
        ];
      },
      onSave: async (data) => {
        if (setup) await api('PUT', `/api/setups/${setup.id}`, data);
        else await api('POST', `/api/vehicles/${vehicle.id}/setups`, data);
        toast('Setup saved.');
        open(null);
      },
    });
  };

  if (vehicle.setups.length === 0 && !editing) {
    return [h('div', { class: 'empty' },
      h('h2', {}, 'Start with your baseline'),
      h('p', {}, 'Enter the wheels and tires you know fit today. Add measured room to the fender and strut too, and every other setup is checked against it.'),
      h('button', { class: 'primary', type: 'button', onclick: () => open({ kind: 'setup' }) }, 'Add baseline setup'))];
  }
  const adding = editing?.kind === 'setup' && !editing.id;
  const axleSection = (axle) => {
    const setups = vehicle.setups.filter((x) => x.axle === axle);
    if (setups.length === 0) return null;
    const baseline = baselineFor(axle);
    return h('section', { class: 'axle' },
      h('h2', {}, axle === 'front' ? 'Front' : 'Rear'),
      !baseline && h('p', { class: 'form-error' }, 'No baseline on this axle. Edit a setup and mark it as the baseline to see comparisons.'),
      h('ul', { class: 'list' }, setups.map((setup) => (editing?.kind === 'setup' && editing.id === setup.id
        ? h('li', {}, form(setup))
        : h('li', {},
          h('div', { class: 'item-head' },
            h('div', {},
              h('h3', {}, setup.name),
              h('p', { class: 'spec' }, `${setup.wheelDiameter}x${setup.wheelWidth} ET${setup.offset} · ${setup.tireWidth}/${setup.aspect}R${setup.wheelDiameter}`),
              h('div', { class: 'tags' },
                setup.isBaseline && h('span', { class: 'tag baseline' }, 'Baseline'),
                setup.spacer > 0 && h('span', { class: 'tag' }, `${setup.spacer} mm spacer`))),
            h('div', { class: 'row' },
              h('button', { type: 'button', onclick: () => open({ kind: 'setup', id: setup.id }) }, 'Edit'),
              confirmDelete('this setup', async () => { await api('DELETE', `/api/setups/${setup.id}`); toast('Setup deleted.'); render(); }))),
          results(setup, setup.isBaseline ? null : baseline),
          setup.isBaseline && (setup.roomFender != null || setup.roomStrut != null) && h('p', { class: 'meta' }, [
            setup.roomFender != null && `${setup.roomFender} mm room to fender`,
            setup.roomStrut != null && `${setup.roomStrut} mm room to strut`,
          ].filter(Boolean).join(' · ')),
          setup.notes && h('p', { class: 'notes' }, setup.notes))))));
  };
  return [
    adding ? form(null) : !editing?.id && h('div', { class: 'page-head' },
      h('span', {}),
      h('button', { class: 'primary', type: 'button', onclick: () => open({ kind: 'setup' }) }, 'Add a setup')),
    axleSection('front'),
    axleSection('rear'),
    h('p', { class: 'limits' }, 'These numbers are geometry only. They leave out camber, suspension travel, ride height and tire bulge, so test-fit before relying on them.'),
  ];
}

let renderId = 0;
async function render() {
  const id = ++renderId;
  const match = location.hash.match(/^#\/vehicle\/(\d+)\/(mods|fitment)$/);
  try {
    const content = match ? await vehicleView(Number(match[1]), match[2]) : await homeView();
    if (id !== renderId) return;
    const scroll = window.scrollY;
    app.replaceChildren(...content.flat().filter(Boolean));
    window.scrollTo(0, scroll);
    if (editing) app.querySelector('form.editor input, form.editor select')?.focus({ preventScroll: true });
  } catch (err) {
    if (id !== renderId) return;
    app.replaceChildren(h('div', { class: 'empty' },
      h('h1', {}, 'That did not load'),
      h('p', {}, err.message),
      h('a', { class: 'button', href: '#/' }, 'Back to your cars')));
  }
}

window.addEventListener('hashchange', () => { editing = null; modFilter = 'all'; window.scrollTo(0, 0); render(); });
document.getElementById('import').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      throw new ApiError('That file is not a Mod Fitment Log backup.');
    }
    const { imported } = await api('POST', '/api/import', parsed);
    toast(`Added ${imported} ${imported === 1 ? 'car' : 'cars'} from the backup.`);
    render();
  } catch (err) {
    toast(err.fields?._ ?? (err.fields ? 'The backup has invalid data, so nothing was imported.' : err.message), true);
  }
});
render();
