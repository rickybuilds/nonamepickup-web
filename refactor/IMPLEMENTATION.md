# Complete-site migration

The owner approved the match-night direction and delegated design decisions.
The follow-up request extends that direction to all existing site views.

1. Preserve every route's data loaders, feature controls, and DOM hooks in `/refactor/`.
2. Share the homepage navigation, player search, typography, and color system.
3. Redesign independent pickup, speedrun, community, and spectator surfaces.
4. Keep API, game assets, runtime downloads, and workers at their correct paths.
5. Review desktop and phone layouts and representative real-data workflows.
6. Document the migration and deliver the branch for the existing static deployment.

Original root pages, backend, and nginx configuration stay outside the change.
No tests are created, changed, or run, following repository instructions.
Verification uses browser inspection, JavaScript syntax, and Git whitespace checks.
