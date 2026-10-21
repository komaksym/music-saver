# music-saver agent rules

## Browser verification is background-only

Live verification drives the operator's Brave solely through the sitegeist background tab group, muted, and restores the operator's tab when done. No agent ever opens, fronts, focuses, or takes over a visible browser window. Ask before taking window focus. This rule outranks convenience in every dispatch brief.

## Rule table

| Rule | Enforced by |
|---|---|
| Background-only browser verification, restore operator tab | Dispatch briefs quote it; global handoff hooks demand screenshot artifacts |
| Muted playback with two position reads proving state | Live-proof log plus screenshots cited in every handoff |
| Conventional subject plus body on every commit | commit-lint gate (required) |
| Five-section PR body | pr-hygiene gate (required) plus PR template |
