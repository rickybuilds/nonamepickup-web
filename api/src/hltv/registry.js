"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const Database = require("better-sqlite3");
const { Storage } = require("./storage");
const DAY = 86400000;
const OPEN = ["queued", "in_review", "escalated"];
const id = () => crypto.randomUUID();
function text(value, max = 2000) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("Invalid text");
  return value.trim();
}
class Registry {
  constructor({ root, database, publicRoot, maxBytes, minFreeBytes = 10737418240, manualRetentionEnabled = false }) {
    this.storage = new Storage(root, { publicRoot, maxBytes }); this.minFreeBytes = minFreeBytes;
    this.manualRetentionEnabled = manualRetentionEnabled === true;
    if (!database || !path.isAbsolute(database)) throw new Error("Absolute HLTV database path required");
    if (publicRoot && (database === path.resolve(publicRoot) || require("./storage").inside(path.resolve(publicRoot), path.resolve(database)))) throw new Error("HLTV database cannot be public");
    this.db = new Database(database, { timeout: 10000 });
    this.db.pragma("journal_mode = WAL"); this.db.pragma("foreign_keys = ON"); this.db.pragma("synchronous = FULL");
    this.db.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));
    if (this.db.prepare("SELECT MAX(version) AS v FROM hltv_schema").get().v !== 1) throw new Error("Unsupported HLTV schema");
  }
  close() { this.db.close(); }
  audit(demo, actor, action, details) { this.db.prepare("INSERT INTO hltv_audit(demo_id,actor,action,details,created_at) VALUES(?,?,?,?,?)").run(demo, actor, action, JSON.stringify(details), Date.now()); }
  alert(demo, kind) { this.db.prepare("INSERT INTO hltv_alerts(id,demo_id,kind,created_at) VALUES(?,?,?,?)").run(id(), demo, kind, Date.now()); }
  get(demoId) { const d = this.db.prepare("SELECT * FROM hltv_demos WHERE id=?").get(demoId); if (!d) throw new Error("Demo not found"); return d; }
  recoverFinalizedSource(originalId,input,actor) { return require("./sourceRecovery").recoverFinalizedSource(this,originalId,input,actor); }
  ingest(manifest) {
    if (manifest.version !== 1 || !Array.isArray(manifest.demos) || manifest.demos.length > 100) throw new Error("Invalid manifest");
    const match = text(manifest.match_id, 100), server = text(manifest.server, 100);
    return manifest.demos.map(input => {
      const file = this.storage.inspect(input.storage_key);
      const at = Number(input.recorded_at);
      if (!Number.isSafeInteger(at) || at < 1 || at > Date.now() + DAY) throw new Error("Invalid recording date");
      return this.db.transaction(() => {
        const existing = this.db.prepare("SELECT * FROM hltv_demos WHERE match_id=? AND server=? AND sha256=?").get(match, server, file.sha256);
        const owner = this.db.prepare("SELECT id AS demo_id FROM hltv_demos WHERE storage_key=? UNION ALL SELECT demo_id FROM hltv_copies WHERE storage_key=?").all(input.storage_key, input.storage_key);
        if (owner.some(row => row.demo_id !== existing?.id)) throw new Error("Storage key already owned by another demo");
        if (existing) {
          if (existing.file_status === "deleted") {
            this.db.prepare("DELETE FROM hltv_copies WHERE storage_key=? AND demo_id=?").run(input.storage_key, existing.id);
            this.db.prepare("UPDATE hltv_demos SET storage_key=?,file_status='available',deleted_at=NULL,analysis_status='unsupported',analysis_waiver=NULL,last_error=NULL WHERE id=?").run(input.storage_key, existing.id);
            this.audit(existing.id, "ingestion", "recording_restored", { sha256: file.sha256 });
            return this.get(existing.id);
          }
          if (existing.storage_key !== input.storage_key) {
            this.db.prepare("INSERT INTO hltv_copies(storage_key,demo_id,size_bytes) VALUES(?,?,?) ON CONFLICT(storage_key) DO UPDATE SET deleted_at=NULL").run(input.storage_key, existing.id, file.size);
            this.audit(existing.id, "ingestion", "duplicate_file_registered", { sha256: file.sha256 });
          }
          return existing;
        }
        const demoId = id(), days = this.db.prepare("SELECT days FROM hltv_policy WHERE class='normal'").get().days;
        this.db.prepare(`INSERT INTO hltv_demos(id,match_id,round_id,server,map,storage_key,filename,size_bytes,sha256,recorded_at,ingested_at,expires_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(demoId, match, input.round_id == null ? null : text(String(input.round_id), 100), server,
          manifest.map == null ? null : text(manifest.map, 100), input.storage_key, text(input.filename, 255), file.size, file.sha256, at, Date.now(), at + days * DAY);
        this.audit(demoId, "ingestion", "registered", { sha256: file.sha256 });
        return this.get(demoId);
      }).immediate();
    });
  }
  list({ status, search, offset = 0, limit = 50 } = {}) {
    return this.db.prepare(`SELECT d.*,c.priority,c.assigned_to,c.source,
      (SELECT COUNT(*) FROM hltv_holds h WHERE h.demo_id=d.id AND h.released_at IS NULL) AS active_holds,
      (SELECT status FROM hltv_upstream_runs u WHERE u.demo_id=d.id ORDER BY created_at DESC,id DESC LIMIT 1) AS upstream_status,
      (SELECT COUNT(*) FROM hltv_anomalies a WHERE a.demo_id=d.id) AS anomaly_count
      FROM hltv_demos d LEFT JOIN hltv_cases c ON c.demo_id=d.id
      WHERE (? IS NULL OR d.review_status=?) AND (? IS NULL OR d.match_id LIKE ? OR d.map LIKE ?)
      ORDER BY CASE c.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,d.recorded_at DESC LIMIT ? OFFSET ?`)
      .all(status || null, status || null, search || null, `%${search || ""}%`, `%${search || ""}%`, Math.max(1, Math.min(100, Number(limit) || 50)), Math.max(0, Number(offset) || 0));
  }
  detail(demoId) {
    return { ...this.get(demoId), case: this.db.prepare("SELECT * FROM hltv_cases WHERE demo_id=?").get(demoId) || null,
      recovered_source:this.db.prepare("SELECT recovered_demo_id,run_id FROM hltv_source_recoveries WHERE original_demo_id=?").get(demoId)||null,
      recovered_from:this.db.prepare("SELECT original_demo_id,source_filename FROM hltv_source_recoveries WHERE recovered_demo_id=?").get(demoId)||null,
      holds: this.db.prepare("SELECT * FROM hltv_holds WHERE demo_id=? AND released_at IS NULL").all(demoId),
      notes: this.db.prepare("SELECT * FROM hltv_notes WHERE demo_id=? ORDER BY created_at").all(demoId),
      anomalies: this.db.prepare("SELECT * FROM hltv_anomalies WHERE demo_id=? ORDER BY start_tick").all(demoId),
      gap_findings:this.db.prepare("SELECT id,created_at,data_json FROM hltv_gap_findings WHERE demo_id=? ORDER BY created_at,id").all(demoId),
      aim_markers:this.db.prepare("SELECT id,created_at,data_json FROM hltv_aim_markers WHERE demo_id=? ORDER BY created_at,id").all(demoId),
      runs: this.db.prepare("SELECT * FROM hltv_analysis_runs WHERE demo_id=? ORDER BY started_at DESC LIMIT 50").all(demoId),
      upstream_runs: this.db.prepare("SELECT id,status,created_at,finished_at,upstream_sha,error_code,result_json FROM hltv_upstream_runs WHERE demo_id=? ORDER BY created_at DESC,id DESC LIMIT 1").all(demoId),
      audit: this.db.prepare("SELECT * FROM hltv_audit WHERE demo_id=? ORDER BY id DESC LIMIT 200").all(demoId) };
  }
  hold(demoId, reason, actor) { const holdId = id(); this.db.prepare("INSERT INTO hltv_holds(id,demo_id,reason,created_by,created_at) VALUES(?,?,?,?,?)").run(holdId, demoId, reason, actor, Date.now()); return holdId; }
  openCase(demoId, source, priority, actor, reason) {
    this.db.prepare(`INSERT INTO hltv_cases(id,demo_id,source,status,priority,opened_by,opened_at) VALUES(?,?,?,'queued',?,?,?)
      ON CONFLICT(demo_id) DO UPDATE SET status='queued',priority=excluded.priority,closed_at=NULL,decision_reason=NULL`).run(id(), demoId, source, priority, actor, Date.now());
    this.db.prepare("UPDATE hltv_demos SET review_status='queued' WHERE id=?").run(demoId);
    this.hold(demoId, reason, actor); this.alert(demoId, source === "admin" ? "manual_flag" : "player_report");
  }
  action(demoId, action, data, actor) {
    return this.db.transaction(() => {
      const d = this.get(demoId);
      if (["deleted", "missing", "quarantined"].includes(d.file_status)) throw new Error("Demo unavailable; reconcile storage before changing review");
      // A hold can cancel a claimed deletion between its two transactions.
      // If unlink already happened, never pretend the missing bytes are held.
      if (d.file_status === "deleting") {
        this.storage.resolve(d.storage_key);
        this.db.prepare("UPDATE hltv_demos SET file_status='available' WHERE id=?").run(demoId);
      }
      const reason = ["flag", "report", "hold", "evidence", "release-hold", "status", "extend", "waive-analysis"].includes(action) ? text(data.reason) : null;
      switch (action) {
        case "flag": case "report": {
          const priority = data.priority || "high";
          if (!["low", "medium", "high"].includes(priority)) throw new Error("Invalid priority");
          if (OPEN.includes(d.review_status)) throw new Error("Demo already in review; add a hold or note");
          this.openCase(demoId, action === "report" ? "player_report" : "admin", priority, actor, reason);
          const days = this.db.prepare("SELECT days FROM hltv_policy WHERE class=?").get(priority).days;
          this.db.prepare("UPDATE hltv_demos SET retention_class=CASE WHEN retention_class='evidence' THEN retention_class ELSE ? END,expires_at=MAX(expires_at,?) WHERE id=?").run(priority, Date.now() + days * DAY, demoId); break;
        }
        case "hold": this.hold(demoId, reason, actor); break;
        case "evidence": this.storage.verify(d); this.hold(demoId, reason, actor); this.db.prepare("UPDATE hltv_demos SET retention_class='evidence' WHERE id=?").run(demoId); break;
        case "release-hold": {
          if (d.retention_class === "evidence") throw new Error("Evidence holds cannot be released by this interface");
          const changed = this.db.prepare("UPDATE hltv_holds SET released_at=?,released_by=?,release_reason=? WHERE id=? AND demo_id=? AND released_at IS NULL").run(Date.now(), actor, reason, text(data.hold_id, 100), demoId);
          if (!changed.changes) throw new Error("Active hold not found"); break;
        }
        case "claim": {
          if (!OPEN.includes(d.review_status)) throw new Error("Open a case first");
          const c = this.db.prepare("SELECT assigned_to FROM hltv_cases WHERE demo_id=?").get(demoId);
          if (c.assigned_to && c.assigned_to !== actor) throw new Error("Case already assigned");
          this.db.prepare("UPDATE hltv_cases SET assigned_to=?,status='in_review' WHERE demo_id=?").run(actor, demoId);
          this.db.prepare("UPDATE hltv_demos SET review_status='in_review' WHERE id=?").run(demoId); break;
        }
        case "status": {
          if (!["queued", "in_review", "dismissed", "confirmed", "escalated"].includes(data.status)) throw new Error("Invalid review status");
          if (!this.db.prepare("SELECT 1 FROM hltv_cases WHERE demo_id=?").get(demoId)) throw new Error("Open a case first");
          if (data.status === "confirmed") { this.storage.verify(d); this.hold(demoId, "Confirmed evidence: " + reason, actor); this.db.prepare("UPDATE hltv_demos SET retention_class='evidence' WHERE id=?").run(demoId); }
          this.db.prepare("UPDATE hltv_cases SET status=?,closed_at=?,decision_reason=? WHERE demo_id=?").run(data.status, OPEN.includes(data.status) ? null : Date.now(), reason, demoId);
          this.db.prepare("UPDATE hltv_demos SET review_status=? WHERE id=?").run(data.status, demoId); break;
        }
        case "note": {
          if (data.tick != null && (!Number.isSafeInteger(data.tick) || data.tick < 0)) throw new Error("Invalid tick");
          this.db.prepare("INSERT INTO hltv_notes(id,demo_id,author,note,tick,created_at) VALUES(?,?,?,?,?,?)").run(id(), demoId, actor, text(data.note, 4000), data.tick ?? null, Date.now()); break;
        }
        case "extend": {
          if (!Number.isSafeInteger(data.days) || data.days < 1 || data.days > 3650) throw new Error("Invalid retention days");
          this.db.prepare("UPDATE hltv_demos SET expires_at=MAX(expires_at,?)+? WHERE id=?").run(Date.now(), data.days * DAY, demoId); break;
        }
        case "waive-analysis": this.db.prepare("UPDATE hltv_demos SET analysis_waiver=? WHERE id=?").run(reason, demoId); break;
        case "policy": {
          if (!["normal", "low", "medium", "high"].includes(data.class) || !Number.isSafeInteger(data.days) || data.days < 1 || data.days > 3650) throw new Error("Invalid policy");
          this.db.prepare("UPDATE hltv_policy SET days=? WHERE class=?").run(data.days, data.class); break;
        }
        default: throw new Error("Unknown review action");
      }
      this.audit(demoId, actor, action, { before: { review_status: d.review_status, retention_class: d.retention_class, expires_at: d.expires_at }, ...data });
      return this.detail(demoId);
    }).immediate();
  }
  eligible(d, now) {
    const manualRoutine = this.manualRetentionEnabled && d.analysis_status === "unsupported" &&
      d.retention_class === "normal" && d.review_status === "unreviewed" && d.last_error == null &&
      !this.db.prepare("SELECT 1 FROM hltv_analysis_runs WHERE demo_id=?").get(d.id);
    return ["available", "deleting"].includes(d.file_status) && d.expires_at <= now &&
      (d.analysis_status === "complete" || Boolean(d.analysis_waiver) || manualRoutine) && d.retention_class !== "evidence" &&
      !this.db.prepare("SELECT 1 FROM hltv_holds WHERE demo_id=? AND released_at IS NULL").get(d.id) &&
      !this.db.prepare("SELECT 1 FROM hltv_upstream_runs WHERE demo_id=? AND status IN ('queued','processing')").get(d.id) &&
      !this.db.prepare("SELECT 1 FROM hltv_cases WHERE demo_id=? AND status IN ('queued','in_review','escalated')").get(d.id);
  }
  cleanup({ enabled = false, dryRun = true, now = Date.now(), actor = "cleanup", verifyFiles = true } = {}) {
    if (!verifyFiles && enabled && !dryRun) throw new Error("File verification required for deletion");
    const retentionMode = this.manualRetentionEnabled ? "manual_review" : "require_analysis";
    const result = { dry_run: dryRun || !enabled, files_verified: verifyFiles, retention_mode: retentionMode, eligible: 0, deleted: 0, errors: [], ids: [] };
    const candidates = this.db.prepare(`SELECT d.id FROM hltv_demos d WHERE file_status IN ('available','deleting') AND expires_at<=?
      AND (analysis_status='complete' OR analysis_waiver IS NOT NULL OR
        (?=1 AND analysis_status='unsupported' AND retention_class='normal' AND review_status='unreviewed'
          AND last_error IS NULL AND NOT EXISTS(SELECT 1 FROM hltv_analysis_runs r WHERE r.demo_id=d.id)))
      AND retention_class!='evidence'
      AND NOT EXISTS(SELECT 1 FROM hltv_holds h WHERE h.demo_id=d.id AND h.released_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM hltv_upstream_runs u WHERE u.demo_id=d.id AND u.status IN ('queued','processing'))
      AND NOT EXISTS(SELECT 1 FROM hltv_cases c WHERE c.demo_id=d.id AND c.status IN ('queued','in_review','escalated'))
      ORDER BY expires_at,id LIMIT 100`).all(now, this.manualRetentionEnabled ? 1 : 0);
    for (const candidate of candidates) {
      if (enabled && !dryRun) this.db.transaction(() => {
        const d = this.get(candidate.id);
        if (d.file_status !== "available" || !this.eligible(d, now)) return;
        try {
          // Verify existence before recording intent; pre-existing missing files
          // must never be reconciled as successful retention deletions.
          this.storage.resolve(d.storage_key);
          this.db.prepare("UPDATE hltv_demos SET file_status='deleting' WHERE id=?").run(d.id);
          this.audit(d.id, actor, "deletion_claimed", { sha256: d.sha256, retention_mode: retentionMode });
        } catch (error) {
          this.db.prepare("UPDATE hltv_demos SET last_error=? WHERE id=?").run(error.message, d.id);
        }
      }).immediate();
      this.db.transaction(() => {
      const d = this.get(candidate.id);
      if (!this.eligible(d, now)) {
        if (d.file_status === "deleting") {
          this.db.prepare("UPDATE hltv_demos SET file_status='available' WHERE id=?").run(d.id);
          this.audit(d.id, actor, "deletion_cancelled", {});
        }
        return;
      }
      if (enabled && !dryRun && d.file_status !== "deleting") return;
      if (!verifyFiles) { result.eligible++; result.ids.push(d.id); return; }
      try {
        let file;
        const copies = this.db.prepare("SELECT * FROM hltv_copies WHERE demo_id=? AND deleted_at IS NULL").all(d.id);
        const verifiedCopies = [];
        for (const copy of copies) {
          try { verifiedCopies.push({ copy, file: this.storage.verify({ ...d, storage_key: copy.storage_key, size_bytes: copy.size_bytes }) }); }
          catch (error) { if (!(d.file_status === "deleting" && error.code === "ENOENT")) throw error; }
        }
        try { file = this.storage.verify(d); } catch (error) {
          // Recovery after a committed 'deleting' marker and completed unlink.
          if (d.file_status === "deleting" && error.code === "ENOENT" && enabled && !dryRun) {
            for (const copy of verifiedCopies) fs.unlinkSync(copy.file.path);
            this.db.prepare("UPDATE hltv_copies SET deleted_at=? WHERE demo_id=? AND deleted_at IS NULL").run(now, d.id);
            this.db.prepare("UPDATE hltv_demos SET file_status='deleted',deleted_at=? WHERE id=?").run(now, d.id);
            this.audit(d.id, actor, "deletion_reconciled", {}); return;
          }
          throw error;
        }
        result.eligible++; result.ids.push(d.id);
        if (!enabled || dryRun) return;
        // IMMEDIATE writer lock stays held through unlink: holds/case writes cannot interleave.
        const named = fs.lstatSync(this.storage.resolve(d.storage_key));
        if (named.ino !== file.ino || named.dev !== file.dev || !this.eligible(this.get(d.id), now)) throw new Error("Deletion identity changed");
        for (const copy of verifiedCopies) fs.unlinkSync(copy.file.path);
        this.db.prepare("UPDATE hltv_copies SET deleted_at=? WHERE demo_id=? AND deleted_at IS NULL").run(now, d.id);
        fs.unlinkSync(file.path);
        this.db.prepare("UPDATE hltv_demos SET file_status='deleted',deleted_at=?,last_error=NULL WHERE id=?").run(now, d.id);
        this.audit(d.id, actor, "deleted", { sha256: d.sha256, retention_mode: retentionMode }); result.deleted++;
      } catch (error) {
        this.db.prepare("UPDATE hltv_demos SET last_error=? WHERE id=?").run(error.message, d.id);
        result.errors.push({ id: d.id, error: error.message });
      }
      }).immediate();
    }
    return result;
  }
  summary() {
    const totals = this.db.prepare(`SELECT COUNT(*) AS demos,COALESCE(SUM(CASE WHEN file_status='available' THEN size_bytes ELSE 0 END),0) AS available_bytes,
      SUM(CASE WHEN analysis_status!='complete' AND analysis_waiver IS NULL AND NOT
        (?=1 AND analysis_status='unsupported' AND retention_class='normal' AND review_status='unreviewed'
          AND last_error IS NULL AND NOT EXISTS(SELECT 1 FROM hltv_analysis_runs r WHERE r.demo_id=d.id))
        THEN 1 ELSE 0 END) AS analysis_blocked,
      SUM(CASE WHEN review_status IN ('queued','in_review','escalated') THEN 1 ELSE 0 END) AS open_reviews FROM hltv_demos d`).get(this.manualRetentionEnabled ? 1 : 0);
    const free = this.storage.freeBytes();
    const copyBytes = this.db.prepare("SELECT COALESCE(SUM(size_bytes),0) AS n FROM hltv_copies WHERE deleted_at IS NULL").get().n;
    return { ...totals, available_bytes: totals.available_bytes + copyBytes, duplicate_bytes: copyBytes, free_bytes: free, low_disk: free < this.minFreeBytes,
      protected_bytes: this.db.prepare("SELECT COALESCE(SUM(size_bytes + (SELECT COALESCE(SUM(c.size_bytes),0) FROM hltv_copies c WHERE c.demo_id=d.id AND c.deleted_at IS NULL)),0) AS n FROM hltv_demos d WHERE file_status IN ('available','deleting') AND (retention_class='evidence' OR EXISTS(SELECT 1 FROM hltv_holds h WHERE h.demo_id=d.id AND released_at IS NULL))").get().n,
      failed_manifests: this.db.prepare("SELECT COUNT(*) AS n FROM hltv_manifests WHERE status='failed'").get().n,
      stalled_alerts: this.db.prepare("SELECT COUNT(*) AS n FROM hltv_alerts WHERE sent_at IS NULL AND attempts>=12 AND id NOT IN(SELECT alert_id FROM hltv_alert_suppressions)").get().n,
      pending_alerts: this.db.prepare("SELECT COUNT(*) AS n FROM hltv_alerts WHERE sent_at IS NULL AND id NOT IN(SELECT alert_id FROM hltv_alert_suppressions)").get().n,
      policy: this.db.prepare("SELECT * FROM hltv_policy").all(),
      retention_mode: this.manualRetentionEnabled ? "manual_review" : "require_analysis",
      analyzer: "not_integrated", viewer: "not_integrated" };
  }
}
module.exports = { Registry, DAY, text };
