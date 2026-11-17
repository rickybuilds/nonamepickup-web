# Configured aim-gap review rule

**Retired as an automatic notification rule.** See [strict hit-evidence alerts](HLTV-HIT-EVIDENCE-ALERTS.md) for the current policy. Single-round close aim-near rates now create quiet website markers only; they do not automatically open new reviews or notify Discord. The 25-game baseline is separate from per-game evidence coverage. The description below preserves the original rollout history; its old automatic behavior is no longer active.

The operator-requested rule flags an absolute conc/non-conc **aim-near** rate gap strictly below **10 percentage points**, for the same SteamID/class/weapon in one recording. Each side needs a positive eligible denominator. There is no 25-shot gate: small samples still flag. Show **Below 25 eligible shots in at least one state** only when either side has fewer than 25; omit it when both sides have at least 25. Zero-denominator and timing-uncertain groups do not produce a comparison.

This is a configured review heuristic, not a cheating verdict or a learned baseline detector. Two zero aim-near numerators with positive denominators can qualify. Historical anomaly thresholds remain pending; existing descriptive histories are unchanged.

## Deploy and flag stored comparisons

Pull the bot repository in `/root/tfcbot` and restart `tfcbot` when operationally safe. Its updated sender understands the `aim_gap_review` alert kind. The existing enabled alerts, private channel ID, allowlist, shared registry DB and HTTPS review URL remain required. Channel privacy checks and disabled mentions remain enforced. No production messages are sent by tests.

Pull the website repository in `/var/www/tfcbot`. Add to `/var/www/tfcbot/api/.env`:

```dotenv
HLTV_AIM_GAP_REVIEW_ENABLED=true
```

The example defaults to false. Keep the working registry/upstream/statistics settings. Restart `tfcapi` for the updated API/review page. Workers read the setting on each invocation. New successful firing analyses evaluate the rule automatically.

To flag **already processed** demos without decoding or downloading again:

```sh
flock -n /var/lib/noname-hltv-worker/worker.lock node /var/www/tfcbot/api/scripts/flagHltvAimGaps.js --apply
```

This creates real protected reviews and durable private-channel alerts from stored comparisons. Rerunning is safe: existing findings are deduplicated. The bot must be updated before enabling this rule so it recognizes the new alert kind.

## Review behavior

New findings open a high-priority case and an explicit rule-owned hold. Existing open assignments, statuses, manual holds and evidence retention survive. Expiry only extends according to the high policy. Dismissed/confirmed cases are not automatically reopened. Missing/deleted source recordings are skipped rather than falsely reported as protected evidence.

Deduplication uses source demo/log hashes, rule version, player, class and weapon. New comparisons for one recording share one alert per evaluation; the embed shows up to ten and links to the full review. Re-analysis does not repeat the same findings or recreate a released rule hold for already recorded findings. The existing durable Discord retry/lease flow handles delivery.

Discord and the review page display the player, weapon/class, counts, both rates and their gap. The small-sample note is conditional. Findings retain observation ID, upstream revision and configuration hash. They do not contain fabricated confidence scores. Verification covers the AC example, small samples, exact-25 note omission, exact-10 rejection, zero denominators, default-off behavior, cases/holds/alerts and retry deduplication.
