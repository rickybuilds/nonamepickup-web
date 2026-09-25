# Project 2080 Player Dossier Art-Direction Design

## Purpose

Recompose Project 2080 Player Detail as a distinctive competitive-game archive dossier. The current page contains the required data and working interactions, but repeats similar headings, metric blocks, and ruled tables, so its sections lack recognizable visual identities. The production Carbon profile is a reference for scanability and information variety; the Project 2080 implementation, documented in `refactor/PROJECT-2080.md`, remains the visual authority.

## Selected direction

Use an identity-first archival masthead and let the page read as chapters in a player's career. Carbon's available portrait and name lead. Current ELO, rank, ELO movement, and recent form sit in a secondary standing rail. Supporting career metrics form a compact band with clear primary, secondary, and tertiary levels.

The rest of the page alternates deliberately between analytical scale, game imagery, ruled records, and compact history. Preserve the warm-paper/near-black surfaces, condensed display type, mono metadata, hard rules, and restrained blue/red team semantics. Avoid generic rounded cards and repeated equal-weight KPI tiles. Use existing imagery and data rather than adding an API or a duplicated data source.

### Information chapters

1. **Identity and standing:** portrait-led masthead; name is the strongest typographic anchor. Retain Steam identity, supporter identity/diamond, current ELO, ranks, last-20 movement, and recent-form outcomes. No conventional profile card.
2. **Career snapshot:** a primary ELO/rank/trajectory grouping; record, peak, and win rate as secondary measures; streak, MVPs, and PUG frequency as tertiary metadata. Preserve hidden-rating behavior.
3. **Performance:** give K/D a clear focal position and make kills/deaths legible as a relationship. Group damage, captures, and conc jumps by relative importance instead of six identical tiles. Retain all displayed totals.
4. **Play-style fingerprint:** visibly communicate offense/defense time balance and class distribution before the user reads labels. Keep the existing filters, kill-event metrics, class/weapon breakdown, top weapons, and class-time controls. Use only team blue/red as semantic accents.
5. **Recent matches:** make imagery and result state the strongest page interruption after the opening. Use an editorial lead match and compact match strips/contact-sheet treatment for remaining visible matches. Preserve map, image, result, score, ELO delta, date/ID, players, pagination, Project 2080 match links, Hampalyzer, and TFCStats links.
6. **ELO history:** present the current SVG trend as a wide career visualization with readable trajectory, current value, peak/low context, and time context. Keep chart furniture minimal and avoid implying unavailable measurements.
7. **Activity:** retain the day-by-two-hour heatmap as a compact archival fingerprint. Give it a distinct surface/shape from the ELO chart.
8. **Relationships:** compose teammates and opponents as an explicit “with you / against you” matchup sheet, with supporter-aware identities and visible shared-match/win-loss signals.
9. **Map tendencies:** use an asymmetric image-led map atlas that distinguishes most played, best record, and toughest maps by scale and semantic color. Retain win rate and W/L/T/game counts, all-map expansion, and map navigation.
10. **Connected records:** retain all existing onward links and make this a quiet closing index.

## Composition and responsive behavior

- Recompose the page into chapter wrappers in `refactor/player-detail.js`, preserving existing API calls, query parameters, element IDs used by controls, deep links, pagination, and result semantics.
- Use `refactor/player-detail.css` for the dossier art direction; do not change shared navigation, global palette, or other views.
- Desktop: asymmetrical masthead; compact career band; unequal analytical groupings; one broad ELO visual; image-forward match and map chapters. Use negative space at chapter transitions rather than adding more rules everywhere.
- Mobile: preserve Project 2080 navigation and use an intentional single-column reading sequence prioritizing identity, standing, ELO trajectory, recent matches, and core performance before deeper combat and archive detail. Keep map crops meaningful, chart labels legible, and controls usable without horizontally squeezed desktop tables.
- Keep DOM reading order aligned with the visual reading sequence; do not duplicate the underlying data or use CSS order to create a conflicting reading order.
- Preserve the current implementation's support for day/night themes and reduced-motion/global type rules.

## Approaches considered

- **Identity-first dossier (selected):** starts with player identity, then career context and distinct game-history chapters. It directly meets the request for the player to own the opening and supports the desired narrative scroll.
- **Trajectory-first chronology:** opens with an oversized ELO timeline and places identity beside it. This emphasizes career movement but makes a graph compete with, or precede, the requested identity anchor.
- **Map-atlas-first:** leads with large map imagery and environment groups. It creates an atmospheric surface but delays the player and overweights one analytical dimension.

The identity-first approach was selected and approved in chat on 2026-09-25.

## Boundaries and acceptance

- No API/data behavior changes, data removal, unrelated parity work, or new test files.
- Do not replace Project 2080's visual language with the production site's neon dashboard styling.
- Keep every existing dossier value, filter, navigation link, supporter marker, chart, history record, expandable detail, and pagination behavior.
- Render and inspect the complete dossier at desktop and mobile, including the chapter transitions and lower-page sections. Evaluate both the full-page silhouette at zoomed-out scale and each visual encoding at normal scale.
- Compare against the live production Carbon profile for scanability while retaining the Project 2080 identity.
- Follow `AGENTS.md`: do not run automated tests unless the user explicitly asks. A syntax check and whitespace check are reasonable; do not create/modify tests.
