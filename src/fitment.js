// Wheel and tire geometry. Shared by the server and the browser.
// Offset convention: lower offset moves the whole wheel outboard. A spacer acts as lost offset.

const MM_PER_INCH = 25.4;
const ROUND = 100;
const TIGHT_MARGIN_MM = 5;
const DIAMETER_WARN_PERCENT = 3;

const round = (n) => Math.round(n * ROUND) / ROUND;

export function measure(setup) {
  const widthMm = setup.wheelWidth * MM_PER_INCH;
  const effectiveOffset = setup.offset - (setup.spacer ?? 0);
  const sidewall = setup.tireWidth * (setup.aspect / 100);
  return {
    wheelWidthMm: round(widthMm),
    effectiveOffset: round(effectiveOffset),
    outer: round(widthMm / 2 - effectiveOffset),
    inner: round(widthMm / 2 + effectiveOffset),
    sidewall: round(sidewall),
    overallDiameter: round(setup.wheelDiameter * MM_PER_INCH + 2 * sidewall),
  };
}

export function compare(setup, baseline) {
  const now = measure(setup);
  const base = measure(baseline);
  const ratio = now.overallDiameter / base.overallDiameter;
  return {
    outerChange: round(now.outer - base.outer),
    innerChange: round(now.inner - base.inner),
    diameterChange: round(now.overallDiameter - base.overallDiameter),
    diameterChangePercent: round((ratio - 1) * 100),
    axleHeightChange: round((now.overallDiameter - base.overallDiameter) / 2),
    actualSpeedAt60: round(60 * ratio),
  };
}

export function checks(setup, baseline) {
  const now = measure(setup);
  const change = compare(setup, baseline);
  const found = [];
  const add = (level, text) => found.push({ level, text });

  roomCheck(add, 'fender', 'outward', change.outerChange, baseline.roomFender);
  roomCheck(add, 'strut', 'inward', change.innerChange, baseline.roomStrut);

  if (Math.abs(change.diameterChangePercent) >= DIAMETER_WARN_PERCENT) {
    add('warn', `Overall diameter changes ${Math.abs(change.diameterChangePercent)}%. A common rule of thumb is to stay under ${DIAMETER_WARN_PERCENT}%. Check for rubbing and expect the speedometer to read differently.`);
  }
  if (setup.tireWidth < now.wheelWidthMm) {
    add('warn', `The ${setup.tireWidth} mm tire is narrower than the ${now.wheelWidthMm} mm wheel, so it would be stretched. Check the tire maker's approved rim widths.`);
  }
  if ((setup.spacer ?? 0) > 0) {
    add('warn', 'Spacer in use. Confirm it is hub-centric, the studs have enough thread engagement, and it is torqued to spec.');
  }
  return found;
}

function roomCheck(add, part, direction, change, room) {
  if (room == null) {
    if (change > 0) add('info', `Moves ${change} mm ${direction}. Measure your ${part} room on the baseline to check this.`);
    return;
  }
  if (change > room) {
    add('danger', `Moves ${change} mm ${direction}, but you measured only ${room} mm of ${part} room. Expect contact.`);
  } else if (change > 0 && room - change < TIGHT_MARGIN_MM) {
    add('warn', `Leaves only ${round(room - change)} mm of ${part} room, with no allowance for tire bulge or suspension travel.`);
  }
}
