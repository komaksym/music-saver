export const matrix = [false, true].flatMap(liked => [false, true].flatMap(ratioReached => [false, true].map(floorReached => ({
  id: `${liked ? 'liked' : 'unliked'}-ratio-${ratioReached}-floor-${floorReached}`,
  liked,
  settings: { thresholdRatio: ratioReached ? 0.5 : 0.95, minSoundedMs: floorReached ? 1000 : 20000, enabled: true },
  mode: 'listen',
  expected: ratioReached && floorReached ? (liked ? 'skip' : 'save') : null,
}))));

export const scenarios = [...matrix, ...[
  ['paused', null], ['seek', null], ['ad-only', null], ['ad-break', null],
  ['disabled', null], ['undo', 'undo'], ['once', 'save'], ['failure', 'fail'],
].map(([mode, expected]) => ({
  id: mode, mode, liked: false, expected,
  settings: { thresholdRatio: 0.5, minSoundedMs: 1000, enabled: mode !== 'disabled' },
}))];

export function assertLiveTrack(value) {
  if (!/^[A-Za-z0-9]{22}$/.test(value || '')) throw new Error('SPOTIFY_E2E_TRACK_ID must name a 22-character Spotify song ID');
  return value;
}
