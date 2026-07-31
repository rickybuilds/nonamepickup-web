const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const uploader = fs.readFileSync(
  path.join(root, "scripts", "upload-pickup-replays.sh"),
  "utf8"
);
const service = fs.readFileSync(
  path.join(root, "deploy", "systemd", "tfc-pickup-replay-upload.service"),
  "utf8"
);
const timer = fs.readFileSync(
  path.join(root, "deploy", "systemd", "tfc-pickup-replay-upload.timer"),
  "utf8"
);

test("game-server uploader packages a fixed allowlist after a ready marker", () => {
  for (const name of [
    "roster.csv",
    "players.csv",
    "projectile_defs.csv",
    "projectiles.csv",
    "objective_defs.csv",
    "objectives.csv",
    "events.csv",
    "manifest.json"
  ]) {
    assert.match(uploader, new RegExp(`\\n\\s+${name.replace(".", "\\.")}`));
  }
  assert.match(uploader, /complete_marker=.*complete\.ready/);
  assert.match(uploader, /aborted_marker=.*aborted\.ready/);
  assert.match(uploader, /tar --zstd -C "\$round_dir" -cf "\$temporary"/);
  assert.doesNotMatch(uploader, /tar[^\n]+\$\(find/);
});

test("uploader keeps authentication out of arguments and verifies success identity", () => {
  assert.match(uploader, /curl --config "\$PICKUP_CURL_CONFIG"/);
  assert.doesNotMatch(uploader, /Authorization: Bearer/);
  assert.match(uploader, /"\$http_status" != "200" && "\$http_status" != "201"/);
  assert.match(uploader, /\.ok == true and \.matchId == \$match/);
  assert.match(uploader, /\.sha256 == \$sha/);
  assert.match(uploader, /\.byteSize \| tostring/);
  assert.match(uploader, /verifiedByUploader: true/);
});

test("systemd timer serializes recurring scans with a hardened one-shot", () => {
  assert.match(timer, /OnUnitActiveSec=1min/);
  assert.match(timer, /Persistent=true/);
  assert.match(service, /Type=oneshot/);
  assert.match(service, /UMask=0077/);
  assert.match(service, /StateDirectory=tfc-pickup-uploader/);
  assert.match(service, /StateDirectoryMode=0700/);
  assert.match(service, /NoNewPrivileges=true/);
  assert.match(uploader, /flock -n 9/);
});

test("retention cleanup is disabled by default and restricted to verified paths", () => {
  assert.match(uploader, /PICKUP_DELETE_AFTER_DAYS:-0/);
  assert.match(uploader, /\(\( PICKUP_DELETE_AFTER_DAYS > 0 \)\) \|\| return 0/);
  assert.match(uploader, /round_real.*==.*replay_root.*\/round-/);
  assert.match(uploader, /archive_real.*==.*spool_root.*archives.*round-.*tar\.zst/);
});
