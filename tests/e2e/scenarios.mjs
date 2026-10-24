// Browser E2E scenario table. Every record is data: the runner interprets
// `steps` in order and checks the final state against `expected`, so new
// coverage is a row here, never a new branch in the runner.
//
// Record shape:
//   id       unique scenario name, also the screenshot file name
//   liked    initial liked state of the fixture player
//   settings thresholdRatio, minSoundedMs, enabled written before the page opens
//   mode     coverage family label
//   fail     fixture Like-control failure mode: 'none' (default), 'once', 'always'
//   steps    ordered actions: toggle-play, wait, seek, ad, track, recover, undo
//   expected activity-log event kinds in order
//   expect   final observed counters: opens (Like control clicks), saves (transitions to liked)
//   tracks   expected event track IDs in order, when a scenario changes track
//   retry    expected retry-queue length at the end (default 0)

const settings = (thresholdRatio, minSoundedMs, enabled = true) => ({ thresholdRatio, minSoundedMs, enabled });

const listen = (liked, ratioReached, floorReached) => {
  const eligible = ratioReached && floorReached;
  return {
    id: `${liked ? 'liked' : 'unliked'}-ratio-${ratioReached}-floor-${floorReached}`,
    liked,
    settings: settings(ratioReached ? 0.5 : 0.95, floorReached ? 1000 : 20000),
    mode: 'listen',
    steps: [{ act: 'toggle-play' }, { act: 'wait', ms: 8000 }],
    expected: eligible ? [liked ? 'skip' : 'save'] : [],
    expect: { opens: eligible ? 1 : 0, saves: eligible && !liked ? 1 : 0 },
  };
};

export const matrix = [false, true].flatMap(liked => [false, true].flatMap(ratioReached => [false, true].map(floorReached => listen(liked, ratioReached, floorReached))));

const cases = [
  {
    id: 'paused', mode: 'paused', liked: false,
    settings: settings(0.5, 1000),
    steps: [{ act: 'wait', ms: 6000 }, { act: 'toggle-play' }, { act: 'wait', ms: 1500 }],
    expected: [], expect: { opens: 0, saves: 0 },
  },
  {
    id: 'seek', mode: 'seek', liked: false,
    settings: settings(0.5, 1000),
    steps: [
      { act: 'toggle-play' }, { act: 'wait', ms: 1500 }, { act: 'seek', ms: 9500 },
      { act: 'wait', ms: 1500 }, { act: 'toggle-play' }, { act: 'wait', ms: 1500 },
    ],
    expected: [], expect: { opens: 0, saves: 0 },
  },
  {
    id: 'ad-only', mode: 'ad-only', liked: false,
    settings: settings(0.5, 1000),
    steps: [{ act: 'ad', on: true }, { act: 'wait', ms: 7500 }],
    expected: [], expect: { opens: 0, saves: 0 },
  },
  {
    id: 'ad-break', mode: 'ad-break', liked: false,
    settings: settings(0.5, 1000),
    steps: [
      { act: 'toggle-play' }, { act: 'wait', ms: 2500 }, { act: 'ad', on: true },
      { act: 'wait', ms: 6000 }, { act: 'ad', on: false }, { act: 'wait', ms: 1500 },
    ],
    expected: [], expect: { opens: 0, saves: 0 },
  },
  {
    id: 'disabled', mode: 'disabled', liked: false,
    settings: settings(0.5, 1000, false),
    steps: [{ act: 'toggle-play' }, { act: 'wait', ms: 7500 }],
    expected: [], expect: { opens: 0, saves: 0 },
  },
  {
    id: 'undo', mode: 'undo', liked: false,
    settings: settings(0.5, 1000),
    steps: [{ act: 'toggle-play' }, { act: 'wait', ms: 8000 }, { act: 'undo' }, { act: 'wait', ms: 1500 }],
    expected: ['save', 'undo'], expect: { opens: 2, saves: 1 },
  },
  {
    id: 'once', mode: 'once', liked: false,
    settings: settings(0.5, 1000),
    steps: [{ act: 'toggle-play' }, { act: 'wait', ms: 8000 }, { act: 'seek', ms: 0 }, { act: 'wait', ms: 7000 }],
    expected: ['save'], expect: { opens: 1, saves: 1 },
  },
  {
    id: 'failure', mode: 'failure', liked: false, fail: 'always',
    settings: settings(0.5, 1000),
    steps: [{ act: 'toggle-play' }, { act: 'wait', ms: 8000 }],
    expected: ['fail'], expect: { opens: 1, saves: 0 }, retry: 1,
  },
  {
    // A failed save enters the retry queue; once the Like control works the
    // scheduled retry saves the same track without another eligibility pass.
    id: 'retry-recovery', mode: 'retry-recovery', liked: false, fail: 'once',
    settings: settings(0.5, 1000),
    steps: [{ act: 'toggle-play' }, { act: 'wait', ms: 8000 }, { act: 'recover' }, { act: 'wait', ms: 30000 }],
    expected: ['fail', 'save'], expect: { opens: 2, saves: 1 },
  },
  {
    // Track B starts with its own sounded-time budget, so the sampler reset is
    // observable: B becomes eligible and is skipped because the control is liked.
    id: 'track-change', mode: 'track-change', liked: false,
    settings: settings(0.5, 1000),
    steps: [{ act: 'toggle-play' }, { act: 'wait', ms: 8000 }, { act: 'track', id: 'trackb' }, { act: 'wait', ms: 8000 }],
    expected: ['save', 'save'], expect: { opens: 2, saves: 2 }, tracks: ['trackchange', 'trackb'],
  },
];

