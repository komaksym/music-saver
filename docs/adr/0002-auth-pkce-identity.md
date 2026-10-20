# 0002 Login with Spotify PKCE through chrome.identity

Date: 2026-10-21
Status: accepted

## Context

Round 2 Q6 asked for the lowest-friction login: the user must never copy tokens by hand.
The extension is a browser client that cannot hold a client secret, and the generic
library endpoints need user authorization. Verified against the live Spotify
Authorization guide: Authorization code with PKCE needs no secret, supports refresh,
and is the documented flow for browser-running apps.

## Decision

Use Authorization code with PKCE via . The extension
ships the Spotify client ID, opens a one-time Spotify login plus consent page, and keeps
tokens in local extension storage with refresh. No manual token handling at any point.

## Alternatives

Manual token copy-paste into settings: zero app setup, but ongoing friction and expired-token
toil on every lapse. Rejected by the Q6 answer. Backend token broker: adds hosting the
project does not need for a personal saver. Client credentials flow: cannot touch user
library data at all.

## Consequences

One-time developer setup (dashboard app, whitelisted redirect) is documented in the repo.
Unpacked-load extension IDs vary, so M1 pins a stable redirect strategy and proves it with
a real login. Premium prerequisite (Q11) still gates M1.
