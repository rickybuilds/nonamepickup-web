# Match Map Vision Integration Plan

**Goal:** Make tactical round playback native to match.html Map Vision, hide the tab when no playable round exists, and route bot recap links to the selected round.
**Design:** Reuse one mountable playback engine in the match tab and existing standalone page. Remove duplicate game/round forms and prototype header from the match tab; retain playback, player, life and event controls. Scope styles to the player, clean up fetches/listeners/animation when leaving it, and select rounds using match controls. Preserve existing standalone URLs.
**Constraints:** No new/modified test files or test runs. Preserve unrelated visual design. Commit and push both repositories.

- [x] Add lightweight database/prepared-file availability endpoint; require a map overview before showing Map Vision.
- [x] Extract reusable playback mount/lifecycle and native Map Vision markup/styles.
- [x] Add round-specific #map-vision navigation and downloads links; hide tab until availability is confirmed.
- [x] Update bot recap wording and links.
- [x] Check syntax/diffs and review cleanup/unavailable-round/deep-link behavior. Independent review found a shared round-filter issue; normalize back to all rounds when analytics lacks the replay round. No tests run; browser rendering was not verified locally.
- [x] Commit and push both repositories; bot recap links committed as 3861429.

Bot embeds are posted before delivery completes, so links may initially open the normal match overview until playback becomes available. Existing Discord messages keep their previous links.
