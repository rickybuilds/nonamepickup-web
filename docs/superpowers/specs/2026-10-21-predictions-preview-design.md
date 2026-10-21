# Live prediction standings design

## Approved scope

Owner clarified on October 21 that the standings require at least one finalized settled prediction. Exclude zero-settlement accounts before ranking and pagination. No signup, opt-in file, OAuth, per-player page or private endpoints. Published fields remain name, rank, net prediction profit, finalized settled games and correct-pick rate. Private financial details stay in Discord.

## Implementation

Remove the fictional dataset/server, demo states and preview labels. Query configured ELO_DB read-only, join existing saved names by internal Discord ID and never create accounts. Preserve existing aggregate metric definitions and NN // TFC design. Browser refreshes every 15 seconds while visible; preserve last successful rows with an honest warning on background outage. Connection/schema failures only affect prediction routes and retry after 30 seconds. PM2 tfcapi explicitly uses live mode and existing ELO_DB=/root/tfcbot/elo.db. No deployment performed from this workspace.

## Verification

No tests created/modified/run per AGENTS.md. Syntax, whitespace, static review, and desktop/mobile unavailable-state inspection. Actual server data/schema/permissions remain unverified.
