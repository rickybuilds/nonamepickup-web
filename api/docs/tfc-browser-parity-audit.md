# TFC browser parity audit

This document is the source of truth for the goal of reproducing a live TFC
match in the browser without HLTV. It separates four different questions that
must not be treated as equivalent:

1. Does the AMXX recorder write the datum?
2. Does the live forwarder and API deliver it?
3. Does the browser parse and retain it?
4. Does the browser render or otherwise reproduce it faithfully?

The original audited production contract was replay schema 4. The live forwarder sends
the same twelve CSV streams as the completed replay. It does not deliberately
remove columns. Therefore, a field present in a current CSV normally reaches
the browser; the remaining distinction is whether the worker parses it and
whether the renderer uses it.

## Schema-6 implementation status

The AMXX recorder and website implement the generic-entity portion of schema 5
and the scene-semantic additions in schema 6. `entity_defs.csv`, `entities.csv`,
`entity_census.csv`, `entity_meta.csv`, and `scene_events.csv` are
allowlisted, validated, transported, parsed, retained, and rendered through a
generic entity layer. The model catalog includes standard TFC backpack, pickup,
armor, power-up, prop, and dropped-item studio models. Unknown safe generic
assets remain visible as diagnostic fallback geometry instead of invalidating
live playback; native sprite rendering remains pending. Schema-6 metadata uses
`(stream, stream_id)` identity, ordered scene events use
`(object_stream, object_id)`, pickup resource gains reach the event feed, and
death/corpse/gib lifetimes drive the persistent player and generic scene
objects. Exact native studio-sequence playback remains pending because the GLB
assets are still static approximations.

Schema 2–5 compatibility remains intact. The sections below preserve the
historical inventory and remaining backlog for true 1:1 parity.

## Status legend

- **Complete**: captured, transported, parsed, and meaningfully reproduced.
- **Partial**: captured and transported, but only some fields or behaviors are
  reproduced.
- **Missing**: the schema has no authoritative source for the behavior.
- **Inferred**: the browser invents an approximation from other state. This is
  useful visually, but is not 1:1 evidence.

## Current schema 4 inventory

| Stream | Current fields | Browser result | Status |
| --- | --- | --- | --- |
| `roster.csv` | session, slot, userid, Steam ID, name, initial team, bot, join time | Player identity and roster labels | Complete for identity; no leave/rejoin/name/team history beyond the session/timeline combination |
| `render_models.csv` | model ID, kind, MDL path, first-seen time | Resolves allowlisted player, held weapon, projectile, objective, and buildable GLBs | Partial. There is no generic prop/entity kind, and converted models are static approximations |
| `players.csv` | life/team/class/goal flags/weapon/buttons/HP/armor; origin, velocity, view angles; ducking; player and weapon models; body, skin, sequence, gait, frame/rate/time, body angles, controllers, blending | Players, held weapons, movement, basic HUD and synthetic effects | Partial. The native animation/bodygroup/skin/controller data is retained but not actually applied to the static GLBs |
| `projectile_defs.csv` | stable projectile ID, edict, owner session, classname, model, spawn time | Selects projectile visual and owner | Partial. Definition is useful, but owner weapon is reconstructed from the latest player sample |
| `projectiles.csv` | lifecycle state, origin, velocity, pitch/yaw/roll | Projectile position and removal; selected classes receive custom visuals | Partial. Rendering currently ignores recorded velocity and pitch/roll; impacts and many effects are inferred |
| `objective_defs.csv` | stable objective ID, edict, classname, model, targetname, base transform, first-seen time | Identifies flags/keys/balls and their bases | Mostly complete for identity |
| `objectives.csv` | state, carrier, solid, effects, origin, yaw | World/carried objectives and flag activity | Partial. `solid` and `effects` are parsed but not faithfully rendered; carried placement is approximate |
| `buildable_defs.csv` | stable ID, edict, kind, classname, initial owner, first-seen time | Identifies sentries, dispensers and other allowed buildings | Complete for the current narrow definition set |
| `buildables.csv` | active/ownership/team/model; physics and render state; HP and transform; body/skin/animation/controllers/blending; attachment edict | Buildable model, transform, tint/opacity and lifecycle | Partial. Animation, bodygroups, attachments, sentry aim/fire and device-specific behavior are not reproduced 1:1 |
| `brush_defs.csv` | stable ID, edict, classname, BSP model, target metadata, spawnflags, first-seen time | Identifies eight supported mover classes | Partial. The allowlist omits other dynamic brush classes |
| `brushes.csv` | active, transform, linear/angular velocity, effects, collision/movement type and render state | Moving doors/buttons/plats/trains and approximate render state | Partial. This is visual movement, not full GoldSrc collision/controller behavior |
| `events.csv` | time, event name, actor/target sessions, edict, two floats, two integers, text | Event feed plus a few flag/beam/capture effects | Partial. Payload meaning depends on event name and most events are only displayed generically |

### Current transport finding

