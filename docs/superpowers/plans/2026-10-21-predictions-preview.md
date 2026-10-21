# Live Prediction Standings Implementation Record

Owner approved live feeds and clarified that eligibility requires at least one finalized settled prediction on October 21. Continue on main per user request.

- [x] Remove demo data/server, preview script/labels and opt-in gates. Require one finalized settled prediction for leaderboard eligibility.
- [x] Query all existing prediction accounts and saved player names read-only; keep private fields out of responses.
- [x] Add 15-second visible-page refresh, request timeout and honest stale/unavailable states.
- [x] Use PM2 tfcapi existing ELO_DB; isolate schema/database failures from the main API and retry setup.
- [x] Update documentation and rules to approved real publication policy.
- [x] Complete syntax/whitespace, desktop/mobile unavailable-state inspection and static review.

No tests created/modified/run. No live server/database access or deployment; server must pull main and restart tfcapi using ecosystem configuration.

Verification: syntax/whitespace passed; desktop/mobile showed the real unavailable state with no fictional rows, mobile width matched 390px viewport, and browser reported no JavaScript errors. Static review found polling needed restarting after Back/Forward cache restoration; added pageshow handling. No other actionable review findings. No tests run.
