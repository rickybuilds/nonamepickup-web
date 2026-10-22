# Career vs Performance — challenge V2

## Review

- [A — Precision Refinement](./career-performance-a.html)
- [B — Structural Rethink](./career-performance-b.html)
- [Original](../analytics.html)

Serve the repository root, then open `/design-experiments/career-performance-a.html` or `/design-experiments/career-performance-b.html`. Both are complete Analytics pages. They request same-origin `/api/analytics?limit=10`; no URL parameter is needed. A static-only server needs to proxy `/api/` to the existing API to show data. Opening these files directly with `file://` will not load the API.

For example, with the existing local web/API setup at port 8080:

`http://localhost:8080/design-experiments/career-performance-a.html`

## What the original gets right

The full-width 2080 layout, NN/TFC header, compact archive KPIs, activity chart, Spotlight, tabs and Record Room stay intact. Its four side-by-side comparisons surface all eight leaders without interaction. Blue identity links, green performance values and Orbitron headings belong to the existing site. These are strengths, not redesign targets.

The targeted critique found three useful opportunities: the 9px metric labels are hard to scan; long names truncate; and `VS` suggests competition between different units and independently selected leaders. The original section also omits the performance qualification and each leader's reported game count. No proportional bars or deltas would be valid across these unlike units.

## Alternatives

**A — Precision Refinement:** Keeps the four paired modules and their 4/2/1 responsive layout. Replaces `VS` with a divider; aligns labels, identities and tabular values; allows names to wrap; uses 11px metric labels and 12px identities. Shows the API's reported game counts and qualification. Numerals use the compact monospace treatment already present in neighboring analytics rows, while section headings retain Orbitron. That improves scanning but sacrifices some of the original numerals' visual character.

**B — Structural Rethink:** Transposes the same eight production-rendered leader nodes into a semantic matrix. Desktop has four category columns crossed by Career volume and Performance rows. Phones recompose into four paired rows under two shared column headings, with no horizontal scrolling. This makes the volume/rate distinction explicit, but adds a header and increases the desktop footprint.

Neither version recalculates a metric. Career kills/damage, MVP totals, games, per-game values, MVP efficiency and win rate use the exact existing production selections and formatting. The leaders can be different people. Game counts describe the source record's coverage, which differs by metric; they do not establish a common cohort. Win rate retains the API's result definition, including its exclusion of ties from the percentage denominator.

## Comparison

Rendered with the same real production response at 1600, 1024 and 390px viewport widths. Heights include the existing section heading and padding, rounded to whole pixels.

| Viewport | Original | A | B |
|---|---:|---:|---:|
| Desktop / 1600px | 197px | 196px | 239px |
| Tablet / 1024px | 290px | 300px | 306px |
| Phone / 390px | 517px | 534px | 517px |

| Criterion | Original | A | B |
|---|---|---|---|
| Density | Strongest unqualified compact display | Same desktop footprint with sample context; slightly taller on phones | More desktop height for shared comparison structure |
| Readability | Strong, distinctive numbers; very small labels | Clearer labels and names; smaller, less distinctive numbers | Aligned categories; readable matrix headers |
| Hierarchy | Immediate four-pair scan | Preserves that reading path | Prioritizes career versus performance bands |
| Competitive relevance | All eight leaders directly visible | Adds sample sizes and qualification | Same context, organized by leader type |
| Comparison clarity | `VS` can imply unlike values are comparable | Removes that implication | Makes independent volume and efficiency leaders explicit |
| 2080 consistency | Authoritative baseline | Closest alternative; typography is the main visual tradeoff | Uses the existing section shell, but a more tabular internal composition |
| Mobile | Four stacked pairs | Preserves pairs and wrapping names | Four table rows, same paired reading order |

**Recommendation:** Keep production unchanged. A offers a defensible clarity improvement with essentially no desktop density cost, and is the stronger candidate for visual review. B demonstrates a different reading structure but does not yet justify its extra desktop space. Neither should replace the original solely on these measurements; if A's quieter numerals weaken the 2080 identity in your review, retain the original.

## Implementation and validation

- HTML is a snapshot of production `analytics.html`, with only a root base URL, noindex/title metadata, and two experiment asset references added. Header, navigation, hero, all tabs and all section markup otherwise match production.
- Both pages load production `main.js`, `analytics.js`, `app.css`, `style.css` and `analytics.css` directly. CSS overrides are scoped beneath `.career-preview`, attached only to Career vs Performance.
- The small adapter redirects only same-origin Analytics requests to `limit=10`, passes the response unchanged to production, and observes production's comparison render. It reuses the actual identity links, supporter badges and formatted values. All other requests pass through normally.
- Production's maps renderer remains authoritative: `maps` is an object with `most_played`, `total_kills`, `average_team_score`, `details` and `leaders`. The adapter never iterates or rebuilds it.
- Browser rendering used a freshly retrieved real API response, replayed unchanged through a temporary local preview server. No sample statistics or API fixtures are embedded in these prototypes. Actual requests were `/api/analytics?limit=10` for both alternatives.
- At all three widths: no uncaught browser errors, failed assets or page overflow; the same eight displayed values; unchanged rendered activity, Spotlight, Record Room, performance, weapons, maps and MVP content. The temporary preview server closes after inspection.
- JavaScript syntax, local asset/base URL resolution and production-file isolation are checked locally. No repository tests were created, modified or run.
- Impeccable critique used independent design and mechanical assessments (Herschel and Confucius). Prior V1 review notes were consulted; their source-only scores do not override the user's visual judgment. No saved production audit report was present. The static detector cannot resolve the preview's `<base>` and dynamic section correctly, so its hierarchy warning is inconclusive; rendered Chrome screenshots supply the relevant evidence. No browser overlay was injected.
- No production file, API route, database, nginx configuration or unrelated work was changed. Nothing was committed, pushed, deployed or restarted.

Questions skipped: the brief authorizes autonomous implementation through local validation and requests visual review after delivery.
