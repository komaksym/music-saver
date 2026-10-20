// Settings model (M5): defaults, validation, and storage for the three locked
// options (threshold, floor, enable-disable). Pure logic with an injected store;
// the options page UI lands with the extension shell and only reads/writes here.

export const DEFAULTS = Object.freeze({
  thresholdRatio: 0.9,
  minSoundedMs: 60_000,
  enabled: true,
});

function thresholdOrDefault(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1 ? v : DEFAULTS.thresholdRatio;
}

function floorOrDefault(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : DEFAULTS.minSoundedMs;
}

export function normalizeSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    thresholdRatio: thresholdOrDefault(source.thresholdRatio),
    minSoundedMs: floorOrDefault(source.minSoundedMs),
    enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULTS.enabled,
  };
}

export async function loadSettings(store) {
  return normalizeSettings(await store.load());
}

export async function saveSettings(store, patch) {
  const next = normalizeSettings({ ...(await store.load()), ...patch });
  await store.save(next);
  return next;
}
