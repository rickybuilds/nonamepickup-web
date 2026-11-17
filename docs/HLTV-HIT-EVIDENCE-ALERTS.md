# Strict hit-evidence alerts and game baselines

The primary notification metric is now **strict identified hit-evidence firing events / evidence-eligible firing events**, using Ghosty's existing kill/blood/damage association outputs. It is not aim-near, exact bullet/pellet accuracy or a cheating probability. The quick-view headline uses this same metric; aim-near remains explicitly labelled supporting context. Unmatched evidence is not a confirmed miss.

## Games, windows and firing events

- **25 earlier comparable games** establishes the personal baseline. This is not a 25-shot gate. A game is a canonical server/match ID with successful comparable analysis; multiple analyzed rounds of the same game count once. Both rounds do not need to have been analyzed. Comparison stays within the same map, class, weapon and exact upstream/settings/asset configuration.
- **20 distinct estimated concussion windows containing eligible hit-evidence firing** is the default coverage minimum for notifications. Repeated firing during one window counts as one window. Windows are the original matched-log/upstream estimates; no new concussion algorithm is added. Unknown/mismatched source coverage fails closed.
- Eligible firing events remain the rate denominator. One event can represent multiple pellets. There is no minimum of 25 firing events and no below-25-shots label in new notifications.

## Default operator heuristics

Only supported hitscan weapons (AC, shotgun, super shotgun, sniper and auto rifle) can notify. Projectile geometry stays available as context, without this hit-evidence alert.

1. **Immediate high conc hit evidence:** 100% strict hit-evidence rate across at least 20 distinct qualifying windows. Available before 25 prior games, including with no non-conc sample.
2. **Repeated similar hit-evidence rates:** absolute conc/non-conc strict-rate gap below 10 percentage points in at least 2 of the latest 3 comparable games, including the current game. Each qualifying game needs the configured window coverage. One-round close aim-near differences only create quiet website markers.
3. **Personal-baseline rise:** after at least 25 earlier comparable games, current conc strict hit-evidence rate rises by at least 20 percentage points over pooled earlier counts, with the same current-window coverage minimum. The 20-point threshold is an adjustable initial operator heuristic, not a validated statistical significance test.

Current game, future recordings, incompatible configurations and incomplete groups do not train their own baseline. Ratios pool counts rather than average round percentages. History is bounded to the latest 10,000 compatible round observations. High conc takes priority over baseline rise, then repetition; one comparison produces one notification reason per evaluation. Findings remain deduplicated by rule/trigger, source recording/log identity, player, class and weapon.

## Configuration and deployment

Update the bot before enabling new production alerts. Pull the bot in `/root/tfcbot`, pull the website in `/var/www/tfcbot`, and restart the bot when operationally safe plus `tfcapi`.

In `/var/www/tfcbot/api/.env`, keep the existing working collection settings and configure:

```dotenv
HLTV_AIM_GAP_REVIEW_ENABLED=true
HLTV_HIT_EVIDENCE_ALERTS_ENABLED=true
HLTV_HIT_ALERT_MIN_CONC_WINDOWS=20
HLTV_HIT_HIGH_CONC_PERCENT=100
HLTV_HIT_REPEAT_GAMES=2
HLTV_HIT_REPEAT_WINDOW=3
HLTV_HIT_BASELINE_GAMES=25
HLTV_HIT_BASELINE_RISE_POINTS=20
```

All new alerting defaults off in the example environment. The existing gap flag enables quiet marker collection; the new hit-evidence flag independently controls notifications within that evaluation. Existing bot `HLTV_ALERTS_ENABLED`, dedicated channel ID, shared DB, reviewer allowlist and HTTPS review URL are still required. Privacy checks and disabled mentions remain enforced. Tests do not post production messages.

To reassess existing stored statistics without decoding or downloading demos:

```sh
flock -n /var/lib/noname-hltv-worker/worker.lock node /var/www/tfcbot/api/scripts/flagHltvAimGaps.js --apply
```

This recovers window coverage from the saved per-shot evidence and that observation's verified original upstream window result. Hashes and upstream revision must match. Missing old evidence produces no invented count and cannot satisfy a notification threshold; a real reanalysis is needed if it cannot be recovered. Future successful analyses store coverage directly.

Unsent legacy `aim_gap_review` alerts are suppressed with an auditable reason; they are not marked as delivered. Already posted messages, old reviews, assignments and evidence holds remain intact. Quiet markers create no new reviews or holds. Qualifying new hit-evidence findings create a high-priority protected review and a durable private Discord alert. Closed/dismissed/confirmed decisions are respected. Disabling a producer stops new findings; other queued supported alert kinds retain the existing delivery behavior.

## Validation

Tests cover immediate eligibility before 25 games, twenty distinct windows versus one window with many shots, aim-near/hit-evidence separation, projectile exclusion, feature defaults, two rounds counting as one game, pooled 25-game baselines, current-game/future/config/map exclusion, repetition, original-window recovery/hash failures, deduplication, assignments/holds and auditable legacy suppression. New labels show baseline-building progress only when below 25 games; ready baselines show actual historical rates and game counts. Real outcomes remain human review leads.
