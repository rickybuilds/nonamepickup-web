# Project 2080

## Architecture and deployment

This is a static, self-contained frontend at `refactor/index.html`. It uses its own `screen.css` and `app.js`; it does not load the production styles or scripts. Views use query strings (`/refactor/?view=matches`, `/refactor/?view=player&id=…`) so direct links and refreshes work with ordinary static file serving. Styles, scripts, and the favicon use paths relative to `/refactor/`. Data requests deliberately use the existing same-origin `/api/` endpoints. Links to specialized legacy tools use `../` paths. No database or API code has changed.

If the deployed web root is this repository root, exposing the `refactor/` directory is enough. If the host publishes a different static directory, copy or mount only `refactor/` into that directory and ensure `/api/` remains proxied to the existing backend. No SPA rewrite rule is required. The exact live web-root and nginx configuration are not in this repository, so deployment needs a read-only server configuration check before changing any production config. No server configuration has been edited here.

## Forensic assessment

- **Product inventory:** root pages cover home, live queue and servers, match history and detail, player ranking and profiles, map intel, speedrun overview/maps/runners/replays, analytics, comparison, identity tracking, missed votes, odds, MVPs, the browser spectator, and server documentation.
- **Frontend:** static HTML pages with shared `assets/css/app.css` and `style.css`, page-specific CSS and JavaScript, and a broad `assets/js/main.js`. Navigation and headers are repeated across pages. The replay viewers are specialized Three.js modules and should remain separate instruments.
- **Data:** the Express API in `api/src/routes` serves SQLite-backed pickup records and MariaDB-backed speedruns. Queue and live state come from server-side files and game-server queries. Steam profiles are cached by the backend. Replay viewers read their own dedicated API streams. Analytics and leaderboard results have backend caching. The frontend should not reproduce those queries or cache policies.
- **Existing visual rules:** dark background, condensed sci-fi display type, glows, cards and panels, colored KPI tiles, and per-page additions. Mobile handling varies by page and tables often collapse inside existing containers.
- **Debt affecting redesign:** repeated HTML chrome, root-relative assets on some pages, mixed URL/query conventions, a large shared script, and UI-specific API response shapes. The deployment's actual static web root is absent from the repo.
- **Preserve:** API validation, hidden-ELO handling, safe external links, existing replay engines, server integrations, game records, and specialized tools with substantial behavior.
- **Replace:** card-first page composition, repeated decorative iconography, generic dashboard hierarchy, and the current header/navigation for redesigned views.

## Design language

An editorial match ledger: warm paper, near-black ink, restrained red and blue team color, acid green only for a live action, large compressed word shapes, mono metadata, hard rules, and dense rows. Current state receives a dark, high-contrast rail. Historical records sit on a quiet light field. The same modules recompose on mobile; the mobile header becomes an index and desktop table columns are selected for touch scanning. Motion is limited to a loading line and respects reduced motion.

## Migration status

Implemented in the new visual system: overview, queue/live status, matches, match detail, ranking, player profile, pickup maps, speedrun map index and map detail, analytics summary, player comparison, global player search, and an archive index. Specialized replay playback, full analytics breakdown, identity tracker, odds, MVP breakdown, admin ELO, browser spectator, and server documentation still open the existing production interfaces from the archive. This keeps those capabilities reachable without changing their mature behavior or copying sensitive identity information into a new view.

The match list filters only the current fetched page; its controls and result count state that scope explicitly. Older pages use the API offset. The speedrun map index uses the existing API pagination and server-side search without replacing the search input. Search results and API values are escaped before HTML insertion. External profile and log URLs are restricted to HTTP(S), and new external tabs use `noopener noreferrer`.

## Production-interface pass

- The overview keeps the editorial wordmark but removes noninformational circles and shortens the hero so match activity enters the first viewport sooner. The dark rail now shows a timestamped queue snapshot, queued names, and the last completed result when no match is live. An unavailable queue is not displayed as an empty queue.
- The leaderboard API supplies current ELO while its `days` parameter changes game and form counts. The interface now calls this a record window and explains that ELO is current. Players with private ratings are omitted from sorted standings; they remain findable by name.
- Match filters explicitly apply to the loaded page. Mobile match rows retain date and result beneath the map name. The speedrun index puts recent world records and record holders before the large map index, and search updates results in place without stealing focus.
- Map detail distinguishes all completed matches from the 25 recent matches shown. Player and speedrun detail hero values have labels. Comparison accepts exact names as well as IDs, rejecting ambiguous names.
- The search dialog restores focus to its trigger, traps keyboard focus while open, and ignores stale search responses. API failures have distinct states from valid empty results where the endpoint allows it.

## Mobile composition pass

- At phone widths the overview retains the split identity/queue hero. Its wordmark and queue text are typeset for two narrow columns; the match and ELO ledgers become consecutive full-width sections.
- Navigation is a visible, ruled section index with 44px touch rows. It uses seven columns at small-tablet widths and a deliberate four/three two-row composition on phones. Search remains in the brand row.
- The four metrics use a compact 2×2 ledger below 760px. Four across would leave less than 90px per metric at 360px, making both the values and labels too narrow to read reliably.
- Match, ranking, map, and record rows keep dense rules and minimum touch height. Long names truncate in scan lists while detail views reduce their display type. Mobile match, leaderboard, map, and combat rows keep their secondary data in a smaller line under the primary name.
- The same mobile type, touch, and overflow rules cover Live, match/player/map details, Speedruns, Analytics, Compare, Archive, and search. Desktop rules remain scoped outside the narrow-width overrides.
- At 761–1100px, player and match ledgers switch from six desktop columns to three scan columns with the remaining data on a secondary line. Search stays visible in the header at this transition width.

## Review and next steps

Static JavaScript syntax and whitespace checks pass. Public production API calls for the queue, a match, a player profile, and speedrun summaries/maps returned successfully on 2026-09-22. A user-provided desktop screenshot exposed a wordmark layout bug: the inner slash was rendered as a third block and made the hero too tall. The selector and composition were corrected, followed by the production-interface pass above. A follow-up render, mobile screenshots, interaction, console, network, and accessibility checks remain outstanding: the available browser tool rejected a local-file visit under its URL policy. The project should not be deployed or called complete until those checks pass on a review host serving `/refactor/`.
