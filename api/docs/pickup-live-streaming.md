# Pickup live streaming

The live viewer uses the same AMX Mod X replay CSV output as completed replays, including the actively growing `.csv.part` files. A small process on each game server tails complete CSV lines and sends authenticated batches to the website API. The API keeps a rolling in-memory buffer and publishes new batches to browsers over Server-Sent Events (SSE).

The identity is explicit throughout the path:

```text
PICKUP_SERVER_ID=east + match TNQXH6 + round 1
  -> /api/pickup-live/ingest request headers
  -> east:TNQXH6:1 API stream
  -> pickup-live.html?server=east&matchId=TNQXH6&round=1
```

No player or spectator has to occupy the TFC server. The forwarder only reads the telemetry files that the replay plugin already writes.

## Website API configuration

The live endpoint uses the existing `PICKUP_UPLOAD_TOKEN` for game-server authentication. These optional settings control the rolling feed:

| Setting | Default | Meaning |
| --- | ---: | --- |
| `PICKUP_LIVE_BUFFER_SECONDS` | `120` | Recent batch history retained for new viewers |
| `PICKUP_LIVE_STALE_SECONDS` | `30` | Time without a batch before metadata reports the feed as stale |
| `PICKUP_LIVE_MAX_BATCH_BYTES` | `1048576` | Maximum decoded CSV data in one ingest batch |

Deploy and restart the website API before starting the forwarder. Live buffers are intentionally in memory; after an API restart the forwarder receives a conflict, creates a new stream, and retransmits the active round.

If nginx proxies the API, disable buffering for the SSE endpoint. Keep the normal proxy headers used elsewhere in the site:

```nginx
location ~ ^/api/pickup-live/viewer/.+/events$ {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
}
```

The application also sends `X-Accel-Buffering: no`, but the proxy configuration makes the behavior unambiguous.

## Install the EAST forwarder

Run these from a checkout containing this repository:

```sh
install -D -m 755 scripts/stream-pickup-live \
  /usr/local/sbin/stream-pickup-live
install -D -m 644 deploy/systemd/tfc-pickup-live-forwarder.service \
  /etc/systemd/system/tfc-pickup-live-forwarder.service
install -D -m 600 deploy/systemd/pickup-live-forwarder.env.example \
  /etc/tfc/pickup-live-forwarder.env
```

Edit `/etc/tfc/pickup-live-forwarder.env` and set:

```ini
PICKUP_REPLAY_ROOT=/root/steamcmd/tfc/tfc/addons/amxmodx/data/pickup_replays
PICKUP_LIVE_INGEST_URL=https://your-site.example/api/pickup-live/ingest
PICKUP_SERVER_ID=east
PICKUP_CURL_CONFIG=/root/.config/tfc/pickup-upload.curl
```

Authentication stays in the existing root-only curl configuration. It must have mode `0600` and contain the bearer header used by completed replay uploads:

```text
header = "Authorization: Bearer YOUR_HIGH_ENTROPY_TOKEN"
```

Start the service:

```sh
systemctl daemon-reload
systemctl enable --now tfc-pickup-live-forwarder.service
systemctl status tfc-pickup-live-forwarder.service --no-pager
journalctl -u tfc-pickup-live-forwarder.service -f
```

For the current round, a successful log begins with lines similar to:

```text
[pickup-live-forwarder] watching /root/steamcmd/tfc/tfc/addons/amxmodx/data/pickup_replays as east
[pickup-live-forwarder] discovered east:TNQXH6:1 schema 5
```

Open the feed directly with:

```text
/pickup-live.html?server=east&matchId=TNQXH6&round=1
```

The LIVE page also creates this URL automatically from each active server state. If the page says that no live feed is running, check the forwarder journal, the ingest URL, the shared token, and that the API was deployed before the service started.
