# NoName / All Game

This second attempt starts from `main` at `6f91252` on `codex/refactor2`.
The first design pass is a working homepage: live queue, recent match results,
current public Elo standings, community stories, map histories, and speedruns.
The other views link to the existing working site while their redesign remains
future work. The owner approved the match-night hub direction on 2026-10-01.

Keep new frontend work inside `refactor/` so the deployed URL stays
`https://nonamepickup.servehalflife.com/refactor/`. This uses the existing static
directory route and requires no nginx configuration change. Use relative paths
for this frontend's assets and the existing same-origin `/api/` for data.

The previous Project 2080 attempt remains on `refactor/noname-2080`, with its
current tip at `c6db6f1`. It has not been deleted or renamed. The root website and
backend have not been changed by this reset.

These files update the local workspace. The public `/refactor/` remains on
the old version until the new branch is deployed to the existing web root.

Do not add, change, or run tests unless explicitly requested, per `AGENTS.md`.

## Local preview

From the repository root, run `node refactor/preview.mjs`, then open
`http://127.0.0.1:4173/refactor/`. The preview server binds to localhost, serves
the website's static assets, and forwards public GET requests under `/api/` to
the existing production API. It does not start the backend or use `.env`.
Set `NONAME_PREVIEW_PORT` to use a different port.

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
