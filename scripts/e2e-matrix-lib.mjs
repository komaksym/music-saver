// Pure policy for the E2E scenario matrix. This module owns the data shape
// checks, the listen-plan budgets, the Like delta verdict, and the
// wall-clipped sounded-time credit that the extension's SoundedTimeSampler
// applies. It performs no I/O and spawns no browser, so tests/ can exercise
// every rule without auth. scripts/e2e-matrix.sh calls the CLI at the bottom.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const TEST_SETTINGS = Object.freeze({ thresholdRatio: 0.01, minSoundedMs: 0 });
export const PRODUCTION_SETTINGS = Object.freeze({ thresholdRatio: 0.9, minSoundedMs: 60000 });

// Extension polling is 1000 ms; one extra tick covers a delayed progress
// update on the tick that follows the last credited sample.
const POLL_SLACK_MS = 2000;

export const PLANS = Object.freeze(["full", "partial", "seek-pause", "ad-break"]);
export const PLAN_FIELDS = Object.freeze({
  full: Object.freeze(["settleMs", "timeoutMs"]),
  partial: Object.freeze(["playMs", "settleMs", "timeoutMs"]),
  "seek-pause": Object.freeze(["playMs", "pauseMs", "seekToMs", "resumeMs", "settleMs", "timeoutMs"]),
  "ad-break": Object.freeze(["playMs", "adWindowMs", "settleMs", "timeoutMs"]),
});
export const REQUIRED_KEYS = Object.freeze([
  "track",
  "trackId",
  "uri",
  "openUrl",
  "durationMsHint",
  "startLiked",
  "listenPlan",
  "planArgs",
  "expectedDelta",
  "cleanup",
]);

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TRACK_ID = /^[A-Za-z0-9]{22}$/;

// full plans need eligibility reached quickly, so they run under the
// test-only threshold. Every plan that asserts no save runs the shipped
// 90% / 60 s rule, which is what those scenarios are meant to prove.
export function settingsForPlan(listenPlan) {
  return listenPlan === "full" ? TEST_SETTINGS : PRODUCTION_SETTINGS;
}

export function isLikeState(value) {
  return value === "liked" || value === "unliked";
}

export function assertDelta(likeBefore, likeAfter, expectedDelta) {
  if (!isLikeState(likeBefore) || !isLikeState(likeAfter)) {
    return {
      pass: false,
      observedDelta: "unknown",
      detail: "Like state unreadable; failing closed",
    };
  }
  if (expectedDelta !== "save" && expectedDelta !== "none") {
    return { pass: false, observedDelta: "unknown", detail: "invalid expectedDelta" };
  }
  // A liked seed that flips to unliked is never "no delta"; it is damage.
  if (likeBefore === "liked" && likeAfter === "unliked") {
    return {
      pass: false,
      observedDelta: "removal",
      detail: "Like was removed during the scenario",
    };
  }
  const observedDelta = likeBefore === "unliked" && likeAfter === "liked" ? "save" : "none";
  return {
    pass: observedDelta === expectedDelta,
    observedDelta,
    detail:
      observedDelta === expectedDelta
        ? "observed delta matches expected delta"
        : `expected ${expectedDelta}, observed ${observedDelta}`,
  };
}

export function planBudget(record) {
  const settings = settingsForPlan(record.listenPlan);
  const args = record.planArgs;
  const durationMs = record.durationMsHint;
  const thresholdMs = Math.max(durationMs * settings.thresholdRatio, settings.minSoundedMs);
  const budget = {
    plan: record.listenPlan,
    durationMs,
    settings,
    thresholdMs,
    playMs: args.playMs ?? 0,
    pauseMs: args.pauseMs ?? 0,
    seekToMs: args.seekToMs ?? 0,
    resumeMs: args.resumeMs ?? 0,
    adWindowMs: args.adWindowMs ?? 0,
    settleMs: args.settleMs ?? 0,
    timeoutMs: args.timeoutMs ?? 0,
    targetMs: thresholdMs,
    maxCreditedMs: 0,
  };
  switch (record.listenPlan) {
    case "full":
      budget.maxCreditedMs = thresholdMs;
      break;
    case "partial":
      budget.maxCreditedMs = budget.playMs + POLL_SLACK_MS;
      break;
    case "seek-pause":
      // A forward seek credits at most one poll tick of wall time, never the
      // jumped distance, so only real play windows count toward the budget.
      budget.maxCreditedMs = budget.playMs + budget.resumeMs + POLL_SLACK_MS;
      break;
    case "ad-break":
      budget.maxCreditedMs = budget.playMs + budget.adWindowMs + POLL_SLACK_MS;
      break;
    default:
      break;
  }
  return budget;
}

