# Reviewer accounts

Requested flow: an owner creates a username and temporary password; the reviewer signs in and must change that password before seeing evidence. Reviewers can later change their own password. Owners can reset passwords and disable accounts from the review page. There is no public signup.

Use the existing private SQLite registry, Node's asynchronous scrypt password hashing, opaque eight-hour bearer sessions held only in browser memory, and persistent login throttling. Keep the existing credential login for owner bootstrap/recovery. Account administration is restricted to explicitly configured owner Discord IDs; ordinary reviewers cannot manage accounts. Account identities remain stable in audit records; optional Discord IDs preserve existing attribution. Account access is granted by the owner, independently of Discord channel membership. New login defaults disabled.

Implementation: extend the existing HLTV test file with authorization/lifecycle/throttling regressions; add account tables and an account service; integrate login, forced password changes, owner management and revocation into the existing router/auth; extend the existing page using its current styles; document rollout. Validate targeted tests, real browser flows and responsive layout. Commit and push only this task's changes. No parser or alert-policy changes.
