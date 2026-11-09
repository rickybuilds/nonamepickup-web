# Bootcamp season API

Season standings use the same skill-point deltas and weights as the monthly
board. Only tier improvements recorded within the scheduled UTC season window
count. Previous tiers are read from earlier `tier_up` events so a player's
bronze award before the season is not counted again.

Enable with `BOOTCAMP_SEASONS_ENABLED=true` on the Website and Bot. The
Website's overall Bootcamp API remains independently controlled by
`BOOTCAMP_API_ENABLED` and is disabled by default. With the season flag unset,
the public endpoint returns no season without querying MariaDB and the admin
write endpoint is hidden.

Apply `TFC-Bootcamp/migrations/015_training_seasons.sql` before scheduling a
season. Use the authenticated admin endpoint with strict UTC timestamps:

```http
POST /api/bootcamp/admin/seasons
Content-Type: application/json

{"slug":"winter-2026","title":"Winter 2026","startsAt":"2026-12-01T00:00:00Z","endsAt":"2027-01-01T00:00:00Z"}
```

`GET /api/bootcamp/seasons/current` returns the active season and at most 100
standings, or `{ "season": null, "standings": [] }` if none is active.
Enabled seasons cannot overlap. There is no automatic season creation.
