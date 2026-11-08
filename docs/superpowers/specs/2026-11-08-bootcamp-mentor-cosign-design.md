# Bootcamp Mentor Co-sign Design

## Intent

Let a configured Discord mentor attest that they watched a player in a learning pug, with the attestation visible on the player's Bootcamp profile and retained in the existing `bootcamp_licenses.cosigned_by` field.

## Approach

Use a Bot command (`!cosign @player`) gated by an explicitly configured mentor role and a default-off feature flag. The Bot resolves the target's primary linked Steam ID and calls a service-authenticated Website API endpoint. The API uses the existing Bootcamp license row and shared service token. Direct Bot database access would violate the established Website API boundary; a Website Basic-auth endpoint would make mentors require administrator credentials.

## Safety and behavior

- Disabled unless `BOOTCAMP_MENTOR_COSIGN_ENABLED=true` and a mentor role ID is configured.
- A member with the configured role can co-sign another member only; both Discord accounts must be in the guild and the target must have a primary linked Steam ID.
- A co-sign is idempotent for the same mentor. It cannot silently replace a different mentor's co-sign.
- Co-signing does not grant or bypass tier requirements; it is optional human context attached to the computed license.
- The API is service-token authenticated, never cached, and keeps plugin/Website/Bot dependency direction one-way.
- Public license/profile responses include the co-signing Discord ID for attribution.

## Verification

Add API tests for service auth, validation, idempotence/conflict, and profile serialization; Bot tests for default-off, role enforcement, target linkage and successful API use. Run focused Web/Bot suites and full suite baselines without changing production configuration.
