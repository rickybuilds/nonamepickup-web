# NoName / All Game

This second attempt starts from `main` at `6f91252` on `codex/refactor2`.
The complete existing frontend now lives inside `refactor/`, using the approved
match-night direction. Navigation stays inside the new site, including match
reports, profiles, standings, map histories, analytics, comparisons, community
tools, speedruns and replays, live match center, browser spectator, rating
administration, and server documentation. Original root pages remain available.
The owner approved the direction and delegated design decisions on 2026-10-01.

Keep new frontend work inside `refactor/` so the deployed URL stays
`https://nonamepickup.servehalflife.com/refactor/`. This uses the existing static
directory route and requires no nginx configuration change. Use relative paths
for this frontend's assets and the existing same-origin `/api/` for data.

The previous Project 2080 attempt remains on `refactor/noname-2080`, with its
current tip at `c6db6f1`. It has not been deleted or renamed. The root website and
backend have not been changed by this reset.

The public site updates after the server pulls the branch into its existing web
root. No build step or nginx edit is needed:

```sh
cd /var/www/noname-2080
git pull --ff-only origin codex/refactor2
```

Do not add, change, or run tests unless explicitly requested, per `AGENTS.md`.

## Local preview

From the repository root, run `node refactor/preview.mjs`, then open
`http://127.0.0.1:4173/refactor/`. The preview server binds to localhost, serves
the website's static assets, and forwards public GET requests under `/api/` to
the existing production API. It does not start the backend or use `.env`.
Set `NONAME_PREVIEW_PORT` to use a different port.

The preview supports static replay assets and spectator downloads. It forwards
GET requests only; administration writes and live WebSocket connections require
the deployed server. The browser spectator reuses the existing `/live/` runtime
and assets, so that original directory must remain in the deployment.

`shell.js` provides navigation and privacy-aware player search. Page behavior
lives in `scripts/`; path-adapted baseline layouts live in `styles/`. Shared
`surfaces.css` and the pickup, speedrun, community, and spectator styles provide
the new appearance while preserving original route hooks and features.

## Assets

The homepage uses existing NoName environment art, TFC class cutouts, and map
imagery from `../assets/images/`. The self-hosted Barlow and Barlow Condensed
fonts come from Google Fonts; their OFL licenses are included in `fonts/`.
The hero reads the original `classes/manifest.json` and cycles through all ten
class images in shuffled rounds, every 12 seconds. It chooses a random initial
class, pauses in hidden tabs, and disables automatic cycling for reduced-motion
preferences. Its next/pause controls allow manual selection and pausing.
Product intent and the implemented design system are recorded alongside the
frontend in `PRODUCT.md` and `DESIGN.md`.
