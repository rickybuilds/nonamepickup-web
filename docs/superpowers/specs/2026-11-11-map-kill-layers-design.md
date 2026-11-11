# Map combat layers

Approved in chat: add Flag Carrier Deaths, Defensive Kills, and Offensive Kills tabs to the existing map panel. Kill dots show the victim's sampled location. Classify kills using the killer's recorded round role; exclude suicides and friendly fire. Keep the existing overview projection, zoom, player, and game controls.

Add killer-team → victim-team and weapon filters, including all recorded weapon types. Populate weapon choices from data with readable TFC names. Tooltips identify killer, victim, weapon, teams, round, replay time, and match. Missing role records must not be guessed from class or map position.

Approach: extend replay ingestion with a separate kill-position index and query endpoint, then reuse the current map renderer. A UI-only change cannot supply the missing positions; fetching full replay archives in the browser would be unnecessarily expensive. Supply a backfill command for existing verified archives.

Constraints: preserve unrelated working changes. Do not create, modify, or run tests. Verify syntax and inspect changes. Existing archives require backfilling after deployment.
