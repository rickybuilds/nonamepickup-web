# Map combat layers

The map panel defaults to flag-carrier deaths. Defensive Kills and Offensive Kills show enemy deaths caused by a player with that recorded round role. The player selector refers to the carrier in the death layer and the killer in kill layers. Team direction is the recorded in-game killer team → victim team. Weapon names come from scene death notices, with the lethal inflictor as a fallback. Unknown weapons stay selectable.

Positions use the last living victim sample within two recording intervals, capped at two seconds. Suicides, friendly fire, missing positions, and unclassified round roles are excluded from kill layers. The UI reports how many located kills lack role data. Sides come from `match_player_round_stats.team_name` by Steam ID and round, matched to `match_rounds.offense_team` / `defense_team`, never class or position. The round-stat `role` field can contain a class label and is not used to infer side.

New complete schema-v6+ replay uploads populate the index automatically. After deploying and restarting the API (which creates the new SQLite tables), index existing verified archives on the server:

```powershell
node api/scripts/backfillPickupKillLocations.js
```

The command explicitly loads `api/.env`, including when invoked from the repository root; already-exported environment values take precedence. It requires `PICKUP_DB_USER`, `PICKUP_DB_PASSWORD`, and `PICKUP_STORAGE_PATH`, with the same database settings, `ELO_DB`, and storage access as the API. It does not require `PICKUP_UPLOAD_TOKEN`. If configuration exists only in PM2's process environment, supply those same settings to the backfill process.

The command is resumable and skips unchanged archives; it does not rewrite replay archives or the existing carrier-death index. Carrier deaths gain weapon/team metadata when a matching enemy kill is indexed. Unmatched carrier deaths remain visible with All weapons and Both directions selected.
