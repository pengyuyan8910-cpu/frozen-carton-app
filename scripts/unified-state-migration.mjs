function clone(value) {
  return value == null ? value : structuredClone(value);
}

function comparable(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(comparable);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['_dataSignature', '_baselineReady'].includes(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => [key, comparable(child)]));
}

function same(a, b) {
  return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));
}

export function hasMeaningfulEdits(candidate, initial) {
  return !!candidate && !same(candidate, initial);
}

export function migrateUnifiedState({ initial, draft, published, signature = '' }) {
  const source = hasMeaningfulEdits(draft, initial)
    ? 'draft'
    : hasMeaningfulEdits(published, initial)
      ? 'published'
      : draft
        ? 'draft-fallback'
        : published
          ? 'published-fallback'
          : 'initial';
  const state = clone(source.startsWith('draft') ? draft : source.startsWith('published') ? published : initial);
  if (signature) state._dataSignature = signature;
  return { source, state };
}
