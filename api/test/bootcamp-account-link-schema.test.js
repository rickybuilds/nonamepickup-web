"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { ensureBootcampAccountLinkSchema } = require("../src/db/bootcampAccountLinkSchema");

test("account-link schema is idempotent and enforces unique outbox work", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(fs.readFileSync(path.resolve(__dirname, "../migrations/004_bootcamp_account_linking.sql"), "utf8"));
    ensureBootcampAccountLinkSchema(db);
    ensureBootcampAccountLinkSchema(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'bootcamp_account_link_%'").all().map(row => row.name).sort();
    assert.deepEqual(tables, ["bootcamp_account_link_flows", "bootcamp_account_link_outbox"]);
    assert.throws(() => db.prepare("INSERT INTO bootcamp_account_link_flows(state_hash,step,expires_at,created_at) VALUES('state','invalid',100,1)").run(), /CHECK constraint failed/);
    db.prepare(`INSERT INTO bootcamp_account_link_outbox(discord_id,steam_id,status,attempts,next_attempt_at,created_at,updated_at)
      VALUES('discord','STEAM_0:1:4','pending',0,1,1,1)`).run();
    assert.throws(() => db.prepare(`INSERT INTO bootcamp_account_link_outbox(discord_id,steam_id,status,attempts,next_attempt_at,created_at,updated_at)
      VALUES('discord','STEAM_0:1:4','pending',0,1,1,1)`).run(), /UNIQUE constraint failed/);
  } finally { db.close(); }
});