function checkRecord(record, index, errors) {
  const firstError = errors.length;
  const where = `record ${index}${record && typeof record.track === "string" ? ` (${record.track})` : ""}`;
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    errors.push(`${where}: must be an object`);
    return;
  }
  const keys = Object.keys(record);
  for (const key of REQUIRED_KEYS) {
    if (!(key in record)) errors.push(`${where}: missing ${key}`);
  }
  for (const key of keys) {
    if (!REQUIRED_KEYS.includes(key)) errors.push(`${where}: unknown key ${key}`);
  }
  if (typeof record.track !== "string" || !SLUG.test(record.track) || record.track.length > 80) {
    errors.push(`${where}: track must be a short lowercase slug`);
  }
  if (typeof record.trackId !== "string" || !TRACK_ID.test(record.trackId)) {
    errors.push(`${where}: trackId must be a real 22-character Spotify id, not a placeholder`);
    return;
  }
  if (record.uri !== `spotify:track:${record.trackId}`) {
    errors.push(`${where}: uri must be spotify:track:${record.trackId}`);
  }
  if (record.openUrl !== `https://open.spotify.com/track/${record.trackId}`) {
    errors.push(`${where}: openUrl must be https://open.spotify.com/track/${record.trackId}`);
  }
  if (!Number.isInteger(record.durationMsHint) || record.durationMsHint <= 0) {
    errors.push(`${where}: durationMsHint must be a positive integer`);
    return;
  }
  if (typeof record.startLiked !== "boolean") errors.push(`${where}: startLiked must be boolean`);
  if (!PLANS.includes(record.listenPlan)) {
    errors.push(`${where}: listenPlan must be one of ${PLANS.join(", ")}`);
    return;
  }
  if (!record.planArgs || typeof record.planArgs !== "object" || Array.isArray(record.planArgs)) {
    errors.push(`${where}: planArgs must be an object`);
    return;
  }
  for (const field of PLAN_FIELDS[record.listenPlan]) {
    const value = record.planArgs[field];
    if (!Number.isFinite(value) || value <= 0) {
      errors.push(`${where}: planArgs.${field} must be a positive number`);
    }
  }
  for (const [field, value] of Object.entries(record.planArgs)) {
    if (!PLAN_FIELDS[record.listenPlan].includes(field)) {
      errors.push(`${where}: planArgs.${field} is not used by ${record.listenPlan}`);
    }
    if (!Number.isFinite(value) || value <= 0) {
      errors.push(`${where}: planArgs.${field} must be a positive number`);
    }
  }
  if (record.listenPlan === "seek-pause") {
    const seekTo = record.planArgs.seekToMs;
    if (Number.isFinite(seekTo) && seekTo >= record.durationMsHint) {
      errors.push(`${where}: planArgs.seekToMs must stay inside the track`);
    }
  }
  if (record.expectedDelta !== "save" && record.expectedDelta !== "none") {
    errors.push(`${where}: expectedDelta must be save or none`);
  }
  if (record.cleanup !== "none" && record.cleanup !== "unlike") {
    errors.push(`${where}: cleanup must be none or unlike`);
  }
  if (record.expectedDelta === "save" && record.startLiked) {
    errors.push(`${where}: a liked start cannot produce a save delta`);
  }
  if (record.listenPlan === "full" && record.expectedDelta === "none" && !record.startLiked) {
    errors.push(`${where}: a full listen from an unliked start can only produce a save`);
  }
  if (record.expectedDelta === "save" && record.cleanup !== "unlike") {
    errors.push(`${where}: a save scenario must clean up with unlike`);
  }
  if (record.expectedDelta === "none" && record.cleanup !== "none") {
    errors.push(`${where}: a none scenario has nothing to clean up`);
  }
  if (errors.length > firstError) return;

  const budget = planBudget(record);
  if (record.expectedDelta === "save") {
    if (budget.maxCreditedMs > record.durationMsHint) {
      errors.push(`${where}: threshold exceeds the track duration`);
    }
    if (budget.timeoutMs < budget.thresholdMs) {
      errors.push(`${where}: timeoutMs must outlast the threshold`);
    }
  } else if (record.listenPlan !== "full" && budget.maxCreditedMs >= budget.thresholdMs) {
    errors.push(
      `${where}: plan budget ${Math.round(budget.maxCreditedMs)}ms can reach the ` +
        `${Math.round(budget.thresholdMs)}ms threshold; expected none would be unsafe`,
    );
  }
}

export function validateMatrix(records) {
  const errors = [];
  if (!Array.isArray(records) || records.length === 0) {
    return { ok: false, errors: ["matrix must be a non-empty array"] };
  }
  const seen = new Set();
  records.forEach((record, index) => {
    checkRecord(record, index, errors);
    if (record && typeof record.track === "string") {
      if (seen.has(record.track)) errors.push(`duplicate track slug: ${record.track}`);
      seen.add(record.track);
    }
  });
  return { ok: errors.length === 0, errors };
}

