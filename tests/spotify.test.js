import test from "node:test";
import assert from "node:assert/strict";
import { createLibraryClient, AuthError, RateLimitError, TransientError } from "../extension/lib/spotify.js";

const URI = "spotify:track:4iV5W9uYEdYUVa79Axb7Rh";

function mockFetch(handler) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); return handler(url, init); };
  fn.calls = calls;
  return fn;
}
const ok = (status, json) => ({ status, headers: { get: () => null }, json: async () => json });
const withToken = (fetchFn) => createLibraryClient({ fetchFn, getToken: async () => "tok123" });

test("save sends PUT to /me/library with the URI and bearer token", async () => {
  const fetchFn = mockFetch(async () => ok(200, {}));
  assert.equal(await withToken(fetchFn).save(URI), true);
  const { url, init } = fetchFn.calls[0];
  assert.equal(init.method, "PUT");
  assert.match(url, /^https:\/\/api\.spotify\.com\/v1\/me\/library\?/);
  assert.match(url, /uris=spotify(%3A|:)track/);
  assert.equal(init.headers.Authorization, "Bearer tok123");
});

test("check maps the boolean array to a single boolean", async () => {
  const t = mockFetch(async () => ok(200, [true]));
  const f = mockFetch(async () => ok(200, [false]));
  assert.equal(await withToken(t).isSaved(URI), true);
  assert.equal(await withToken(f).isSaved(URI), false);
  assert.equal(t.calls[0].init.method, "GET");
});

test("remove sends DELETE to /me/library", async () => {
  const fetchFn = mockFetch(async () => ok(200, {}));
  assert.equal(await withToken(fetchFn).remove(URI), true);
  assert.equal(fetchFn.calls[0].init.method, "DELETE");
});

test("401 and 403 become AuthError for every operation", async () => {
  for (const status of [401, 403]) {
    const fetchFn = mockFetch(async () => ok(status, {}));
    const c = withToken(fetchFn);
    await assert.rejects(c.save(URI), AuthError);
    await assert.rejects(c.isSaved(URI), AuthError);
    await assert.rejects(c.remove(URI), AuthError);
  }
});

test("429 becomes RateLimitError carrying retry-after seconds", async () => {
  const fetchFn = mockFetch(async () => ({ status: 429, headers: { get: (h) => (h === "retry-after" ? "7" : null) }, json: async () => ({}) }));
  const err = await withToken(fetchFn).save(URI).then(() => null, (e) => e);
  assert.ok(err instanceof RateLimitError);
  assert.equal(err.retryAfterMs, 7000);
});

test("5xx and network failure become TransientError", async () => {
  const bad = mockFetch(async () => ok(503, {}));
  await assert.rejects(withToken(bad).save(URI), TransientError);
  const down = mockFetch(async () => { throw new Error("socket hang up"); });
  await assert.rejects(withToken(down).isSaved(URI), TransientError);
});

test("400 is a permanent error, never transient or auth", async () => {
  const fetchFn = mockFetch(async () => ok(400, {}));
  const err = await withToken(fetchFn).save(URI).then(() => null, (e) => e);
  assert.ok(err instanceof Error);
  assert.ok(!(err instanceof TransientError));
  assert.ok(!(err instanceof AuthError));
});

test("missing token fails fast without any network call", async () => {
  const fetchFn = mockFetch(async () => ok(200, {}));
  const c = createLibraryClient({ fetchFn, getToken: async () => "" });
  await assert.rejects(c.save(URI), AuthError);
  assert.equal(fetchFn.calls.length, 0);
});
