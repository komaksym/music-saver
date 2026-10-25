Create a professional infographic following these specifications:

## Image Specifications
- Type: Infographic
- Layout: bento-grid
- Style: technical-schematic
- Aspect Ratio: 16:9
- Language: English

## Core Principles
- Follow the layout structure precisely: four modules of unequal size in a clean grid with generous gutters.
- Apply the style consistently: deep blue blueprint background with a faint grid, white line work, amber highlights, cyan callouts.
- Keep information concise. One idea per module.

## Text Requirements
- All text in English, clean technical sans-serif, large and readable.
- Render exactly these labels, spelled as written. Do not add other sentences, command lines, or decorative code.
- Main title: "One session, real exit codes, honest smoke"
- Subtitle: "music-saver PR 50"
- Module 1 header: "One session"
- Module 1 items: "resolve once" / "reuse on every call" / "close the same one"
- Module 2 header: "Assert exits"
- Module 2 cards contain no command text. Left card: a green check and "pass exits 0". Right card: a red cross and "fail exits 1".
- Module 3 header: "Smoke check"
- Module 3 item: "wait for Example Domain"
- Module 4 header: "Retired command"
- Module 4 item: "cookies-restore"
- Bottom strip: "136 tests" and "matrix validate kept" and "canonical runner unchanged"

## Layout Guidelines (bento-grid)
Four technical cards on an asymmetric 2 by 2 grid. Top left, largest: one session, with three browser-window chips and a single session badge threaded by one line. Top right: assert exits, two plain terminal cards with only the green check or red cross and the exit label. Bottom left: smoke check, a small browser frame showing a page heading. Bottom right: retired command, a greyed archive box with the command name and a strikethrough. Thin connectors and measurement marks tie the cards together. A full-width footer strip spans the bottom.

## Style Guidelines (technical-schematic)
Blueprint variant: deep blue (#1E3A5F), fine grid, white strokes, amber accents (#F59E0B), cyan callouts. Consistent stroke weights, stencil all-caps headers, edge rulers, clean vector shapes, no photorealism, no gradients on text.

## Content
Cleanup of a repository's manual browser test harness. Before: every browser helper call resolved a new session id in a subshell, so cleanup closed nothing, the matrix assert command printed a failure but exited 0, and the smoke check waited for text that example.com does not show. After: the session is resolved once in the current shell and reused for every call and for cleanup, assert exits 1 when the comparison fails and 0 when it passes, the smoke check waits for the real page heading, and the unused cookies-restore subcommand is retired. The canonical runner and the matrix validate command stay unchanged.

Generate the infographic.
