// Spotify library client (PARKED: needs a working dev-mode app, which requires a
// Premium-owning account per ADR-0003; v1 saves through the player Like control).
// Thin wrapper over the generic library endpoints with injectable fetch and token
// provider, so tests run without credentials. Request shape (uris query param)
// follows the live reference pages; re-prove against the live API before use.

const API_BASE = "https://api.spotify.com/v1";

export class AuthError extends Error {}
export class RateLimitError extends Error {
  constructor(retryAfterMs) {
    super(`rate limited, retry after ${retryAfterMs}ms`);
    this.retryAfterMs = retryAfterMs;
  }
}
export class TransientError extends Error {}

export function createLibraryClient({ fetchFn = fetch, getToken }) {
  async function request(method, path, uri) {
    const token = await getToken();
    if (!token) throw new AuthError("missing access token");
    const url = `${API_BASE}${path}?${new URLSearchParams({ uris: uri })}`;
    let res;
    try {
      res = await fetchFn(url, { method, headers: { Authorization: `Bearer ${token}` } });
    } catch (err) {
      throw new TransientError(`network failure: ${err.message}`);
    }
    if (res.status === 401 || res.status === 403) throw new AuthError(`status ${res.status}`);
    if (res.status === 429) {
      const seconds = Number(res.headers?.get?.("retry-after")) || 5;
      throw new RateLimitError(seconds * 1000);
    }
    if (res.status >= 500) throw new TransientError(`status ${res.status}`);
    if (res.status < 200 || res.status >= 300) throw new Error(`request failed: status ${res.status}`);
    return res;
  }

  return {
    async isSaved(trackUri) {
      const res = await request("GET", "/me/library/contains", trackUri);
      const flags = await res.json();
      return flags[0] === true;
    },
    async save(trackUri) {
      await request("PUT", "/me/library", trackUri);
      return true;
    },
    async remove(trackUri) {
      await request("DELETE", "/me/library", trackUri);
      return true;
    },
  };
}
