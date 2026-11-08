# Bootcamp Discord API integration

The TFC Bot consumes Bootcamp event, challenge, player and license data through
these website API endpoints:

- `GET /api/bootcamp/integrations/discord/events/cursor`
- `GET /api/bootcamp/integrations/discord/events?after_id=<id>&limit=<1..200>`
- `POST /api/bootcamp/integrations/discord/licenses/recompute`
- `GET /api/bootcamp/players/:steamId`
- `GET /api/bootcamp/challenge/current`

The event cursor, feed and license recomputation endpoints require
`Authorization: Bearer <BOOTCAMP_DISCORD_API_TOKEN>`. The public player and
challenge endpoints remain subject to the Bootcamp API feature flag. The Bot
does not query Bootcamp MariaDB tables directly.

Configure `BOOTCAMP_API_ENABLED=true` and a secret `BOOTCAMP_DISCORD_API_TOKEN`
in the website API environment. Configure the same token and `NONAME_URL` in
the Bot environment. Keep tokens out of Git, logs, screenshots and delivery
archives. The Bot watcher and challenge notifications also remain separately
disabled unless their own flags are enabled.

The event feed returns normalized camelCase fields and only Bootcamp replay
IDs. It filters records through the isolated Bootcamp schema; it does not
expose or mutate speedrun records. License recomputation is transactional and
uses the website's shared license evaluator. Do not run production migrations
or enable production flags as part of development verification.
