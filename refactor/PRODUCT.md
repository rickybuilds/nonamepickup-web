# NoName TFC Pickups

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The NoName Team Fortress Classic gaming community. Players find pickups,
follow match results, compare performance, and explore community records.

## Product Purpose

Make the community's games, players, and rivalries visible and accessible.
The owner requested a fresh design that can eventually replace the main site.

## Capabilities and Constraints

The approved match-night design covers the complete existing frontend under
`/refactor/`: homepage, matches and reports, rankings and profiles, map history,
live match center, analytics, player comparisons, community tools, speedruns,
replays, browser spectator, rating administration, and server documentation.
Preserve the mature data loaders, controls, URL parameters, and privacy rules.

Use static HTML/CSS/JavaScript at `/refactor/` and the same-origin `/api/`.
No nginx, backend, database, or main-site changes. Do not invent statistics,
presence, Discord invite links, or queue enrollment functionality.
Preserve hidden ratings. Repository instructions prohibit test work unless
explicitly requested. Browser review and JavaScript syntax checks are allowed.

## Brand Commitments

NoName, competitive Team Fortress Classic, gaming community character.
The owner approved a TFC match-night hub and delegated the remaining design
decisions. Real maps, players, and game assets carry the identity.

## Evidence on Hand

Root website and `assets/js/index.js`; existing `/api/home`, `/api/queue`,
`/api/matches`, `/api/leaderboard`, `/api/players/search`, and `/api/mapaverages`.
Existing class cutouts, map imagery, and homepage environment art in
`../assets/images/`. Self-hosted Barlow fonts from Google Fonts with OFL licenses.

## Product Principles

- Live state must distinguish unavailable data from an empty queue.
- Real community stories take priority over decoration.
- Keep core information usable on phones and with a keyboard.
- Keep internal destinations in `/refactor/`, with an explicit original-site link.
