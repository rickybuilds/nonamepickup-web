# Prediction website

The website displays standings and rules. There is no sign-in, OAuth application, per-player prediction page, private history API or session cookie. Discord IDs are internal database/consent identifiers only; visitors do not supply an identity. Private picks, stakes, balances and history remain in Discord.

## Local preview

From api/, install the existing dependencies with npm ci, then run npm run preview:predictions. Open http://127.0.0.1:4173/predictions.html or /prediction-rules.html. The loopback preview never loads .env, opens a database or starts the main API/bot. All preview amounts/names are fictional. Append ?state=empty, ?state=unavailable or ?state=stale to view those standings states. Existing site navigation is preserved; unrelated site pages are not served by this isolated preview.

## API contract (version 1)

Only GET /api/predictions/config and GET /api/predictions/standings exist. Other paths return 404. There are no financial or consent mutation endpoints. Responses use Cache-Control: private, no-store, max-age=0.

Success: { ok:true, data, meta:{ contractVersion:1, mode, synthetic, updatedAt, stale } }. Error: { ok:false, error:<fixed code> }. updatedAt is Unix milliseconds. Ratios are 0–1 or null. Point values are safe whole integers. Errors contain no database details or private data.

/config returns column keys/labels/types, proposed ranking policy, publicPolicy, publicAvailable and wagering=discord. /standings returns columns, rows, page, pageSize, pages and total.

Public rows contain exactly rank, displayName, netProfit, settledGames and winRate. No Discord IDs, individual picks/stakes, balances, payout details or account history are returned. Rank always represents net profit, even under alternate sorting. Equal profit shares competition rank (1,1,3); deterministic name ordering breaks display-order ties. Search does not recalculate rank.

Query: page (1–1,000,000), pageSize (1–100, default 20), search (max 100 characters), sort (rank, displayName, netProfit, settledGames, winRate), direction (asc/desc). Invalid queries return 400; pages beyond the end clamp to the last page. Unknown win rate sorts last in either direction.

## Metrics

Net profit = actual retained account-specific settlement/correction credits for finalized markets with that account's settled bet, minus its retained stake once. Operation/allocation snapshots and house_funding markers are never income. Grants, owner adjustments, player-only rewards and cancelled/void/pregame refunds do not contribute. Bot eligibility prevents players betting their own market. Positive house-funded betting corrections count once as actual retained credits.

Correctness uses the latest approved result; corrected accuracy can differ from retained cash credits. Correctly predicted ties count as correct. No-correct-bettor refunds count as finalized settled games but are excluded from the accuracy denominator. Under-review markets stay out of finalized statistics. Retained prediction history works independently of deleted match rows. Multiple settled revisions for the same account/game fail closed as ambiguous data, preventing multiplied stakes or credits.

The proposed qualification minimum is 10 finalized games, with inactive opted-in players included. These publication choices remain pending owner approval; removing website login does not approve exposing everyone's statistics.

## Live server configuration

The checked-in api/ecosystem.config.js names the PM2 app tfcapi, uses /var/www/tfcbot/api as cwd, runs api.js, and sets ELO_DB=/root/tfcbot/elo.db. The user confirmed the website API and bot share a server. Actual running PM2 settings and database schema still need verification on that server.

PREDICTIONS_WEB_MODE defaults off; preview mounts synthetic routes; live opens a separate read-only connection to the existing configured ELO_DB. The adapter requires prediction schema version 2, never instantiates the bot store/migrations, never grants points, and never changes the database or its WAL mode. No browser can initialize an account. Schema source inspected was the working codex/match-predictions bot checkout; confirm the deployed approved bot version before activation.

Live standings publish aggregate rows for all prediction accounts directly from the configured database. Player names come from the existing ratings/Discord-name tables, with an `Unknown player` fallback; no browser login, consent file, or prediction mutation endpoint is involved.

No PREDICTIONS_DISCORD_* credentials are required or read. Remove previously configured prediction OAuth secrets/callback registrations if they were created solely for this website feature.

## Delivery and verification

Branch: codex/prediction-website-preview. No live activation, merge or deployment performed. Existing website navigation/sitemap has not promoted the prediction pages. Standings/rules use the incumbent NN // TFC template. Screenshots live in docs/review-artifacts/predictions; obsolete account screenshots were removed with the feature.

Repository instructions prohibit creating/changing/running tests. Verification uses JavaScript syntax checks, whitespace checks, source review and desktop/mobile preview inspection. These do not validate real financial calculations against fixtures. Actual database access, deployed schema/PM2 settings, privacy policy and live-server permissions remain unverified. Production integration must use the actual configured database and explicit approved publication fields; never copy a live SQLite file/WAL into a public directory.
