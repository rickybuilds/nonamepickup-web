"use strict";

const { pickupError } = require("./errors");

function manifestCount(counts, names) {
  for (const name of names) {
    if (Number.isSafeInteger(counts?.[name])) return counts[name];
  }
  return 0;
}

class PickupRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async persist(input, promote) {
    const connection = await this.pool.getConnection();
    let promotedPath = null;
    let createdStorage = false;
    let commitAttempted = false;
    try {
      await connection.beginTransaction();
      const [matchResult] = await connection.execute(`
        INSERT INTO pickup_matches
          (match_id, source_server, started_at, ended_at, status, created_at, updated_at)
        VALUES (?, ?, FROM_UNIXTIME(?), FROM_UNIXTIME(?), ?, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          id = LAST_INSERT_ID(id),
          source_server = VALUES(source_server),
          started_at = LEAST(COALESCE(started_at, VALUES(started_at)), VALUES(started_at)),
          ended_at = GREATEST(COALESCE(ended_at, VALUES(ended_at)), VALUES(ended_at)),
          status = VALUES(status),
          updated_at = NOW()
      `, [
        input.matchId,
        input.serverId,
        input.manifest.started_at_epoch,
        input.manifest.ended_at_epoch,
        input.status
      ]);
      const matchPk = matchResult.insertId;

      await connection.execute(`
        INSERT INTO pickup_rounds
          (match_pk, round_number, map, status, completion_reason, started_at, ended_at,
           duration_ms, schema_version, sample_interval_ms, snapshot_count,
           dropped_snapshot_count, player_row_count, projectile_row_count,
           objective_row_count, event_row_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, FROM_UNIXTIME(?), FROM_UNIXTIME(?), ?, ?, ?, ?, ?, ?, ?, ?, ?,
                NOW(), NOW())
        ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)
      `, [
        matchPk,
        input.round,
        input.manifest.map,
        input.status,
        input.manifest.reason,
        input.manifest.started_at_epoch,
        input.manifest.ended_at_epoch,
        input.manifest.duration_ms,
        input.manifest.schema_version,
        Math.round(input.manifest.sample_interval_seconds * 1000),
        input.manifest.snapshots,
        input.manifest.dropped_snapshots,
        manifestCount(input.manifest.rows, ["players", "player", "players.csv"]),
        manifestCount(input.manifest.rows, ["projectiles", "projectile", "projectiles.csv"]),
        manifestCount(input.manifest.rows, ["objectives", "objective", "objectives.csv"]),
        manifestCount(input.manifest.rows, ["events", "event", "events.csv"])
      ]);
      const [roundRows] = await connection.execute(
        "SELECT id FROM pickup_rounds WHERE match_pk = ? AND round_number = ? FOR UPDATE",
        [matchPk, input.round]
      );
      const roundPk = roundRows[0]?.id;
      if (!roundPk) throw new Error("round lock failed");

      const [artifactRows] = await connection.execute(`
        SELECT id, sha256, byte_size, storage_key
        FROM pickup_artifacts
        WHERE round_pk = ? AND artifact_kind = 'round_replay' AND is_primary = 1
        LIMIT 1
        FOR UPDATE
      `, [roundPk]);
      const existing = artifactRows[0];
      if (existing) {
        if (String(existing.sha256).toLowerCase() !== input.sha256) {
          throw pickupError(409, "round_artifact_conflict");
        }
        await connection.commit();
        return {
          created: false,
          artifactId: Number(existing.id),
          byteSize: Number(existing.byte_size),
          storageKey: existing.storage_key,
          promotedPath: null,
          createdStorage: false
        };
      }

      await connection.execute(`
        UPDATE pickup_rounds
        SET map = ?,
            status = ?,
            completion_reason = ?,
            started_at = FROM_UNIXTIME(?),
            ended_at = FROM_UNIXTIME(?),
            duration_ms = ?,
            schema_version = ?,
            sample_interval_ms = ?,
            snapshot_count = ?,
            dropped_snapshot_count = ?,
            player_row_count = ?,
            projectile_row_count = ?,
            objective_row_count = ?,
            event_row_count = ?,
            updated_at = NOW()
        WHERE id = ?
      `, [
        input.manifest.map,
        input.status,
        input.manifest.reason,
        input.manifest.started_at_epoch,
        input.manifest.ended_at_epoch,
        input.manifest.duration_ms,
        input.manifest.schema_version,
        Math.round(input.manifest.sample_interval_seconds * 1000),
        input.manifest.snapshots,
        input.manifest.dropped_snapshots,
        manifestCount(input.manifest.rows, ["players", "player", "players.csv"]),
        manifestCount(input.manifest.rows, ["projectiles", "projectile", "projectiles.csv"]),
        manifestCount(input.manifest.rows, ["objectives", "objective", "objectives.csv"]),
        manifestCount(input.manifest.rows, ["events", "event", "events.csv"]),
        roundPk
      ]);

      await connection.execute("DELETE FROM pickup_round_players WHERE round_pk = ?", [roundPk]);
      for (const session of input.roster) {
        const [playerResult] = await connection.execute(`
          INSERT INTO pickup_players
            (steamid, current_name, first_seen_at, last_seen_at, created_at, updated_at)
          VALUES (?, ?, FROM_UNIXTIME(?), FROM_UNIXTIME(?), NOW(), NOW())
          ON DUPLICATE KEY UPDATE
            id = LAST_INSERT_ID(id),
            current_name = VALUES(current_name),
            first_seen_at = LEAST(
              COALESCE(first_seen_at, VALUES(first_seen_at)),
              VALUES(first_seen_at)
            ),
            last_seen_at = GREATEST(
              COALESCE(last_seen_at, VALUES(last_seen_at)),
              VALUES(last_seen_at)
            ),
            updated_at = NOW()
        `, [
          session.steamId,
          session.playerName,
          input.manifest.started_at_epoch,
          input.manifest.ended_at_epoch
        ]);
        await connection.execute(`
          INSERT INTO pickup_round_players
            (round_pk, player_pk, session_id, initial_slot, team_number, team_name,
             primary_class_id, is_bot, joined_ms, left_ms, kills, deaths, assists,
             suicides, damage_dealt, damage_taken, flag_pickups, flag_drops,
             flag_captures, flag_returns, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `, [
          roundPk,
          playerResult.insertId,
          session.sessionIndex,
          session.initialSlot,
          session.teamNumber,
          session.teamName,
          session.primaryClassId,
          session.isBot ? 1 : 0,
          session.joinedMs,
          session.leftMs,
          session.kills,
          session.deaths,
          session.assists,
          session.suicides,
          session.damageDealt,
          session.damageTaken,
          session.flagPickups,
          session.flagDrops,
          session.flagCaptures,
          session.flagReturns
        ]);
      }

      promotedPath = await promote();
      createdStorage = true;
      const [artifactResult] = await connection.execute(`
        INSERT INTO pickup_artifacts
          (round_pk, artifact_kind, status, storage_backend, storage_key, content_type,
           compression, byte_size, sha256, format_version, is_primary, manifest_json,
           uploaded_at, verified_at, created_at, updated_at)
        VALUES (?, 'round_replay', 'verified', 'local', ?, 'application/zstd', 'zstd',
                ?, ?, ?, 1, ?, NOW(3), NOW(3), NOW(), NOW())
      `, [
        roundPk,
        input.storageKey,
        input.byteSize,
        input.sha256,
        input.manifest.schema_version,
        JSON.stringify(input.manifest)
      ]);
      commitAttempted = true;
      await connection.commit();
      commitAttempted = false;
      return {
        created: true,
        artifactId: Number(artifactResult.insertId),
        byteSize: input.byteSize,
        storageKey: input.storageKey,
        promotedPath,
        createdStorage
      };
    } catch (error) {
      try {
        await connection.rollback();
      } catch {}
      if (commitAttempted && promotedPath) {
        try {
          const [confirmedRows] = await this.pool.execute(`
            SELECT a.id, a.byte_size, a.storage_key
            FROM pickup_artifacts a
            JOIN pickup_rounds r ON r.id = a.round_pk
            JOIN pickup_matches m ON m.id = r.match_pk
            WHERE m.match_id = ?
              AND r.round_number = ?
              AND a.sha256 = ?
              AND a.artifact_kind = 'round_replay'
              AND a.is_primary = 1
            LIMIT 1
          `, [input.matchId, input.round, input.sha256]);
          if (confirmedRows[0]) {
            return {
              created: true,
              artifactId: Number(confirmedRows[0].id),
              byteSize: Number(confirmedRows[0].byte_size),
              storageKey: confirmedRows[0].storage_key,
              promotedPath,
              createdStorage: true
            };
          }
        } catch {
          error.commitAmbiguous = true;
        }
      }
      error.promotedPath = promotedPath;
      error.createdStorage = createdStorage;
      if (error.code === "ER_DUP_ENTRY" && !error.status) {
        throw pickupError(409, "round_artifact_conflict", { cause: error });
      }
      throw error;
    } finally {
      connection.release();
    }
  }
}

module.exports = { PickupRepository };
