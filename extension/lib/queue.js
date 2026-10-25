// Retry queue (M4 building block): persistent FIFO of failed save/remove actions with
// exponential backoff, a cap, and manual retry. Pure logic with an injected store
// (chrome.storage.local adapter lands with the extension shell); time is passed in
// so tests never touch timers.

const KINDS = new Set(["save", "remove"]);

export class RetryQueue {
  constructor({ store, baseMs = 1000, capMs = 5 * 60 * 1000 } = {}) {
    if (!store) throw new Error("a store with load/save is required");
    this.store = store;
    this.baseMs = baseMs;
    this.capMs = capMs;
    this.items = null; // loaded lazily: constructors stay sync
    this.seq = 0;
  }

  async ensureLoaded() {
    if (!this.items) {
      this.items = (await this.store.load()) ?? [];
      for (const item of this.items) this.seq = Math.max(this.seq, (item.seq ?? 0) + 1);
    }
  }

  async persist() {
    await this.store.save(this.items);
  }

  // A second context can clear or replace the durable queue. Adopt that value so
  // the next write cannot republish items the other writer removed.
  adopt(stored) {
    if (!Array.isArray(stored)) return;
    this.items = stored.slice();
    for (const item of this.items) this.seq = Math.max(this.seq, (item.seq ?? 0) + 1);
  }

  static validate(item) {
    if (!item || typeof item.id !== "string" || item.id === "") throw new Error("item needs a non-empty string id");
    if (typeof item.uri !== "string" || !item.uri.startsWith("spotify:")) throw new Error("item needs a spotify: uri");
    if (!KINDS.has(item.kind)) throw new Error("item kind must be save or remove");
  }

  async enqueue(item) {
    RetryQueue.validate(item);
    await this.ensureLoaded();
    if (this.items.some((i) => i.id === item.id)) return false; // keep original entry
    this.items.push({ id: item.id, uri: item.uri, kind: item.kind, attempts: 0, nextDueMs: 0, seq: this.seq++ });
    await this.persist();
    return true;
  }

  async due(nowMs) {
    await this.ensureLoaded();
    return this.items.filter((i) => i.nextDueMs <= nowMs).sort((a, b) => a.seq - b.seq);
  }

  async all() {
    await this.ensureLoaded();
    return [...this.items].sort((a, b) => a.seq - b.seq);
  }

  async markFailed(id, nowMs) {
    await this.ensureLoaded();
    const item = this.items.find((i) => i.id === id);
    if (!item) return false;
    item.attempts += 1;
    item.nextDueMs = nowMs + Math.min(this.baseMs * 2 ** (item.attempts - 1), this.capMs);
    await this.persist();
    return true;
  }

  async markSucceeded(id) {
    await this.ensureLoaded();
    const before = this.items.length;
    this.items = this.items.filter((i) => i.id !== id);
    if (this.items.length !== before) await this.persist();
    return this.items.length !== before;
  }

  async retryNow(id, nowMs) {
    await this.ensureLoaded();
    const item = this.items.find((i) => i.id === id);
    if (!item) return false;
    item.attempts = 0;
    item.nextDueMs = nowMs;
    await this.persist();
    return true;
  }
}

