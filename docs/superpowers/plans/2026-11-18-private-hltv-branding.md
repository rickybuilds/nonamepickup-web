# Private HLTV Branding Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the authenticated HLTV console look native to NN//TFC without making HLTV publicly discoverable or weakening its existing server-side protection.

**Architecture:** Keep the existing `/admin/hltv-review` route, API router, bearer/session auth, and inline script. Add the public NN//TFC shared styles and logo treatment to the private document, remove the synthetic public navigation from the authenticated shell, and retain admin-only workspace navigation. Extend existing navigation/browser tests with privacy and branding assertions.

**Tech Stack:** Express, vanilla HTML/CSS/JavaScript, shared NN//TFC CSS, Node test runner, local Edge browser fixture.

**Spec:** `docs/superpowers/specs/2026-11-18-private-hltv-branding-design.md`

## Global Constraints

- Keep `/admin/hltv-review` as the private administrative entry point.
- Do not add HLTV to public header, More menu, footer, sitemap, search results, or player pages.
- Preserve existing authentication, authorization, sessions, reviewer identities, audit logging, APIs, database schemas, scanners, thresholds, retention behavior, and Discord policies.
- Do not expose private records, findings, review counts, or evidence to public pages.
- Use the existing NN//TFC website as the visual authority.

## Review Focus

- Public navigation source pages must not gain an HLTV link; test representative public HTML and shared navigation strings.
- Unauthenticated API requests must remain rejected; test the existing auth router path.
- The bookmarked HTML entry point must show branded login without private data; test its markup and no-data initial state.
- Authenticated admin navigation must retain registry, queue, configuration, retention, jobs, and owner-gated users; test the existing browser fixture.
- Mobile/private shell styling must not introduce overflow or duplicate public nav; verify responsive CSS selectors and browser layout assertions where supported.

### Task 1: Shared branded private shell

**Files:**
- Modify: `api/src/hltv/review.html`

**Interfaces:**
- Consumes: existing NN//TFC assets and shared CSS files; existing DOM IDs and inline script behavior.
- Produces: a branded login shell and authenticated administrative workspace with no public navigation link to HLTV.

- [ ] **Step 1: Add the shared NN//TFC font, favicon, shared CSS, and logo treatment to the private document without changing public pages.**
- [ ] **Step 2: Replace the standalone login/header styling with the NN//TFC dark/cyan visual system while preserving all existing login forms, copy, and controls.**
- [ ] **Step 3: Remove the generated public Matches/Players/Analytics/HLTV Review links from the authenticated shell and label the remaining workspace as private administrative navigation.**
- [ ] **Step 4: Preserve owner-only visibility for user management and all existing admin actions.**
- [ ] **Step 5: Add scoped responsive rules for the private shell and confirm the three-column investigation layout remains usable at desktop, tablet, and mobile widths.**

### Task 2: Privacy and navigation regression coverage

**Files:**
- Modify: `api/test/hltv-review-navigation.test.js`
- Modify: `api/test/hltv-review-browser.test.js`
- Modify: `api/test/hltv.test.js` only if an existing auth assertion needs a narrowly scoped extension

**Interfaces:**
- Consumes: existing test fixtures and router/browser harnesses.
- Produces: regression coverage for private navigation, branded login markup, and protected data access.

- [ ] **Step 1: Add source-level assertions that the HLTV document has the NN//TFC brand and no generated public navigation list.**
- [ ] **Step 2: Add browser assertions that the login view is branded and the authenticated workspace exposes only private admin navigation.**
- [ ] **Step 3: Add or strengthen an existing router assertion that unauthenticated protected requests return 401/403 and do not return review data.**
- [ ] **Step 4: Run the focused navigation, browser, and HLTV auth tests.**

### Task 3: Documentation and verification

**Files:**
- Modify: `docs/superpowers/specs/2026-11-18-private-hltv-branding-design.md`
- Modify: `docs/superpowers/plans/2026-11-18-private-hltv-branding.md`

- [ ] **Step 1: Run `git diff --check` and the Impeccable detector against the changed UI target.**
- [ ] **Step 2: Run relevant local tests and record any environment-skipped cases.**
- [ ] **Step 3: Confirm only task files are staged, preserving unrelated user work.**
- [ ] **Step 4: Commit and push the completed changes to the current branch.**
