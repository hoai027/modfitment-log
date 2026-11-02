import { existsSync, readFileSync } from 'node:fs';

// The spec file is optional: without it, the app says it has no specs on file.
const DATA = new URL('./honda-stock.json', import.meta.url);
export const STOCK = existsSync(DATA) ? JSON.parse(readFileSync(DATA)) : [];

const squash = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// True when the typed model is the start of the line's name, on a word boundary:
// "Accord" matches accord-sedan, but "Accord Sedan" doesn't match accord-coupe.
function modelMatches(line, model) {
  const words = line.split('-');
  return words.some((_, i) => squash(words.slice(0, i + 1).join('')) === model);
}

// Every trim for the car's year, so the owner picks theirs. It never guesses a trim.
export function findStock({ year, make, model }) {
  const wanted = squash(model);
  if (squash(make) !== 'honda' || !wanted) return [];
  return STOCK.filter((row) => row.year === year && modelMatches(row.line, wanted));
}
