# Analytics layout challenge

These are three isolated analytics prototypes. They do not replace `analytics.html` and do not modify production CSS, JavaScript, APIs, or databases.

## Review paths

- [Competitive Intelligence](./analytics-a.html)
- [Tactical Command Center](./analytics-b.html)
- [Radical Simplification](./analytics-c.html)

Serve the repository root with the existing static/server setup, then open the three paths above. By default, the prototypes request the same-origin `/api/analytics?limit=10` endpoint. If a standalone static server does not proxy the API, the optional `?api=https://nonamepickup.servehalflife.com` override can be appended for review only.

The prototypes intentionally show a clear unavailable state when the API cannot be reached. They do not fabricate preview statistics.

## What changed structurally

### A — Competitive Intelligence

A research workspace: metric rail, ranked table, row filtering, and a persistent comparison tray. It is the most efficient structure for experienced players who already know the statistic they want.

### B — Tactical Command Center

A three-zone instrument: signal rail, focal leader/ladder, and evidence rail. Selecting a metric reframes the center and its surrounding context. Deep record families are behind an explicit disclosure rather than competing with the focal read.

### C — Radical Simplification

A question-first archive: choose what you are trying to understand, choose a metric lens, then receive one focused answer. Full category access remains available through the record-family drawer and methodology is disclosed beside the result.

## Comparison against the original

Scores are directional design-review judgments from the implemented structure and source checks, not a predetermined winner.

| Surface | Hierarchy | Discoverability | Experienced-user efficiency | Accessibility/readability | Responsive intent | Complexity |
|---|---:|---:|---:|---:|---:|---:|
| Original 2080 | 2/5 | 3/5 | 3/5 | 2/5 | 3/5 | 2/5 |
| A / Intelligence | 4/5 | 4/5 | 5/5 | 4/5 | 4/5 | 3/5 |
| B / Command | 5/5 | 3/5 | 4/5 | 4/5 | 4/5 | 2/5 |
| C / Focus | 5/5 | 4/5 | 3/5 | 5/5 | 5/5 | 4/5 |

Tradeoffs to validate visually:

- A may become too research-tool-like if the comparison tray and metric rail dominate the page.
- B has the clearest competitive identity, but the focal metaphor could make secondary categories harder to discover.
- C is the clearest entry point, but veteran users may find the extra question/lens step slower.

No winner is assigned before visual review. The strongest eventual direction may also be a deliberate combination: A’s ranking efficiency, B’s context framing, and C’s progressive disclosure.

## Validation performed

- `node --check` passed for all prototype JavaScript files.
- Local HTML/CSS/JS references passed a static existence check.
- Production analytics files remained unchanged: `analytics.html`, `assets/css/analytics.css`, and `assets/js/analytics.js`.
- Impeccable detector was run once on each prototype after the final edits. Remaining findings are limited to the shared Inter font advisory, one B gradient contrast advisory, and one C padding heuristic that should be checked in the browser.
- No repository tests were run, per `AGENTS.md`.

## Browser review note

The browser companion could not reach its local server in this environment, so final judgment should be based on opening these prototype paths in the user’s browser at desktop and mobile widths.
