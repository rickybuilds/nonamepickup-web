"use strict";

const { pickupError } = require("./errors");

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
          (match_id, server_id, started_at, ended_at, status, created_at, updated_at)
        VALUES (?, ?, FROM_UNIXTIME(?), FROM_UNIXTIME(?), ?, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          id = LAST_INSERT_ID(id),
          server_id = VALUES(server_id),
          started_at = LEAST(started_at, VALUES(started_at)),
          ended_at = GREATEST(ended_at, VALUES(ended_at)),
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
          (match_id, round_number, created_at, updated_at)
        VALUES (?, ?, NOW(), NOW())
        ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)
      `, [matchPk, input.round]);
      const [roundRows] = await connection.execute(
        "SELECT id FROM pickup_rounds WHERE match_id = ? AND round_number = ? FOR UPDATE",
        [matchPk, input.round]
      );
      const roundPk = roundRows[0]?.id;
      if (!roundPk) throw new Error("round lock failed");

      const [artifactRows] = await connection.execute(`
        SELECT id, sha256, byte_size, storage_key
        FROM pickup_artifacts
        WHERE round_id = ? AND artifact_kind = 'round_replay' AND is_primary = 1
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
        SET map_name = ?,
            status = ?,
            completion_reason = ?,
            started_at = FROM_UNIXTIME(?),
            ended_at = FROM_UNIXTIME(?),
            duration_ms = ?,
            schema_version = ?,
            sample_interval_seconds = ?,
            snapshots = ?,
            dropped_snapshots = ?,
            write_error = ?,
            row_counts = ?,
            byte_counts = ?,
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
        input.manifest.sample_interval_seconds,
        input.manifest.snapshots,
        input.manifest.dropped_snapshots,
        input.manifest.write_error ? 1 : 0,
        JSON.stringify(input.manifest.rows),
        JSON.stringify(input.manifest.bytes),
        roundPk
      ]);

      await connection.execute("DELETE FROM pickup_round_players WHERE round_id = ?", [roundPk]);
      for (const session of input.roster) {
        const [playerResult] = await connection.execute(`
          INSERT INTO pickup_players (steam_id, last_name, created_at, updated_at)
          VALUES (?, ?, NOW(), NOW())
          ON DUPLICATE KEY UPDATE
            id = LAST_INSERT_ID(id),
            last_name = VALUES(last_name),
            updated_at = NOW()
        `, [session.steamId, session.playerName]);
        await connection.execute(`
          INSERT INTO pickup_round_players
            (round_id, player_id, session_index, player_name, team_number, team_name,
             joined_at_epoch, left_at_epoch, session_data, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `, [
          roundPk,
          playerResult.insertId,
          session.sessionIndex,
          session.playerName,
          session.teamNumber,
          session.teamName,
          session.joinedAtEpoch,
          session.leftAtEpoch,
          JSON.stringify(session.source)
        ]);
      }

      promotedPath = await promote();
      createdStorage = true;
      const [artifactResult] = await connection.execute(`
        INSERT INTO pickup_artifacts
          (round_id, storage_backend, artifact_kind, format_version, sha256,
           byte_size, storage_key, is_primary, created_at)
        VALUES (?, 'local', 'round_replay', ?, ?, ?, ?, 1, NOW())
      `, [
        roundPk,
        input.manifest.schema_version,
        input.sha256,
        input.byteSize,
        input.storageKey
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
            JOIN pickup_rounds r ON r.id = a.round_id
            JOIN pickup_matches m ON m.id = r.match_id
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
