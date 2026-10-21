# Live prediction standings

The website has public standings and rules only. No Discord login, OAuth credentials, private account pages or per-user history APIs. Discord IDs remain internal matching keys.

## Approved publication policy

On October 21 the owner clarified that only players with at least one finalized settled prediction belong in the standings. Exclude zero-settlement accounts before ranking, filtering and pagination; inactive players with settled history remain included. Do not initialize accounts for people who have never used predictions. Public fields are exactly rank, displayName, netProfit, settledGames and winRate. Picks, stakes, balances, individual payouts and history stay private. No consent file or per-player opt-in setup is required.

## Server update

The checked-in PM2 configuration names tfcapi, uses /var/www/tfcbot/api as its working directory, runs api.js and sets ELO_DB=/root/tfcbot/elo.db. The user confirmed the bot and API share a server. Update with:

    cd /var/www/tfcbot
    git pull --ff-only
    cd api
    pm2 restart ecosystem.config.js --only tfcapi --update-env

The ecosystem explicitly sets PREDICTIONS_WEB_MODE=live. The API also defaults to live when this variable is absent; PREDICTIONS_WEB_MODE=off disables mounting. Remove any old preview setting from the service/.env or use the ecosystem restart command so PM2 applies live. Old PREDICTIONS_PUBLIC_POLICY, PREDICTIONS_CONSENT_FILE and PREDICTIONS_DISCORD_* variables are no longer read and can be removed.

Open /predictions.html. The browser reads /api/predictions/standings on load and every 15 seconds while visible. It refreshes after returning to the tab and preserves the selected search/sort/page. On failed background refresh it keeps the last successful rows and timestamp with a stale warning; initial failures show an unavailable message with retry. Requests time out after 10 seconds. Hidden pages do not poll. Read timestamps describe the last successful database snapshot request, not the time the most recent bet was placed.

The fictional dataset, preview command/server, query-driven demo states and preview labels have been removed. No API response fabricates real standings when the database is unavailable.

## Read-only database integration

Live reads use a separate better-sqlite3 connection to the existing configured ELO_DB, with readonly:true and fileMustExist:true. Never instantiate the bot PredictionStore (its constructor migrates schema), change WAL pragmas, grant points or copy a live SQLite/WAL file into the website. Database reads use a consistent transaction. The required prediction tables/schema version 2 must already exist from the deployed approved bot.

Names use ratings.display_name, then available discord_names display/global/username fields. Missing names show Unknown player; the public API never falls back to a raw Discord ID. Names are rendered with textContent. Accounts with zero finalized settled predictions are excluded, even if they have points from grants or player rewards.

The connection/schema is loaded lazily. Missing files, permissions, native bindings or unavailable schema yield fixed 503 error codes on standings and retry connection setup after 30 seconds, without crashing the main website API. Logs contain only fixed failure categories, not paths, queries or user data. Successful initialization reuses the read-only connection; database file replacement requires an API restart.

## API contract (version 1)

GET /api/predictions/config returns columns, ranking (metric=netProfit, ties=competition, minimumGames=1, participation=settled_bettors, inactive=included) and wagering=discord. GET /api/predictions/standings returns columns, rows, page, pageSize, pages and total. Other prediction paths return 404. No writes, authentication or account endpoints exist.

Success: { ok:true, data, meta:{ contractVersion:1, mode:live, updatedAt, refreshIntervalMs:15000 } }. updatedAt is Unix milliseconds. Ratios are 0–1 or null; points are safe whole integers. Responses use Cache-Control:no-store. Errors contain only { ok:false, error:<fixed code> }. Errors distinguish invalid_query (400), predictions_database_unavailable (503), predictions_schema_unavailable (503), predictions_configuration_unavailable (503), and generic predictions_unavailable (503).

Query: page (1–1,000,000), pageSize (1–100, default 20), search (max 100 characters), sort (rank, displayName, netProfit, settledGames, winRate), direction (asc/desc). Out-of-range pages clamp to the last page. Rank is always by net profit even under alternate sorting. Equal profit shares competition rank (1,1,3); search never recomputes rank. Null correct-pick rate sorts last both ways.

## Accounting

Net profit is actual retained account-specific settlement/correction credits for finalized markets with that account's settled bet, minus its retained stake once. Operation/allocation snapshots and house_funding markers are not income. Grants, owner adjustments, player-only rewards and cancelled/void/pregame refunds are excluded. Bot eligibility prevents official players betting their own market. Positive house-funded betting corrections count once as retained credits.

Correctness uses the latest approved result, which may differ from retained historical credits after correction. Correctly predicted ties count as correct picks. No-correct-bettor refunds count as finalized settled games but are excluded from the accuracy denominator. Reviewed markets are excluded from finalized scores. Retained prediction records remain usable after match-table deletion. Ambiguous multiple settled revisions for one account/game fail closed instead of multiplying a stake or credit.

## Verification limits

No tests are created, changed or run per AGENTS.md. Validation uses JavaScript syntax/whitespace checks, static review and desktop/mobile visual inspection of the honest unavailable state. No live server database, deployed schema, actual server file permissions or live monetary results have been verified from this Windows workspace. The server restart above is required to activate the pushed code. No server commands or production database changes were performed by the agent.
