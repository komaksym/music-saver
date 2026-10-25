Create a professional infographic following these specifications:

## Image Specifications
- Type: Infographic
- Layout: linear-progression
- Style: technical-schematic
- Aspect Ratio: 16:9
- Language: English

## Core Principles
- Follow the layout structure precisely for information architecture.
- Apply the style consistently: engineering precision, deep blue blueprint background with a faint grid, white line work, amber highlights, cyan callouts.
- Keep information concise, with ample whitespace and a clear left-to-right hierarchy.

## Text Requirements
- All text in English, clean technical sans-serif, large and readable.
- Render exactly these labels, spelled as written. Do not add other sentences.
- Main title: "A save lands on the track that earned it"
- Subtitle: "music-saver PR 51"
- Step 1 label: "Eligible track A"
- Step 2 label: "Check identity"
- Step 3 label: "Like click"
- Step 4 label: "Verify identity"
- Step 5 label: "Save event"
- Branch label: "Track changed at any step"
- Branch outcome: "Fail closed"
- Branch detail: "No click on B. No save event."
- Bottom strip: "145 tests" and "100% changed-line coverage" and "bundle rebuilt"

## Layout Guidelines (linear-progression)
A horizontal five-step pipeline across the upper two thirds. Each step is a numbered technical module connected by a thick arrow. Steps 2 and 4 are highlighted identity gates with a shield or fingerprint icon. Step 3 shows a Like button icon. Step 5 shows a record or log icon. From steps 2 and 4 a downward branch arrow leads to a muted red failure panel labeled "Track changed at any step" with the outcome "Fail closed" and the detail "No click on B. No save event." A footer strip spans the bottom.

## Style Guidelines (technical-schematic)
Blueprint variant: deep blue (#1E3A5F), fine measurement grid, white strokes, amber accents (#F59E0B), cyan callouts. Consistent stroke weights, stencil all-caps headers, edge rulers, clean vector shapes, no photorealism.

## Content
The extension watches a Spotify track until it becomes eligible, then performs a Like transaction. The old code captured the track, awaited a menu-backed check and save, and could click the Like control after the user skipped to another track. The fix re-reads the current track before every mutating click and after every await. If the track changes, the transaction fails closed with an event detail of track-changed: no Like click lands on the new track and no save event is emitted. The bundle is rebuilt from source. Tests cover the switch during check, during save, during the settle window, undo, and a failed read.

Generate the infographic.