The sidecar, live API, and worker recognize all twelve schema-4 CSV files, so
the live path is not presently dropping an entire known stream. Incremental
definitions are merged before their state is rendered.

`events.csv` is an exception in validation quality: the archive requires the
file, but `archive.js` does not currently enforce its exact header, numeric
types, ordering, or manifest row count the way it does for the other timeline
streams. That should be fixed before treating event capture as reliable.

### Data already captured but not fully used

These are browser tasks, not new AMXX tasks:

- Apply player `body`, `skin`, `sequence`, `gaitsequence`, `frame`,
  `framerate`, `animtime`, bone controllers, and sequence blending.
- Use projectile velocity plus pitch and roll. Do not derive every orientation
  or impact solely from two samples and disappearance.
- Apply objective `solid` and `effects` where they affect visibility/behavior.
- Apply buildable bodygroups, skin, animation, controllers, blending and
  `aiment` attachment chains.
- Reproduce brush `movetype`, `solid`, `renderfx` and controller behavior where
  the browser simulation needs them.
- Define and consume the meanings of every `events.csv` payload instead of
  treating unrecognized events as text-only feed entries.

The current model conversion metadata is also a limiting factor: player and
weapon GLBs are static, do not export native animation, bodygroups, alternate
skins, bone controllers, sequence blending, or attachments. Capturing those
numbers alone cannot create 1:1 motion until the asset/runtime path supports
them.

## Why backpacks are missing

Ground backpacks are not a projectile, objective, buildable, supported brush,
player, or held weapon. Schema 4 has no general-purpose entity stream, and the
model catalog currently has no generic entity kind or `models/backpack.mdl`.
Adding only a backpack special case would repeat the same problem for armor,
ammo, health, gibs, dropped items, sprites, and map-specific entities.

The correct fix is a generic renderable-entity contract.

## Implemented schema 5: generic entities

Add `entity_defs.csv`:

```text
entity_id,entity,entity_generation,classname,model_id,owner_session,owner_entity,targetname,spawned_ms
```

Add `entities.csv`:

```text
snapshot,time_ms,entity_id,active,owner_session,owner_entity,team,health,
model_id,colormap,movetype,solid,effects,flags,x,y,z,vx,vy,vz,pitch,yaw,roll,
avel_pitch,avel_yaw,avel_roll,body,skin,sequence,gaitsequence,frame,framerate,
animtime,scale,rendermode,renderamt,renderfx,render_r,render_g,render_b,
controller0,controller1,controller2,controller3,blending0,blending1,aiment
```

Rules:

- `entity_id` is stable for one entity lifetime. An edict number is not an ID;
  GoldSrc can reuse it after removal. `entity_generation` makes reuse explicit.
- Write a terminal `active=0` row on removal.
- Emit the definition before the first state row in the live stream.
- Record any entity with a visible studio/sprite model or visible render state,
  unless it already belongs to a more specialized stream.
- Add `entity` (or `prop`) to the render-model kind allowlist and conversion
  manifest.
- Begin the allowlist with backpack, health, armor, ammunition, dropped items,
  gibs, and visible map-specific models, but drive it from observed inventory
  rather than a forever-hardcoded list.
- Do not duplicate players/projectiles/objectives/buildables/brushes in this
  stream. The generic stream is the fallback for everything else.

This one addition covers the entire family of backpack-like one-offs while
keeping specialized gameplay streams intact.

## What AMXX must capture next

The following list is ordered by dependency and parity value.

### P0 — prove completeness and identity

1. **All-entity census.** Once per map and whenever a new signature appears,
   record every active edict's classname, model path/index, movetype, solid,
   effects and render mode, plus the reason it was assigned to a stream or
   deliberately excluded. This is the mechanism that makes the gap list
   exhaustive instead of anecdotal.
2. **Generic entity definitions and state.** Implement the schema-5 streams
   above, including edict generation and terminal removal rows.
3. **Authoritative lifecycle.** Capture spawn, model change, owner/aiment
   change, and removal. Sampling only active entities misses short-lived
   effects and permits edict-reuse bugs.
4. **Event contract.** Publish a fixed event-name registry with the exact
   meaning and units of both float fields, both integer fields, `entity`, and
   `text`. Add strict API validation and per-event browser handlers.
5. **Timebase.** Every state and event channel must use the same monotonic
   round clock. Include server tick/frame identity where ordering within the
   same millisecond matters.

### P1 — combat and transient effects

6. **Weapon-fire events.** Shooter, weapon ID, attack mode, muzzle origin and
   direction, seed/spread information, and server tick.
7. **Hitscan traces.** Pellet/trace start, end, hit edict, hitgroup/material,
   damage and impact position. Shotgun pellets, sniper shots, nail hits and
   assault-cannon fire cannot be reconstructed exactly from player buttons.
8. **Damage/death/gib events.** Inflictor, attacker, victim, weapon/damage
   type, amount, armor damage, origin/direction, death and gib state.
