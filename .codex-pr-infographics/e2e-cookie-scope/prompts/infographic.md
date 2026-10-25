Create a professional infographic following these specifications:

## Image Specifications
- Type: Infographic
- Layout: binary-comparison
- Style: technical-schematic
- Aspect Ratio: 16:9
- Language: English

## Core Principles
- Follow the layout structure precisely for information architecture.
- Apply the style aesthetics consistently: engineering precision, clean geometry, deep blue background with a faint grid, white line work, amber highlights, cyan callouts.
- Keep information concise. Use ample whitespace and a clear visual hierarchy.

## Text Requirements
- All text in English, clean technical sans-serif, large and readable.
- Render exactly these labels, spelled as written. Do not add other sentences.
- Main title: "Cookie import keeps its exact scope"
- Subtitle: "music-saver PR 48"
- Left column header: "BEFORE"
- Left points: "Host cookie widened to the domain" / "Prefixed cookie sent to a fixed host" / "SameSite rewritten from Secure"
- Right column header: "AFTER"
- Right points: "Host-only stays host-only" / "Domain cookie keeps .spotify.com" / "SameSite copied from the snapshot" / "None without Secure fails closed"
- Bottom strip: "Synthetic cookies only" and "10 new tests" and "100% changed-line coverage"

## Layout Guidelines (binary-comparison)
Split the canvas into two equal columns with a strong vertical divider. Left column is a muted red-amber "before" panel with three labeled modules stacked vertically. Right column is a teal-cyan "after" panel with four labeled modules. Each module is a rounded technical card with a thin outline, a small icon, and one short label. A horizontal footer strip runs across the bottom. Arrows between matching modules show the change from left to right. No dense paragraphs.

## Style Guidelines (technical-schematic)
Blueprint variant: deep blue background (#1E3A5F), faint measurement grid, white lines, amber accents (#F59E0B), cyan callouts. Consistent stroke weights, stencil-style all-caps section headers, rulers and dimension ticks at the edges, clean vector shapes. No photorealism, no gradients on text.

## Content
A code review fix for a browser test harness. The left side shows the old cookie import: host-only cookies were widened to the parent domain, every __Host- cookie was sent to a hardcoded accounts host, and the SameSite policy was rewritten from the Secure flag. The right side shows the new import: host-only cookies keep their host, domain cookies keep their leading dot and path, the snapshot's sameSite value is preserved, and SameSite=None without Secure fails closed before the browser starts. The fix is covered by synthetic-cookie tests only.

Generate the infographic.
