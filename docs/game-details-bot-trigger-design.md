# Bot-triggered replay uploads

The Discord bot requests replay delivery after the second round has stopped successfully and the match report/log processing has finished. Picking teams and voting for the next map continue normally. Uploads already running are never stopped and do not block a new match.

The bot saves a durable delivery job at round-two completion before awaiting finalization/recap processing. Once both recordings are ready, the match is completed and the recap finishes, it uses the existing game-server SSH host with a dedicated key to start `tfc-pickup-replay-upload.service`, and waits for a successful service result plus verified receipts. A successful upload scan then triggers the web-server maintenance worker under `/root/tfcbot/game-details-maintenance.lock`. Maintenance must run on the web server; its execution host is configured explicitly rather than inferred from the bot's working directory.

Before beginning a deferred upload, check for an active match on every configured pickup server sharing that SSH host. Defer while a match is underway. Serialize delivery per host. Persist unfinished jobs across bot restarts, and retry failures with bounded backoff. Do not interpret an interrupted SSH connection as successful delivery.

The game-server hourly uploader timer must be disabled when bot delivery is enabled, otherwise it could still start during gameplay. Keep the web-server five-minute maintenance cron as recovery. Do not remove uploader receipts or source archives as part of this integration.

Uploads can overlap the next game if they take longer than the team-picking interval, because the chosen policy neither stops uploads nor blocks match starts. Log upload and maintenance results with match and server identifiers. Explicit deployment settings must identify the web-server execution host and authorize the game-server service command.

No test files or test runs are authorized. Validate syntax and review changes, then commit and push the affected repositories. Production service/timer changes are documented for deployment.
