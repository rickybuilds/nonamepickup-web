"use strict";
const crypto = require("crypto");
const { promisify } = require("util");
const scrypt = promisify(crypto.scrypt);
const SESSION_MS = 8 * 60 * 60 * 1000, WINDOW_MS = 15 * 60 * 1000;
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const fail = (status, code) => Object.assign(new Error(code), { status, publicCode: code });
let hashing = 0;
async function derive(password, salt) {
  if (hashing >= 2) throw fail(503, "login_busy_try_again");
  hashing++;
  try { return await scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }); }
  finally { hashing--; }
}
function passwordInput(value) {
  if (typeof value !== "string" || value.length < 6 || value.length > 128 || Buffer.byteLength(value) > 512)
    throw fail(400, "password_must_be_6_to_128_characters");
  return value;
}
function usernameInput(value) {
  const name = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(name)) throw fail(400, "username_must_be_3_to_32_letters_numbers_dots_dashes_or_underscores");
  return name;
}
async function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt$${salt}$${(await derive(passwordInput(password), salt)).toString("hex")}`;
}
async function verifyPassword(password, stored) {
  const valid = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(stored || "");
  const candidate = await derive(password, valid?.[1] || "0".repeat(32));
  return crypto.timingSafeEqual(candidate, Buffer.from(valid?.[2] || "0".repeat(128), "hex")) && !!valid;
}
class ReviewerAccounts {
  constructor(registry, env = process.env) {
    this.registry = registry; this.db = registry.db;
    this.enabled = env.HLTV_REVIEW_ACCOUNTS_ENABLED === "true";
    this.owners = new Set((env.HLTV_REVIEW_OWNER_USER_IDS || "").split(",").map(x => x.trim()).filter(Boolean));
    if ([...this.owners].some(id => !/^\d{17,20}$/.test(id))) throw new Error("Invalid HLTV owner IDs");
  }
  isOwner(actor) { return this.enabled && this.owners.has(actor); }
  requireOwner(actor) { if (!this.isOwner(actor)) throw fail(403, "owner_access_required"); }
  publicUser(row) { return { id: row.id, username: row.username, user_id: row.actor, is_owner: this.isOwner(row.actor), disabled: !!row.disabled, must_change_password: !!row.must_change_password }; }
  list(actor) { this.requireOwner(actor); return this.db.prepare("SELECT * FROM hltv_review_users ORDER BY username").all().map(row => this.publicUser(row)); }
  throttle(scopes) {
    this.db.transaction(() => {
      const now = Date.now(); this.db.prepare("DELETE FROM hltv_review_login_limits WHERE expires_at<=?").run(now);
      for (const [scope, max] of scopes) if ((this.db.prepare("SELECT attempts FROM hltv_review_login_limits WHERE scope=?").get(scope)?.attempts || 0) >= max) throw fail(429, "too_many_login_attempts_wait_15_minutes");
      for (const [scope] of scopes) this.db.prepare("INSERT INTO hltv_review_login_limits(scope,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(scope) DO UPDATE SET attempts=attempts+1").run(scope, now + WINDOW_MS);
    }).immediate();
  }
  session(user) {
    const now = Date.now(), token = crypto.randomBytes(32).toString("hex");
    this.db.prepare("DELETE FROM hltv_review_sessions WHERE expires_at<=?").run(now);
    this.db.prepare("DELETE FROM hltv_review_sessions WHERE token_hash IN(SELECT token_hash FROM hltv_review_sessions WHERE user_id=? ORDER BY created_at DESC LIMIT -1 OFFSET 4)").run(user.id);
    this.db.prepare("INSERT INTO hltv_review_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)").run(hash(token), user.id, now, now + SESSION_MS);
    return { token, expires_at: now + SESSION_MS, user_id: user.actor, username: user.username, must_change_password: !!user.must_change_password, can_manage_users: this.isOwner(user.actor) };
  }
  authenticate(token) {
    if (!this.enabled || !/^[a-f0-9]{64}$/.test(token || "")) return null;
    return this.db.prepare("SELECT u.* FROM hltv_review_sessions s JOIN hltv_review_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0").get(hash(token), Date.now()) || null;
  }
  logout(token) { if (token) this.db.prepare("DELETE FROM hltv_review_sessions WHERE token_hash=?").run(hash(token)); }
  async login(input, ip) {
    if (!this.enabled) throw fail(404, "account_login_disabled");
    const username = typeof input.username === "string" ? input.username.trim().toLowerCase().slice(0, 128) : "";
    this.throttle([["name:" + hash(username), 10], ["ip:" + hash(String(ip)), 60]]);
    const user = this.db.prepare("SELECT * FROM hltv_review_users WHERE username=?").get(username);
    const password = typeof input.password === "string" && input.password.length <= 128 ? input.password : "";
    const valid = await verifyPassword(password, user?.password_hash);
    if (!valid || !user || user.disabled) throw fail(401, "invalid_username_or_password");
    return this.db.transaction(() => {
      const current = this.db.prepare("SELECT * FROM hltv_review_users WHERE id=?").get(user.id);
      if (!current || current.disabled || current.password_hash !== user.password_hash) throw fail(401, "invalid_username_or_password");
      this.db.prepare("DELETE FROM hltv_review_login_limits WHERE scope=?").run("name:" + hash(username));
      this.registry.audit(null, user.actor, "reviewer_login", { account_id: user.id });
      return this.session(current);
    }).immediate();
  }
  async create(input, actor) {
    this.requireOwner(actor);
    const username = usernameInput(input.username), id = crypto.randomUUID();
    const discord = typeof input.discord_id === "string" ? input.discord_id.trim() : "";
    if (discord && !/^\d{17,20}$/.test(discord)) throw fail(400, "invalid_discord_user_id");
    const identity = discord || "reviewer:" + id, password = await passwordHash(input.password);
    return this.db.transaction(() => {
      if (this.db.prepare("SELECT 1 FROM hltv_review_users WHERE username=? OR actor=?").get(username, identity)) throw fail(409, "username_or_discord_id_already_used");
      const now = Date.now(); this.db.prepare("INSERT INTO hltv_review_users(id,username,actor,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(id, username, identity, password, now, now);
      this.registry.audit(null, actor, "reviewer_created", { account_id: id, username, user_id: identity });
      return this.publicUser(this.db.prepare("SELECT * FROM hltv_review_users WHERE id=?").get(id));
    }).immediate();
  }
  async changePassword(user, token, input) {
    this.throttle([["change:" + user.id, 10]]);
    const next = passwordInput(input.new_password);
    if (typeof input.current_password !== "string" || input.current_password.length > 128 || !await verifyPassword(input.current_password, user.password_hash)) throw fail(400, "current_password_incorrect");
    if (next === input.current_password) throw fail(400, "choose_a_different_password");
    const password = await passwordHash(next);
    return this.db.transaction(() => {
      const current = this.authenticate(token);
      if (!current || current.password_hash !== user.password_hash) throw fail(401, "sign_in_again");
      this.db.prepare("UPDATE hltv_review_users SET password_hash=?,must_change_password=0,updated_at=? WHERE id=?").run(password, Date.now(), user.id);
      this.db.prepare("DELETE FROM hltv_review_sessions WHERE user_id=?").run(user.id);
      this.registry.audit(null, user.actor, "reviewer_password_changed", { account_id: user.id });
      return this.session({ ...current, must_change_password: 0 });
    }).immediate();
  }
  async reset(id, input, actor) {
    this.requireOwner(actor); const password = await passwordHash(input.password);
    return this.db.transaction(() => {
      if (!this.db.prepare("SELECT 1 FROM hltv_review_users WHERE id=?").get(id)) throw fail(404, "reviewer_not_found");
      this.db.prepare("UPDATE hltv_review_users SET password_hash=?,must_change_password=1,updated_at=? WHERE id=?").run(password, Date.now(), id);
      this.db.prepare("DELETE FROM hltv_review_sessions WHERE user_id=?").run(id);
      this.registry.audit(null, actor, "reviewer_password_reset", { account_id: id }); return { ok: true };
    }).immediate();
  }
  disable(id, actor) {
    this.requireOwner(actor);
    return this.db.transaction(() => {
      const user = this.db.prepare("SELECT * FROM hltv_review_users WHERE id=?").get(id);
      if (!user) throw fail(404, "reviewer_not_found");
      if (this.isOwner(user.actor)) throw fail(400, "owner_account_cannot_be_disabled_here");
      this.db.prepare("UPDATE hltv_review_users SET disabled=1,updated_at=? WHERE id=?").run(Date.now(), id);
      this.db.prepare("DELETE FROM hltv_review_sessions WHERE user_id=?").run(id);
      this.registry.audit(null, actor, "reviewer_disabled", { account_id: id }); return { ok: true };
    }).immediate();
  }
}
module.exports = { ReviewerAccounts };
