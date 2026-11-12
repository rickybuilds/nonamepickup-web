# Map combat layers

Use the Round selector to compare Round 1 defense against Round 2 defense (or offense) within a game. Round options show the recorded match team when available. The controls are Player (Killer or Carrier), Game, Round, and Weapon. The separate team and in-game direction filters have been removed; the round selection provides the comparison without overlapping filters. Removing these frontend controls requires a browser refresh only, with no API restart or backfill.

The map panel defaults to flag-carrier deaths. Defensive Kills and Offensive Kills show enemy deaths caused by a player with that recorded round role. The player selector refers to the carrier in the death layer and the killer in kill layers. Team direction is the recorded in-game killer team → victim team. Weapon names use the same canonical mapping as the player page (`weapon-10` is Single Shotgun, `weapon-11` is Super Shotgun, and so on). Replay scene death notices are preferred, including numeric notices mapped to canonical `weapon-N` values, falling back to an unambiguous death event for the same attacker and victim within 100 ms, then `match_kill_events` by match, round, killer name, and nearby event time. The scene death's raw `text` contains an entity edict, not a weapon ID; only death notices and death-event weapon fields may map numeric values. Missing names display as Unknown weapon and stay selectable.

Positions use the last living victim sample within two recording intervals, capped at two seconds. Suicides, friendly fire, missing positions, and unclassified round roles are excluded from kill layers. The UI reports how many located kills lack role data. Sides come from `match_player_round_stats.team_name` by Steam ID and round, matched to `match_rounds.offense_team` / `defense_team`, never class or position. The round-stat `role` field can contain a class label and is not used to infer side.

New complete schema-v6+ replay uploads populate the index automatically. After deploying and restarting the API (which creates the new SQLite tables), index existing verified archives on the server:

```powershell
node api/scripts/backfillPickupKillLocations.js
```

The startup summary shows how many artifacts remain, and each indexed artifact reports progress against that total. To see a count without processing archives (including from a second shell while a backfill runs):

```sh
node api/scripts/backfillPickupKillLocations.js --status
```

Counts reflect the verified artifact list when the command starts. A resumed run skips previously saved rounds and reports only the remaining work. Progress lines include the artifact ID, match ID, map, round, and indexed kill count so a specific replay can be investigated. Rounds with legacy numeric or `unknown` weapon values are automatically included for repair, even when the archive hash has not changed. Stop an older running backfill before rerunning the updated command so the older process cannot save stale values again.

The command explicitly loads `api/.env`, including when invoked from the repository root; already-exported environment values take precedence. It requires `PICKUP_DB_USER`, `PICKUP_DB_PASSWORD`, and `PICKUP_STORAGE_PATH`, with the same database settings, `ELO_DB`, and storage access as the API. It does not require `PICKUP_UPLOAD_TOKEN`. If configuration exists only in PM2's process environment, supply those same settings to the backfill process.

The command is resumable and skips unchanged archives; it does not rewrite replay archives or the existing carrier-death index. Carrier deaths gain weapon/team metadata when a matching enemy kill is indexed. Unmatched carrier deaths remain visible with All weapons and Both directions selected.
