# 0003 DOM-first saves: no Premium on the owning account

Date: 2026-10-21
Status: accepted

## Context

Q11 answered: the Spotify account has no Premium. Development Mode apps stop working
without a Premium-owning account, so ADR-0001 (Web API) and ADR-0002 (PKCE login)
cannot ship as v1. The account plays fine through the Spotify web player, where liking
needs no app, no OAuth, and no token handling.

## Decision

V1 detects the playing track and reads plus writes Like state through the web player
itself from a content script, reusing the existing Brave login. The tested generic-endpoint
client in `src/spotify.js` stays parked for a post-Premium future; it is not v1.

## Alternatives

Ship API anyway: fails at runtime without Premium owner. Rejected by fact, not taste.
Wait for Premium: stalls the whole goal on a subscription decision. The DOM path delivers
the saver now and shares the eligibility engine, toast, log, settings, and retry shapes.

## Consequences

M1 becomes a DOM-mapping spike against the live logged-in player, which needs the
user present session. Player markup changes are the main fragility; the activity log
makes misfires visible and Undo reverses them.
