# Bot Replay Delivery Implementation Plan

**Goal:** Let the bot deliver finalized recordings between matches and trigger web imports.
**Architecture:** Durable SQLite jobs in tfcbot; restricted SSH commands for game upload and web import; existing uploader receipts and maintenance lock remain authoritative.
**Spec:** docs/game-details-bot-trigger-design.md
**Constraints:** Never stop an upload or block the next match. Defer new uploads during play. No tests or test changes. Commit and push both repositories. Private keys remain outside Git.

- [x] Add forced-command game/web wrappers and document one shared source-IP-restricted key.
- [x] Add a durable bot delivery queue with retries, SSH host verification and per-host serialization.
- [x] Persist at round-two completion; release after recorder readiness and recap analytics; defer while any pickup sharing that host is active.
- [x] Check JavaScript/Bash syntax and diffs; independent review caught a restart gap, fixed by saving finalize jobs before recap. No tests run per user instructions.
- [x] Commit and push bot integration (`9bb1375`) and website deployment helpers/documentation.

Recovery uses current stored analytics if the bot exits during recap processing; interrupted enrichment may require deliberate reimport. The integration does not stop running uploads or delay the next match. Production SSH keys and timers remain deployment steps.

Review focus: SSH disconnects must retain jobs; missing ready markers must not count as delivery; lock contention retries; shared hosts serialize; timer remains disabled during bot operation; no upload cancellation.
