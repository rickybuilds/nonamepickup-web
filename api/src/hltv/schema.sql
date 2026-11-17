PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS hltv_gap_findings(
 id TEXT PRIMARY KEY,demo_id TEXT NOT NULL REFERENCES hltv_demos(id),observation_id TEXT NOT NULL REFERENCES hltv_statistics_observations(id),
 alert_id TEXT NOT NULL REFERENCES hltv_alerts(id),created_at INTEGER NOT NULL,data_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS hltv_gap_alert ON hltv_gap_findings(alert_id);
CREATE TABLE IF NOT EXISTS hltv_upstream_heartbeats(run_id TEXT PRIMARY KEY REFERENCES hltv_upstream_runs(id),touched_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS hltv_statistics_jobs(
 demo_id TEXT PRIMARY KEY REFERENCES hltv_demos(id), run_id TEXT UNIQUE REFERENCES hltv_upstream_runs(id),
 created_at INTEGER NOT NULL, skip_reason TEXT
);
CREATE TABLE IF NOT EXISTS hltv_statistics_observations(
 id TEXT PRIMARY KEY, input_key TEXT NOT NULL, config_hash TEXT NOT NULL, demo_id TEXT NOT NULL REFERENCES hltv_demos(id),
 run_id TEXT NOT NULL, match_id TEXT NOT NULL, server TEXT NOT NULL, map TEXT NOT NULL, recorded_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL, upstream_sha TEXT NOT NULL, demo_sha256 TEXT NOT NULL, log_sha256 TEXT NOT NULL,
 log_round INTEGER NOT NULL, payload_sha256 TEXT NOT NULL REFERENCES hltv_statistics_payloads(sha256), UNIQUE(input_key,config_hash)
);
CREATE TABLE IF NOT EXISTS hltv_statistics_payloads(sha256 TEXT PRIMARY KEY,result_gzip BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS hltv_statistics_results(run_id TEXT PRIMARY KEY,observation_id TEXT NOT NULL REFERENCES hltv_statistics_observations(id),payload_sha256 TEXT NOT NULL REFERENCES hltv_statistics_payloads(sha256),created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS hltv_statistics_history ON hltv_statistics_observations(config_hash,recorded_at);
CREATE TABLE IF NOT EXISTS hltv_player_statistics(
 observation_id TEXT NOT NULL REFERENCES hltv_statistics_observations(id), steam_id TEXT NOT NULL, player_name TEXT,
 class_id INTEGER NOT NULL, weapon TEXT NOT NULL, state TEXT NOT NULL, complete INTEGER NOT NULL,
 recorded INTEGER NOT NULL, eligible INTEGER NOT NULL, no_enemy INTEGER NOT NULL, unavailable INTEGER NOT NULL,
 uncertain INTEGER NOT NULL, geometry_hit INTEGER NOT NULL, aim_near INTEGER NOT NULL, strict INTEGER NOT NULL,
 inclusive INTEGER NOT NULL, evidence_eligible INTEGER NOT NULL,
 PRIMARY KEY(observation_id,steam_id,class_id,weapon,state)
);
CREATE INDEX IF NOT EXISTS hltv_statistics_player ON hltv_player_statistics(steam_id,class_id,weapon,state);
CREATE TABLE IF NOT EXISTS hltv_schema(version INTEGER PRIMARY KEY);
INSERT OR IGNORE INTO hltv_schema VALUES(1);
CREATE TABLE IF NOT EXISTS hltv_demos(
 id TEXT PRIMARY KEY, match_id TEXT NOT NULL, round_id TEXT, server TEXT NOT NULL, map TEXT,
 storage_key TEXT NOT NULL UNIQUE, filename TEXT NOT NULL, size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL,
 recorded_at INTEGER NOT NULL, ingested_at INTEGER NOT NULL,
 analysis_status TEXT NOT NULL DEFAULT 'unsupported', review_status TEXT NOT NULL DEFAULT 'unreviewed',
 file_status TEXT NOT NULL DEFAULT 'available', retention_class TEXT NOT NULL DEFAULT 'normal',
 expires_at INTEGER NOT NULL, deleted_at INTEGER, last_error TEXT, analysis_waiver TEXT,
 UNIQUE(match_id,server,sha256)
);
CREATE INDEX IF NOT EXISTS hltv_expiry ON hltv_demos(file_status,expires_at);
CREATE INDEX IF NOT EXISTS hltv_match ON hltv_demos(match_id,round_id);
CREATE TABLE IF NOT EXISTS hltv_copies(
 storage_key TEXT PRIMARY KEY, demo_id TEXT NOT NULL REFERENCES hltv_demos(id), size_bytes INTEGER NOT NULL,
 deleted_at INTEGER
);
CREATE TRIGGER IF NOT EXISTS hltv_main_key_insert BEFORE INSERT ON hltv_demos
 WHEN EXISTS(SELECT 1 FROM hltv_copies WHERE storage_key=NEW.storage_key)
 BEGIN SELECT RAISE(ABORT,'Storage key already owned'); END;
CREATE TRIGGER IF NOT EXISTS hltv_main_key_update BEFORE UPDATE OF storage_key ON hltv_demos
 WHEN EXISTS(SELECT 1 FROM hltv_copies WHERE storage_key=NEW.storage_key)
 BEGIN SELECT RAISE(ABORT,'Storage key already owned'); END;
CREATE TRIGGER IF NOT EXISTS hltv_copy_key_insert BEFORE INSERT ON hltv_copies
 WHEN EXISTS(SELECT 1 FROM hltv_demos WHERE storage_key=NEW.storage_key)
 BEGIN SELECT RAISE(ABORT,'Storage key already owned'); END;
CREATE TRIGGER IF NOT EXISTS hltv_copy_key_update BEFORE UPDATE OF storage_key ON hltv_copies
 WHEN EXISTS(SELECT 1 FROM hltv_demos WHERE storage_key=NEW.storage_key)
 BEGIN SELECT RAISE(ABORT,'Storage key already owned'); END;
CREATE TABLE IF NOT EXISTS hltv_cases(
 id TEXT PRIMARY KEY, demo_id TEXT NOT NULL UNIQUE REFERENCES hltv_demos(id), source TEXT NOT NULL,
 status TEXT NOT NULL, priority TEXT NOT NULL, assigned_to TEXT, opened_by TEXT NOT NULL,
 opened_at INTEGER NOT NULL, closed_at INTEGER, decision_reason TEXT
);
CREATE TABLE IF NOT EXISTS hltv_holds(
 id TEXT PRIMARY KEY, demo_id TEXT NOT NULL REFERENCES hltv_demos(id), reason TEXT NOT NULL,
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL, released_at INTEGER, released_by TEXT, release_reason TEXT
);
CREATE INDEX IF NOT EXISTS hltv_active_holds ON hltv_holds(demo_id,released_at);
CREATE TABLE IF NOT EXISTS hltv_notes(
 id TEXT PRIMARY KEY, demo_id TEXT NOT NULL REFERENCES hltv_demos(id), author TEXT NOT NULL,
 note TEXT NOT NULL, tick INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hltv_audit(
 id INTEGER PRIMARY KEY, demo_id TEXT REFERENCES hltv_demos(id), actor TEXT NOT NULL,
 action TEXT NOT NULL, details TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hltv_policy(class TEXT PRIMARY KEY,days INTEGER NOT NULL CHECK(days BETWEEN 1 AND 3650));
INSERT OR IGNORE INTO hltv_policy VALUES('normal',7),('low',14),('medium',30),('high',90);
CREATE TABLE IF NOT EXISTS hltv_analysis_runs(
 id TEXT PRIMARY KEY, demo_id TEXT NOT NULL REFERENCES hltv_demos(id), status TEXT NOT NULL,
 parser_version TEXT, detector_version TEXT, started_at INTEGER NOT NULL, finished_at INTEGER,
 result_json TEXT, error TEXT
);
CREATE TABLE IF NOT EXISTS hltv_anomalies(
 id TEXT PRIMARY KEY, demo_id TEXT NOT NULL REFERENCES hltv_demos(id), run_id TEXT NOT NULL REFERENCES hltv_analysis_runs(id),
 severity TEXT NOT NULL, start_tick INTEGER, data_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS hltv_anomaly_time ON hltv_anomalies(demo_id,start_tick);
CREATE TABLE IF NOT EXISTS hltv_alerts(
 id TEXT PRIMARY KEY, demo_id TEXT REFERENCES hltv_demos(id), kind TEXT NOT NULL,
 created_at INTEGER NOT NULL, sent_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt INTEGER NOT NULL DEFAULT 0, lease TEXT, lease_until INTEGER
);
CREATE TABLE IF NOT EXISTS hltv_manifests(
 digest TEXT PRIMARY KEY, storage_key TEXT NOT NULL, status TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0, error TEXT
);
CREATE TABLE IF NOT EXISTS hltv_upstream_runs(
 id TEXT PRIMARY KEY, demo_id TEXT NOT NULL REFERENCES hltv_demos(id), hold_id TEXT NOT NULL REFERENCES hltv_holds(id),
 status TEXT NOT NULL, requested_by TEXT NOT NULL, created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER,
 upstream_sha TEXT, result_json TEXT, error_code TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS hltv_one_active_upstream_run ON hltv_upstream_runs(demo_id) WHERE status IN ('queued','processing');
