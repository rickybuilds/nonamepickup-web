# FFL — install under /ffl/

This is the app for **https://nonamepickup.servehalflife.com/ffl/**, committed directly to the nonamepickup-web repository. It has no npm dependencies or build step. It uses a dedicated Node 24 runtime and a shared SQLite database, leaving the pickup bot on port 4000 alone.

Included: 29 imported players, foo marked **Ringer only** and not a captain/co-captain, Saturday/Sunday percentages, computed averages, notes, CSV export, public player submissions, password-protected editing/deletion, password changes, Teams 1–6, adding teams, and admin-only drafting/moving players.

## 1. Pull and install

SSH into the server and enter your normal nonamepickup-web checkout. Then:

```sh
git pull --ff-only
sudo bash scripts/install-ffl.sh
```

If required commands are missing, install these packages (Debian/Ubuntu with systemd), then rerun the installer:

```sh
sudo apt-get update
sudo apt-get install -y curl xz-utils ca-certificates
```

The installer downloads a checksum-verified Node 24.22.1 from nodejs.org into `/opt/ffl/runtime/`. It does **not** replace your server's Node or change tfcbot. It installs:

- Public files: `/var/www/tfcbot/ffl/`
- Backend: `/opt/ffl/server.mjs` and `/opt/ffl/lib/`
- Database: `/var/lib/ffl/league.sqlite` (outside the web root)
- Initial secret/configuration: `/etc/ffl.env` (root-readable only)
- Service: `ffl`, listening only on `127.0.0.1:4010`

Port 4010 must be unused by another application. No firewall opening is needed. Your website's existing `/api/` routes remain on port 4000. Re-running the installer preserves the database, password, players and team assignments, including an installation made using the earlier ZIP package. For future updates, repeat `git pull --ff-only` and `sudo bash scripts/install-ffl.sh`.

Repository layout: `ffl/` contains only browser assets; `api/src/ffl/` contains the backend and initial roster; `scripts/install-ffl.sh` installs/updates it. No database or credentials are committed.

## 2. Alter tfcbot.conf

Find your enabled configuration if you are unsure of its path:

```sh
sudo nginx -T 2>&1 | less
```

It is commonly `/etc/nginx/sites-available/tfcbot.conf`. Use your actual path in these commands:

`deploy/nginx/ffl.conf` contains only the new locations. Add these to the existing configuration rather than replacing unrelated server settings.

```sh
sudo cp /etc/nginx/sites-available/tfcbot.conf /etc/nginx/sites-available/tfcbot.conf.ffl-backup
sudo nano /etc/nginx/sites-available/tfcbot.conf
```

Paste the following **inside the existing `server { ... }` block**, for example immediately before your `location = /refactor` block. Add it once. Leave all existing locations and SSL lines intact. The backslashes and `&#x20;` from the chat formatting are not part of the configuration.

```nginx
location = /ffl {
    return 301 https://nonamepickup.servehalflife.com/ffl/;
}

location ^~ /ffl/ {
    if ($scheme = http) {
        return 301 https://nonamepickup.servehalflife.com$request_uri;
    }

    client_max_body_size 16k;
    proxy_pass http://127.0.0.1:4010;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
    proxy_connect_timeout 5s;
    proxy_read_timeout 30s;
    proxy_no_cache 1;
    proxy_cache_bypass 1;
}
```

Do not put a trailing `/` after `4010` in `proxy_pass`: the backend expects the full `/ffl/` prefix. `/ffl/api/league` is intentionally under `/ffl/`, so it does not interfere with your existing `/api/` proxy. The `^~` also keeps the site's generic `.html` regex from intercepting FFL assets. This follows [Nginx proxy_pass URI handling](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass).

Save, then test before reloading:

```sh
sudo nginx -t
sudo systemctl reload nginx
curl -I https://nonamepickup.servehalflife.com/ffl/
```

Only run the reload after `nginx -t` succeeds. If it fails, correct the reported line or restore the backup before reloading.

