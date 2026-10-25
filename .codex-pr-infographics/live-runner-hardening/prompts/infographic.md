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
- Render exactly these labels, spelled as written. Do not add other sentences.
- Main title: "Prove the song before you touch it"
- Subtitle: "music-saver PR 49"
- Module 1 header: "Identity gate"
- Module 1 items: "track ID" / "title" / "artist" / "album"
- Module 2 header: "Every mutation"
- Module 2 items: "before" / "after" / "restore"
- Module 3 header: "Signal cleanup"
- Module 3 items: "SIGINT 130" / "SIGTERM 143" / "10 second bound"
- Module 4 header: "Cleanup order"
- Module 4 items: "disable extension" / "pause playback" / "stop recording" / "restore state"
- Bottom strip: "142 tests" and "100% changed-line coverage" and "fails closed without an ID"

## Layout Guidelines (bento-grid)
Four technical cards on a 2 by 2 asymmetric grid. Top left is the largest: the identity gate with four small labeled chips and a fingerprint icon. Top right: every mutation, with three arrows looping around a Like icon. Bottom left: signal cleanup, with a signal-wave icon and three metric chips. Bottom right: cleanup order, a compact vertical numbered list with small icons. A full-width footer strip spans the bottom. Thin connectors and measurement marks tie the cards together.

## Style Guidelines (technical-schematic)
Blueprint variant: deep blue (#1E3A5F), fine grid, white strokes, amber accents (#F59E0B), cyan callouts. Consistent stroke weights, stencil all-caps headers, edge rulers, clean vector shapes, no photorealism, no gradients on text.

## Content
Two fixes to an authenticated Spotify end-to-end runner. First, the runner may only mutate the dedicated song: it requires an explicit track ID, title, artist and album, and checks that identity before and after every Liked-state change and restoration. A missing ID fails closed. Second, the runner now handles SIGINT and SIGTERM with a bounded best-effort cleanup: disable the extension, pause playback, stop recording, restore the Like state and settings, then exit 130 or 143. A second signal exits immediately, and a ten-second bound protects a hung browser call. SIGKILL and host failure cannot run cleanup.

Generate the infographic.
