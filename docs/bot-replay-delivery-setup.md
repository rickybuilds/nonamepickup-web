# Bot-triggered replay delivery setup

The bot uses one dedicated SSH private key to request uploads on game servers and imports on the web server. Each destination gets only the public key. Existing SSH credentials used for HLTV/log retrieval are unchanged. Enable this only after installing both helpers and authorizing the key.

## Generate once on the bot host

Run as the account that runs the bot (currently root):

```bash
install -d -m 700 /root/.ssh
# Choose a new filename if this key already exists; do not overwrite it.
ssh-keygen -t ed25519 -f /root/.ssh/tfc-replay-delivery -N '' -C tfcbot-replay-delivery
cat /root/.ssh/tfc-replay-delivery.pub
```

The private key stays on the bot host. A single public key can be authorized on every server. The `from` option restricts the **source** address to the bot's outbound IP, not the game server's IP. The destination IP is configured in the bot. A new game server still needs the helper, public-key authorization and verified SSH host key; knowing its IP alone does not establish trust.

## Each game server

Copy `deploy/tfc-replay-upload-command.sh` from this repository to the game server, then install it root-owned:

```bash
install -o root -g root -m 755 tfc-replay-upload-command.sh /usr/local/sbin/tfc-replay-upload-command
install -d -m 700 /root/.ssh
touch /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
```

Append this as **one line** to `/root/.ssh/authorized_keys`, replacing the source IP and entire public-key portion:

```text
from="BOT_OUTBOUND_IP",restrict,command="/usr/local/sbin/tfc-replay-upload-command" ssh-ed25519 PUBLIC_KEY_DATA tfcbot-replay-delivery
```

This key can only request `upload MATCH_ID`; no shell, SFTP, PTY or forwarding. The helper runs the existing service, waits for its result and requires verified non-quarantined receipts for both rounds. Existing receipts skip the upload scan on retry. The helper reads the existing root-owned `/etc/tfc/pickup-replay-uploader.env`. Keep that file and all helper parent directories unwritable by untrusted users. Root SSH key login must be permitted by the host's SSH policy (forced-command-only login is sufficient).

## Web server

Pull the website repository and install:

```bash
cd /var/www/tfcbot
git pull origin main
install -o root -g root -m 755 deploy/tfc-replay-maintenance-command.sh /usr/local/sbin/tfc-replay-maintenance-command
```

Add the same public key to root's authorized keys with the source IP restriction and this different forced command:

```text
from="BOT_OUTBOUND_IP",restrict,command="/usr/local/sbin/tfc-replay-maintenance-command" ssh-ed25519 PUBLIC_KEY_DATA tfcbot-replay-delivery
```

If bot and API share a host, a loopback SSH connection is supported; authorize its actual loopback source address instead. For IPv4 loopback use `from="127.0.0.1"` and `PICKUP_DELIVERY_WEB_HOST=127.0.0.1`. This key can only request `maintain MATCH_ID`. The helper uses the existing maintenance lock, imports up to 99 due rounds and confirms both requested rounds are ready. It uses `api/.env` for queue configuration; the checkout and lock paths match the existing production deployment.

The helper returns 73 with a diagnostic when another worker holds the lock, and 75 with the requested rounds' states when maintenance succeeds but those rounds are not ready. The bot retries these expected waits after 30 seconds without increasing failure backoff. If the bulk worker fails on another match, the helper still checks the requested match and succeeds when both requested rounds are ready. If they are not ready, worker failures retain their original exit status and output. Bot failure diagnostics include the exit code, signal, killed flag and bounded stdout/stderr tails.

When updating this behavior, rerun the `install` command above after pulling: the SSH forced command runs the installed copy in `/usr/local/sbin`, so pulling the repository alone does not update it. Pull/restart the bot as described below to enable the matching retry handling.

## Trust destination host keys

