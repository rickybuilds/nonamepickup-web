"use strict";

// Analytics identity comes from Discord's persisted names, never match/Steam aliases.
function loadDiscordDisplayNames(db) {
  const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
  const names=new Map();
  if(tables.has('ratings')) for(const row of db.prepare('SELECT player_id, display_name FROM ratings').all()) {
    const name=String(row.display_name||'').trim();if(name)names.set(String(row.player_id),name);
  }
  if(tables.has('discord_names')) for(const row of db.prepare('SELECT discord_id, display_name, global_name, username FROM discord_names').all()) {
    const name=[row.display_name,row.global_name,row.username].map(v=>String(v||'').trim()).find(Boolean);
    if(name)names.set(String(row.discord_id),name);
  }
  return names;
}
module.exports={loadDiscordDisplayNames};