export const scenarios = [...matrix, ...cases];

const KINDS = new Set(['save', 'skip', 'undo', 'fail']);
const ACTS = new Set(['toggle-play', 'wait', 'seek', 'ad', 'track', 'recover', 'undo']);
const FAIL_MODES = new Set(['none', 'once', 'always']);

export function finalLiked(initialLiked, kinds) {
  return kinds.reduce((liked, kind) => (kind === 'save' ? true : kind === 'undo' ? false : liked), initialLiked);
}

export function validateScenarios(table) {
  const ids = new Set();
  for (const scenario of table) {
    if (!scenario || typeof scenario.id !== 'string' || !scenario.id) throw new Error('scenario needs an id');
    if (ids.has(scenario.id)) throw new Error(`duplicate scenario id: ${scenario.id}`);
    ids.add(scenario.id);
    if (typeof scenario.liked !== 'boolean') throw new Error(`${scenario.id}: liked must be boolean`);
    if (typeof scenario.mode !== 'string' || !scenario.mode) throw new Error(`${scenario.id}: mode must be a string`);
    const s = scenario.settings || {};
    if (!(s.thresholdRatio > 0 && s.thresholdRatio <= 1)) throw new Error(`${scenario.id}: thresholdRatio out of range`);
    if (!(s.minSoundedMs >= 0)) throw new Error(`${scenario.id}: minSoundedMs must be non-negative`);
    if (typeof s.enabled !== 'boolean') throw new Error(`${scenario.id}: enabled must be boolean`);
    if (!Array.isArray(scenario.steps) || !scenario.steps.length) throw new Error(`${scenario.id}: steps must be a non-empty array`);
    for (const step of scenario.steps) {
      if (!step || !ACTS.has(step.act)) throw new Error(`${scenario.id}: unknown step ${JSON.stringify(step)}`);
      if (step.act === 'wait' && !(step.ms > 0)) throw new Error(`${scenario.id}: wait needs positive ms`);
      if (step.act === 'seek' && !(step.ms >= 0)) throw new Error(`${scenario.id}: seek needs non-negative ms`);
      if (step.act === 'ad' && typeof step.on !== 'boolean') throw new Error(`${scenario.id}: ad needs on`);
      if (step.act === 'track' && (typeof step.id !== 'string' || !step.id)) throw new Error(`${scenario.id}: track needs id`);
    }
    if (!Array.isArray(scenario.expected)) throw new Error(`${scenario.id}: expected must be an array`);
    for (const kind of scenario.expected) if (!KINDS.has(kind)) throw new Error(`${scenario.id}: unknown event kind ${kind}`);
    const expect = scenario.expect || {};
    if (expect.opens !== undefined && (!Number.isInteger(expect.opens) || expect.opens < 0)) throw new Error(`${scenario.id}: expect.opens must be a counter`);
    if (!Number.isInteger(expect.saves) || expect.saves < 0) throw new Error(`${scenario.id}: expect.saves must be a counter`);
    if (scenario.fail !== undefined && !FAIL_MODES.has(scenario.fail)) throw new Error(`${scenario.id}: unknown fail mode ${scenario.fail}`);
    if (scenario.tracks !== undefined && scenario.tracks.length !== scenario.expected.length) {
      throw new Error(`${scenario.id}: tracks must line up with expected events`);
    }
    if (scenario.retry !== undefined && !Number.isInteger(scenario.retry)) throw new Error(`${scenario.id}: retry must be a counter`);
  }
  return table;
}

export function assertLiveTrack(value) {
  if (!/^[A-Za-z0-9]{22}$/.test(value || '')) throw new Error('SPOTIFY_E2E_TRACK_ID must name a 22-character Spotify song ID');
  return value;
}
