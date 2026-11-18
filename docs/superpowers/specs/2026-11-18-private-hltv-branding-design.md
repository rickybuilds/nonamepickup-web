# Private HLTV Branding Integration Design

## Intent

Make the authenticated HLTV administrative area visually native to NN//TFC while keeping it private, separately routed, and protected by the existing server-side authentication and authorization model.

## Goals

- Reuse the existing NN//TFC logo, fonts, colors, controls, surfaces, and responsive conventions.
- Keep `/admin/hltv-review` as the direct administrative entry point.
- Keep HLTV absent from public headers, More menus, footers, sitemaps, search, and player-facing pages.
- Keep authenticated reviewer controls and owner-only user management intact.
- Ensure public visitors see only a branded sign-in shell or access-denied behavior, never private records or evidence.

## Non-goals and anti-goals

- No scanner, statistics, retention, alert, database, or API-contract changes.
- No new authentication store, credentials, permissions, or session semantics.
- No public HLTV navigation or discoverability changes.
- No broad rewrite of the public site CSS.

## Approach

The existing page is a self-contained administrative document and the public site uses shared `app.css`, `style.css`, and shared CSS modules. The implementation will load the shared NN//TFC styles and assets in the private document, replace its standalone login/header presentation with a branded private shell, and keep only authenticated administrative navigation inside the workspace. The existing API bearer/session checks remain authoritative; regression tests will assert that public navigation stays unchanged and that unauthenticated HLTV API access remains rejected.

## Constraints

- Local Windows repositories only; no production access or deployment.
- Preserve the existing private URL and server-side auth boundaries.
- Preserve all current reviewer workflows and labels.
- Keep the existing inline CSP-compatible script architecture unless a verified security issue requires a route change.

## Open limitations

The HTML shell is intentionally reachable at the bookmarked URL so it can present the existing login flow; private data is fetched only after API authorization. Production deployment and visual verification remain outside this local audit.
