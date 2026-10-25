// Activity log (M6 building block): append-only record of save, skip, undo, and
// failure events with a cap. Pure logic with an injected store; the toast and any
// future views only read through recent().

const KINDS = new Set(["save", "skip", "undo", "fail"]);

export class ActivityLog {
  constructor({ store, cap = 200 } = {}) {
    if (!store) throw new Error("a store with load/save is required");
    this.store = store;
    this.cap = cap;
    this.entries = null;
  }

  async ensureLoaded() {
    if (!this.entries) this.entries = (await this.store.load()) ?? [];
  }

  // A second context can clear or replace the durable log. Adopt that value so
  // the next append cannot republish entries the other writer removed.
  adopt(stored) {
    if (Array.isArray(stored)) this.entries = stored.slice();
  }

  static validate(event) {
    if (!event || typeof event !== "object") throw new Error("event must be an object");
    if (typeof event.ts !== "number" || !Number.isFinite(event.ts) || event.ts < 0) throw new Error("event needs a non-negative numeric ts");
    if (!KINDS.has(event.kind)) throw new Error("event kind must be save, skip, undo, or fail");
    if (typeof event.trackId !== "string" || event.trackId === "") throw new Error("event needs a non-empty trackId");
  }

  async append(event) {
    ActivityLog.validate(event);
    await this.ensureLoaded();
    this.entries.push({ ts: event.ts, kind: event.kind, trackId: event.trackId, detail: event.detail ?? "" });
    if (this.entries.length > this.cap) this.entries.splice(0, this.entries.length - this.cap);
    await this.store.save(this.entries);
  }

  async recent(limit, kind) {
    await this.ensureLoaded();
    const list = kind ? this.entries.filter((e) => e.kind === kind) : this.entries;
    return list.slice(-limit).reverse();
  }
}