## 3. Log in and draft

Find your randomly generated initial password:

```sh
sudo grep '^FFL_INITIAL_PASSWORD=' /etc/ffl.env
```

Open **https://nonamepickup.servehalflife.com/ffl/**, choose **Admin login**, and enter the value after `=`. Then use **Change password** to set one you prefer (minimum 6 characters). This signs out all admin sessions. The initial password is not in the website's source or visible to visitors; it only works until you change it.

- **Players:** anyone can add an entry; saved entries can only be changed by an admin. Duplicate names are rejected.
- **Teams:** choose a player in a team's **Add a player…** menu, or choose a team beside an unassigned player. Move someone by changing their team dropdown. Choose **Unassigned** to undo a draft assignment.
- **Add team:** creates another team with any name you choose. It starts with Team 1 through Team 6.
- **Ringers:** clearly marked; their percentages are indicative availability, not regular-season commitments. foo's prior 50%/75% is retained with the new ringer status.
- **Export CSV:** downloads players, availability, roles, team assignments and notes.
- **Schedule:** everyone can view 21 regular weeks and Week 22 finals. The initial map order includes the 5v5/7v7 alternatives and finals games on Magelli and Cranked. Dates and matchups start as TBD.
- **Edit week (admins only):** open Schedule, choose Edit beside a week, then change its maps, date and team matchups. Dates are usually Saturdays but any day is allowed; clear a date to return it to TBD. Add a matchup and select its two teams, or remove a pairing to leave those teams unscheduled. A team cannot play itself or appear twice in the same week. Finals use the same pairings for both games. Save week publishes the changes to everyone.

Schedule updates are enforced by the backend's existing admin session. The installer adds the schedule tables automatically on startup and preserves saved maps, dates, pairings, players and team assignments on future updates.

Sessions last 12 hours. Login and public submission limits reduce casual spam. No player account or email address is needed. If multiple people use the shared admin password, they all have admin access.

## Maintenance

```sh
sudo systemctl status ffl --no-pager
sudo journalctl -u ffl -n 50 --no-pager
```

If you get **502 Bad Gateway**, check that `ffl` is running and `curl http://127.0.0.1:4010/ffl/api/league` works. If login gives an origin error, use the exact HTTPS domain above. For a domain change, update `FFL_PUBLIC_ORIGIN` in `/etc/ffl.env` and the Nginx redirects, then restart `ffl` and test/reload Nginx.

Back up the database with the service briefly stopped so the SQLite WAL is safely checkpointed:

```sh
sudo systemctl stop ffl
sudo cp /var/lib/ffl/league.sqlite /var/lib/ffl/league-backup.sqlite
sudo systemctl start ffl
```

Store a copy of the backup off-server too. The database includes password hashes and team assignments; keep backups private. CSV exports are for roster reference, not a full restore.

To reset a forgotten admin password without losing roster data, first edit `FFL_INITIAL_PASSWORD` in `/etc/ffl.env` to a new unique value (6–100 characters). Then:

```sh
sudo systemctl stop ffl
sudo /opt/ffl/runtime/bin/node --input-type=module -e "import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync('/var/lib/ffl/league.sqlite'); db.exec(\"BEGIN; DELETE FROM settings WHERE key='password'; DELETE FROM sessions; COMMIT;\"); db.close();"
sudo systemctl start ffl
```

The service will hash the new initial password on restart; it does not re-import deleted players. Never delete `/var/lib/ffl/league.sqlite` unless you intend to reset the entire app.

## Verification

The original standalone implementation passed six tests before integration. Repository instructions prohibit adding or running tests unless explicitly requested, so no test files were added here and no repository tests were run. JavaScript syntax was checked with Node 24. Linux service/Nginx installation must still be verified on your server.

The weekly schedule and matchup changes passed Node 24 syntax checks and `git diff --check`. A local preview started successfully with a temporary in-memory database. Browser visual verification could not be completed because the browser tool timed out connecting to the local preview.