9. **Temporary effects.** Explosion type, sprite/model, scale, rate, color,
   lifetime, beam endpoints, trails, sparks, smoke, blood and screen effects.
   Capture the authoritative effect call/message rather than guessing when an
   entity disappears.
10. **Decals.** Bullet holes, scorch marks, blood and other world decals with
    position, surface/entity, texture/decal ID and lifetime.
11. **Sound.** A sound dictionary plus timestamped start/stop events containing
    emitting entity/session, channel, sample, origin, volume, attenuation,
    pitch and flags. Include weapon, movement, impact, explosion, pickup,
    buildable, door/train, ambient and announcer sounds.

### P1 — players and TFC rules

12. **Exact player presentation.** View angles and body angles are present;
    additionally capture punch angle, FOV, observer mode/target, water level,
    ground entity and the state needed to reproduce movement transitions.
13. **Inventory/HUD state.** Current ammo by type, clip where applicable,
    grenade counts/types, selected weapon, reload state, team score, round
    clock and objective timers.
14. **TFC status effects.** Disguise class/team/skin, feign-death state,
    invisibility/transparency, infection, concussion, hallucination/gas,
    tranquilization, burning, invulnerability and other rule-driven visual or
    screen effects. Prefer explicit flags/timers over model heuristics.
15. **Player messages.** Death notices, chat if intentionally in scope,
    center-print text, objective/status icons, team/class changes and other
    gameplay messages needed by a spectator HUD.
16. **Weapon attachments and viewmodels.** Capture the attachment/muzzle index
    and viewmodel state required for exact first-person playback. Third-person
    weapons must attach to the recorded animated skeleton rather than a fixed
    offset.

### P1 — TFC entities

17. **Backpacks and pickups.** Through the generic stream, capture backpack,
    ammo, health, armor and dropped-item spawn/model/body/skin/transform,
    pickup and removal. Backpack contents are only needed if the UI will expose
    them.
18. **Buildable behavior.** Sentry head/barrel angles, target, firing state,
    muzzle, upgrade/level, ammo; dispenser use/state; detpack owner, timer,
    disarm and explosion; teleporter pairing/use where relevant.
19. **Objective detail.** Return timer, drop/pickup/capture/return reason,
    scoring team/player, body/skin/render state, and any map-specific goal item
    fields not represented by the current objective rows.
20. **Projectile behavior.** Bounce/collision/impact result, fuse and detonation
    type, trail/effect state, and child ownership for MIRVs, nail grenades,
    napalm, gas, EMP, caltrops and pipes.

### P2 — map/world parity

21. **Remaining dynamic brush classes.** Inventory first, then support such
    classes as rotating, breakable, toggle wall, conveyor and map-specific BSP
    movers when encountered. Record break state and controller/target changes.
22. **Dynamic point entities.** Sprites, glows, lasers, beams, dynamic lights,
    explosions and other visible map entities belong in the generic/effect
    streams.
23. **Trigger/controller state.** Capture target firing and state changes when
    they alter a visible mover, light, beam, objective or sound.
24. **Environmental state.** Lightstyle changes, sky/fog where applicable,
    water/content effects and moving-platform attachment relationships.

### P2 — browser asset/runtime work required by the capture

These are not AMXX fields, but they block 1:1 use of the captured data:

- Replace or extend the static MDL-to-GLB pipeline so studio bones, sequences,
  bodygroups, skins, controllers, blending and attachments can be reproduced.
- Add sprite and decal loading, not only studio model loading.
- Use authoritative events for muzzle flashes, traces, impacts, explosions,
  sounds and screen effects; retain inference only as an old-schema fallback.
- Implement entity attachment chains and interpolation rules per movetype.
- Add a baseline-plus-delta binary transport later if CSV bandwidth/latency
  becomes the bottleneck. CSV is acceptable for proving correctness first.

## Definition of “captured”

A feature is not marked captured merely because one screenshot happened to
look right. It is captured only when all of these are true:

- The recorder has a documented field or event for it.
- The definition arrives before state and IDs survive edict reuse.
- The archive validator checks its header, type, references, ordering and row
  count.
- Live and completed replay paths carry the same contract.
- The worker parses it without silently discarding fields.
- A browser handler uses it, or the parity matrix explicitly labels it
  “captured, renderer pending.”

## Recommended implementation order

1. Deploy the schema-6 recorder and website together; schema-6 output requires
   schema-6 API/forwarder/browser support.
2. Run the all-entity census across several
   stock and league maps and save the unique classname/model signatures.
3. Use backpack plus at least one pickup and removal as the first live
   acceptance cases.
4. Formalize the event registry; strict `events.csv` archive validation is now implemented.
5. Add authoritative weapon, trace, damage, effect and sound hooks.
6. Upgrade the model/runtime path, then consume the native animation fields
   already present in schema 4.
7. Work down the census and event-registry unknown lists until both stay empty
   during full matches on the target map pool.

The finish condition is measurable: a full match produces no unknown visible
entity signatures, no unknown event names, no invalid references, and every
known stream field is either rendered or explicitly declared non-visual.
