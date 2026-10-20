// Eligibility engine (M3): pure sounded-time tracker. No timers, no I/O, no DOM.
// Locked rule (GLOSSARY Eligible listen): eligible once per track ID when sounded time
// reaches max(durationMs * thresholdRatio, minSoundedMs). Pauses and seeks never
// credit because callers feed ONLY actually-sounded deltas through sound().
// A tracker instance covers one listening session; reset() starts a new session.

export class EligibilityTracker {
  constructor({ thresholdRatio = 0.9, minSoundedMs = 60000 } = {}) {
    this.thresholdRatio = thresholdRatio;
    this.minSoundedMs = minSoundedMs;
    this.reset();
  }

  reset() {
    this.currentTrackId = null;
    this.currentDurationMs = 0;
    this.soundedMs = 0;
    this.consumedTrackIds = new Set();
  }

  // Feed actually-sounded audio time for a track. Returns true exactly once per
  // trackId, on the transition to eligible. Invalid input never credits, never throws.
  sound(trackId, durationMs, deltaSoundedMs) {
    if (!trackId || !(durationMs > 0) || !(deltaSoundedMs > 0)) return false;
    if (trackId !== this.currentTrackId) {
      this.currentTrackId = trackId;
      this.currentDurationMs = durationMs;
      this.soundedMs = 0;
    }
    if (this.consumedTrackIds.has(trackId)) return false;
    this.soundedMs += deltaSoundedMs;
    const threshold = Math.max(
      this.currentDurationMs * this.thresholdRatio,
      this.minSoundedMs,
    );
    if (this.soundedMs >= threshold) {
      this.consumedTrackIds.add(trackId);
      return true;
    }
    return false;
  }
}
