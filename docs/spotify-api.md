# Spotify Web API inventory (verified 2026-10-21 against live developer docs)

Base: . A new personal app runs in Development Mode.

## Endpoints for music-saver

- Save:  with Spotify URIs (). Replaces deprecated .
- Remove (Undo path):  with Spotify URIs. Replaces deprecated .
- Already-saved check: the per-type  is replaced by one generic check endpoint. Exact path is confirmed against live docs at build time in M1.
- Now-playing detection (only if polling the API): .

## Scopes

- : save and remove.
- : already-saved checks.
- : now-playing polling only. Not needed if detection watches the player.

## Development Mode limits

- App owner must hold active Spotify Premium or the app stops working.
- Up to 25 client IDs per developer, max 5 users per app. Fine for a personal saver.

## Sources

-  (deprecation notice)
-  (generic endpoints, limits, Premium rule)
-  (scope list)