export function readMatrix(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function scenarioByTrack(records, track) {
  return records.find((record) => record.track === track) || null;
}

// Port of extension/lib/player-dom.js SoundedTimeSampler.observe. The
// extension decides eligibility with this rule, so the harness measures the
// same sounded time instead of trusting raw position deltas.
export class SoundedCredit {
  constructor() {
    this.reset();
  }

  reset() {
    this.prev = null;
    this.playingWallMs = 0;
    this.creditedMs = 0;
  }

  observe(sample) {
    if (!sample || !sample.trackId) {
      this.prev = null;
      return 0;
    }
    const prev = this.prev;
    this.prev = sample;
    if (!prev || !prev.trackId || prev.trackId !== sample.trackId) {
      this.playingWallMs = 0;
      this.creditedMs = 0;
      return 0;
    }
    if (!prev.playing || !sample.playing) return 0;
    const wall = sample.wallMs - prev.wallMs;
    if (!(wall > 0)) return 0;
    this.playingWallMs += wall;
    const progress = sample.positionMs - prev.positionMs;
    if (!(progress > 0)) return 0;
    const budget = Math.max(0, this.playingWallMs - this.creditedMs);
    const seek = progress > budget + wall;
    const delta = seek ? wall : Math.min(progress, budget);
    if (!(delta > 0)) return 0;
    this.creditedMs += delta;
    return delta;
  }
}

function usage() {
  console.error(
    "usage: e2e-matrix-lib.mjs validate <matrix> | field <matrix> <track> <key> | " +
      "budget <matrix> <track> | assert <before> <after> <expected> | credit <samples.jsonl>",
  );
  return 2;
}

function main(argv) {
  const [command, ...args] = argv;
  try {
    if (command === "validate") {
      const records = readMatrix(args[0]);
      const result = validateMatrix(records);
      if (!result.ok) {
        for (const error of result.errors) console.error(`bad record: ${error}`);
        return 2;
      }
      console.log(`matrix: ${records.length} scenarios valid`);
      return 0;
    }
    if (command === "field") {
      const records = readMatrix(args[0]);
      const record = scenarioByTrack(records, args[1]);
      if (!record) throw new Error(`unknown track ${args[1]}`);
      const value = record[args[2]];
      if (value === undefined) throw new Error(`unknown field ${args[2]}`);
      console.log(typeof value === "object" ? JSON.stringify(value) : String(value));
      return 0;
    }
    if (command === "budget") {
      const records = readMatrix(args[0]);
      const record = scenarioByTrack(records, args[1]);
      if (!record) throw new Error(`unknown track ${args[1]}`);
      const budget = planBudget(record);
      console.log(
        [
          `RATIO=${budget.settings.thresholdRatio}`,
          `FLOOR_MS=${budget.settings.minSoundedMs}`,
          `THRESHOLD_MS=${budget.thresholdMs}`,
          `PLAY_MS=${budget.playMs}`,
          `PAUSE_MS=${budget.pauseMs}`,
          `SEEK_TO_MS=${budget.seekToMs}`,
          `RESUME_MS=${budget.resumeMs}`,
          `AD_WINDOW_MS=${budget.adWindowMs}`,
          `SETTLE_MS=${budget.settleMs}`,
          `TIMEOUT_MS=${budget.timeoutMs}`,
          `MAX_CREDITED_MS=${budget.maxCreditedMs}`,
        ].join("\n"),
      );
      return 0;
    }
    if (command === "assert") {
      const verdict = assertDelta(args[0], args[1], args[2]);
      console.log(`pass=${verdict.pass}`);
      console.log(`observed=${verdict.observedDelta}`);
      console.log(`detail=${verdict.detail}`);
      return verdict.pass ? 0 : 1;
    }
    if (command === "credit") {
      const meter = new SoundedCredit();
      let played = 0;
      let maxDelta = 0;
      let samples = 0;
      for (const line of readFileSync(args[0], "utf8").split("\n")) {
        if (!line.trim()) continue;
        const sample = JSON.parse(line);
        samples += 1;
        const delta = meter.observe(sample);
        played += delta;
        if (delta > maxDelta) maxDelta = delta;
      }
      console.log(`credited=${Math.round(played)}`);
      console.log(`max_delta=${Math.round(maxDelta)}`);
      console.log(`samples=${samples}`);
      return 0;
    }
    return usage();
  } catch (error) {
    console.error(`e2e-matrix-lib: ${error.message}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)));
}