Populate the bot account's `/root/.ssh/known_hosts` with each game server and the web server. Compare host-key fingerprints against a trusted console before trusting them. `ssh-keyscan` can collect candidate keys but does not authenticate them. The integration requires `StrictHostKeyChecking=yes`; unknown or changed keys fail and retain the job for retry.

## Bot environment and activation

Add to the bot's existing environment:

```dotenv
PICKUP_DELIVERY_ENABLED=true
PICKUP_DELIVERY_SSH_KEY=/root/.ssh/tfc-replay-delivery
PICKUP_DELIVERY_KNOWN_HOSTS=/root/.ssh/known_hosts
PICKUP_DELIVERY_SSH_USER=root
PICKUP_DELIVERY_WEB_HOST=WEB_SERVER_IP
PICKUP_DELIVERY_WEB_USER=root
```

Game-server IPs come from existing `config/rcon.js` SSH settings (`HL_SSH_HOST`, `HL_SSH_HOST_CENTRAL`, `HL_SSH_HOST_WEST`). Optional `PICKUP_DELIVERY_SSH_PORT` overrides their SSH ports; `PICKUP_DELIVERY_WEB_PORT` defaults to 22.

After helpers, authorization and host keys are ready, disable the upload timer on **each game server** so it cannot independently upload during play:

```bash
systemctl disable --now tfc-pickup-replay-upload.timer
```

This stops only the timer; a running upload service is left alone. Restart the bot with its updated code and environment:

```bash
cd /root/tfcbot
git pull origin main
pm2 restart tfcbot --update-env
```

Keep the web-server maintenance cron enabled as recovery. Do not enable a minute-by-minute game-server timer alongside bot delivery.

## Behavior and operations

At round-two completion the bot saves a `finalize` job before awaiting recorder stop or recap/log processing. Recap completion releases it; both recording rows must be `ready` and the match must be `completed` before delivery starts. Jobs are stored in `pickup_replay_delivery_jobs` in the bot's existing SQLite database. Delivery polls every 30 seconds, checks active matches on pickup servers sharing the SSH host, and defers starting uploads during play. Unknown delivery/SSH failures retry with backoff up to 15 minutes. Unfinished delivery jobs resume after bot restarts; existing historical matches are not automatically added. After restart, finalize jobs can resume after their two-minute grace once recordings and match completion are confirmed. Recovery uses stored analytics: interrupted recap enrichment may need an explicit later reimport. An unconfirmed recorder stop leaves a finalize job pending until reconciliation restores ready rows; failed reporting also requires repairing match completion.

Once an upload starts it runs to completion. A new match is allowed to start, so a long upload can overlap that game. The bot never stops the upload service or blocks match start. The game server's deployed uploader version and receipts remain authoritative.

After receipt verification, the bot waits at least 35 seconds for maintenance's upload-age eligibility, then requests the web import. Import retries do not request another upload. Duplicate hooks preserve the existing delivery job. Logs use `[replay-delivery]` and include the match ID. Inspect jobs with:

```bash
sqlite3 -header -column /root/tfcbot/elo.db 'SELECT server_key,match_id,phase,attempts,last_error FROM pickup_replay_delivery_jobs ORDER BY updated_at DESC LIMIT 20;'
```

To requeue a finalized match after fixing recorder readiness or to add an existing match, restart the bot after running the following on its host (replace `central` and `DSFYVD` as appropriate). The normal upload path still checks receipts and defers during gameplay:

```bash
sqlite3 /root/tfcbot/elo.db "INSERT INTO pickup_replay_delivery_jobs(server_key,match_id,phase,updated_at) VALUES('central','DSFYVD','upload',strftime('%s','now')*1000) ON CONFLICT(server_key,match_id) DO UPDATE SET phase='upload',attempts=0,next_attempt=0,last_error=NULL;"
```

Only requeue after both round recordings are finalized. Avoid resetting a currently running delivery job. The bot uses the database configured by its existing matches store; adjust the example path if that differs.
