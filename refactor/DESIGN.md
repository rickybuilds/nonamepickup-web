---
name: NoName TFC Pickups
description: A community match-night hub with authentic Team Fortress Classic character.
colors:
  bg: "#101112"
  surface: "#191b1d"
  raised: "#222527"
  ink: "#f1eee7"
  muted: "#aaaeb0"
  line: "#34383b"
  accent: "#ff7547"
  blue: "#79b9ff"
  red: "#ff8d8d"
  action-ink: "#17110f"
  accent-hover: "#ff946f"
typography:
  display:
    fontFamily: "'Barlow Condensed', sans-serif"
    fontSize: "clamp(64px, 6.6vw, 96px)"
    fontWeight: 800
    lineHeight: 0.91
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "'Barlow Condensed', sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1.06
    letterSpacing: "-0.015em"
  title:
    fontFamily: "'Barlow Condensed', sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.1
  body:
    fontFamily: "Barlow, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.45
  data-title:
    fontFamily: "'Barlow Condensed', sans-serif"
    fontSize: "clamp(40px, 5vw, 64px)"
    fontWeight: 700
    lineHeight: 1.02
  table:
    fontFamily: "Barlow, sans-serif"
    fontSize: "14px"
    fontWeight: 400
  metadata:
    fontFamily: "Barlow, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  label:
    fontFamily: "Barlow, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.055em"
  button:
    fontFamily: "Barlow, sans-serif"
    fontSize: "15px"
    fontWeight: 700
  queue-count:
    fontFamily: "'Barlow Condensed', sans-serif"
    fontSize: "80px"
    fontWeight: 700
    lineHeight: 1
rounded:
  data-panel: "10px"
  data-control: "8px"
  surface: "14px"
  menu: "12px"
  control: "6px"
  compact: "5px"
  circle: "50%"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  section: "40px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.action-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "13px 21px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-small:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.action-ink}"
    rounded: "{rounded.control}"
    padding: "10px 15px"
    height: "42px"
  button-light:
    backgroundColor: "{colors.ink}"
    textColor: "#27211d"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "13px 21px"
    height: "48px"
  button-light-hover:
    backgroundColor: "#fff"
  text-link:
    textColor: "{colors.ink}"
  search-input:
    textColor: "{colors.ink}"
    padding: "14px 0"
  navigation:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
  filter:
    textColor: "{colors.muted}"
    rounded: "{rounded.compact}"
    padding: "8px 12px"
  filter-selected:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
  queue-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "25px 25px 17px"
  queue-slot:
    backgroundColor: "#111314"
    textColor: "#9a9e9f"
    rounded: "{rounded.compact}"
    height: "42px"
  queue-slot-filled:
    backgroundColor: "#493022"
    textColor: "#ffd7bf"
  match-row:
    textColor: "{colors.ink}"
    padding: "14px 0"
  match-row-hover:
    backgroundColor: "#1c1f21"
  feature-story:
    backgroundColor: "#28211d"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "30px"
    height: "270px"
  story-row:
    textColor: "{colors.ink}"
    padding: "24px 15px"
  class-controls:
    backgroundColor: "#101112cc"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "44px"
---

# Design System: NoName TFC Pickups

## Overview

**Creative North Star: "The Match-Night Hub"**

The Match-Night Hub puts the community’s games and people in the foreground. Charcoal surfaces, warm white type, compressed headlines, and an orange action color give NoName the energy of a competitive TFC gathering. Real class cutouts and map scenes carry the identity.

The interface combines expressive imagery with compact, readable records. Numeric counts and player names are visually direct; dividers and tonal steps organize dense information. Controls remain plain enough to understand during a game night, with explicit loading, empty, and unavailable states.

**Key Characteristics:**

- Charcoal canvas and warm white reading surfaces.
- Orange actions with separate red and blue team semantics.
- Barlow Condensed display type paired with Barlow body text.
- Authentic TFC scenes, class artwork, maps, and real player records.
- Flat data lists beside restrained rounded containers.

This captures the complete frontend in `refactor/`. Token values are normative; homepage imagery and dense record views share the same world while using compositions suited to their content.

## Colors

The palette feels like a dim server room warmed by orange action cues and familiar game imagery. Names below map to the frontmatter and the incumbent CSS variables.

### Primary

- **Match-Night Orange** (`accent`): game destinations, primary buttons, headline emphasis, notable player numbers, active navigation, and keyboard focus.
- **Warm Orange Hover** (`accent-hover`): primary-button hover feedback.
- **Action Charcoal** (`action-ink`): readable dark text on orange buttons.

### Secondary

- **Blue Team** (`blue`): blue score values and blue-win results.
- **Red Team** (`red`): red score values and red-win results.

### Neutral

- **Server Charcoal** (`bg`): page and header canvas.
- **Panel Charcoal** (`surface`): queue panel, mobile navigation, and subtle list hover surfaces.
- **Raised Charcoal** (`raised`): selected filters, flyout menu, avatar fallback, and small interactive hover surfaces.
- **Warm White** (`ink`): main text, light buttons, and primary record values.
- **Record Grey** (`muted`): metadata, supporting copy, timestamps, and unavailable states.
- **Divider Grey** (`line`): panel strokes and one-pixel record separators.

**The Action and Team Rule.** Orange identifies actions and emphasis. Blue and red identify teams; accompany team color with a readable label.

The warmer story surface, queue-slot fills, and speedrun red-orange treatment are component-local colors. They do not change the shared team semantics.

## Typography

**Display Font:** Barlow Condensed, with sans-serif fallback; self-hosted bold and extra-bold weights.
**Body Font:** Barlow, with sans-serif fallback; self-hosted regular, medium, semibold, and bold weights.

**Character:** Compressed, forceful headings recall competitive game lettering. Barlow keeps names, controls, and statistics legible at the denser sizes used by the community records.

### Hierarchy

- **Display:** the frontmatter display role drives the hero. Responsive overrides use (76px) at (1150px), (66px) at (900px), (78px) at (640px), and (70px) at (360px); these are intentional composition changes.
- **Headline:** section headings use the headline role; responsive sizes reduce to (30px), (28px), and (26px).
- **Title:** player story names and story headings use condensed bold type, commonly (26px), with feature names at (38px) and map names at (30px).
- **Body:** the body role is the page baseline. Hero supporting copy uses (19px); supporting prose generally uses (13–17px).
- **Label:** metadata is generally (12px). Uppercase status labels use the label role; score team labels use (11px) with (0.025em) tracking.
- **Numeric emphasis:** queue counts use the queue-count role, reducing to (64px) on phones. Scores use condensed bold (27px), story numbers use (44px), and feature statistics use extra-bold (64px). Queue counts, scores, ranks, and Elo use tabular numerals.

**The Condensed Emphasis Rule.** Use Barlow Condensed for display headings and prominent counts. Keep descriptive copy, navigation, and metadata in Barlow.

## Layout

The centered container reaches (1440px) maximum width. Outer gutters are (40px) per side on wide screens, (24px) at and below (1150px), and (16px) at and below (640px). Section boundaries generally use (40–54px) of vertical separation; record interiors use tighter (8–24px) rhythm.

The wide opening pairs a flexible scene with a queue column (340px), separated by (20px). Queue widths reduce to (300px) at (1150px), then (280px) at (900px). The desktop hero is at least (470px) high, changes to (450px) at (900px), and becomes a single-column (395px) scene above the queue at (640px). At (1500px) and above, the hero increases to (480px) and the class art grows.

The records section uses a flexible match column and a (340px) standings column with a (40px) gap. At (900px), standings move below matches and form two columns; at (640px), standings become one column. Match rows use thumbnail, information, score, result, and arrow columns; phone rows hide the result column while retaining explicit BLUE/RED score labels and an accessible result description.

Community stories use two columns with a feature-to-secondary ratio of (1.08:1), becoming equal columns at (900px), then stacked at (640px). Map tiles use three columns with (20px) gaps; phones use one column with (14px) gaps. Maps have an aspect ratio of (1.64) on wide screens and (1.6) on phones. Each tile uses full available width and a zero minimum width so its image composition cannot force the grid beyond the container.

The header is (94px) tall, then (82px) below (1150px) and (76px) below (640px). Desktop navigation gives way to a two-column expandable mobile navigation below (900px). Search opens beneath the header in normal document flow. At (360px), the wordmark subtitle gives way to the compact brand mark.

## Elevation & Depth

Depth comes from tonal layering, crisp dividers, image overlays, and the class cutout. Data rows remain flat. The queue uses a surface tone with a one-pixel border, while photo sections use dark gradients to keep typography readable. The header is in document flow.

### Shadow Vocabulary

- **Navigation flyout:** `0 12px 30px #0005`; a structural shadow distinguishes the opened More menu.
- **Class artwork:** `drop-shadow(0 10px 24px #0009)`; a transparent-image shadow separates the hero class from the scene.

**The Flat Records Rule.** Separate records with tone and one-pixel dividers. Reserve shadows for the navigation flyout and isolated class artwork.

## Shapes

Main image containers, queue panels, and the featured story use the surface radius. Buttons, avatars, and mobile navigation use the control radius; filters, small thumbnails, and queue slots use the compact radius. The flyout uses the menu radius. Status dots and the standings arrow action are circular.

Image containers clip to their rounded boundaries; the hero class intentionally extends below the scene boundary and is clipped by the hero. Icons are simple outline SVGs, generally (20px), with (1.7px) strokes. Decorative class art stays outside the reading and accessibility hierarchy.

## Components

### Data Pages and Specialist Views

All routes use the same brand, navigation, player search, warm orange action color,
and Barlow type families. `surfaces.css` supplies shared typography, dividers,
forms, tables, focus states, and the charcoal palette. Route styles extend it for
pickups, speedruns, community tools, and spectators.

Match history combines filter controls, a scrollable archive, and a selected
match report; phone layouts stack those areas. Standings combine a compact top
three with a searchable table. Profiles retain detailed kill-event controls,
recent games, charts, relationships, and match drawers. Map histories retain
their authentic map preview and outcome charts. Summary metrics use flat strips
and dividers rather than decorative elevated cards.

Speedruns retain map and runner catalogs, class filters, personal records,
record progression charts, and 3D replay comparisons. Community views retain
their existing analytics, comparisons, missed-vote history, honors, predictions,
MVP explanations, and identity-history controls. Administration retains its
existing access rules and controls.

Replay and spectator views prioritize the canvas. Charcoal controls, readable
metadata, orange actions, and native red/blue teams connect their chrome to the
rest of the site. Missing replay selection includes a recovery link to the
match archive. The browser launcher keeps the existing runtime under `/live/`.

Copied baseline layouts in `styles/` remove the original global effects and
forced declarations; the root site's CSS is not altered. Keep `scripts/` route
hooks intact when improving presentation. Internal links must resolve inside
`/refactor/`; APIs and game assets remain shared at their existing root paths.

### Buttons and Links

Primary buttons combine orange fill and dark bold text, with a (22px) label-to-icon gap. The small header variant uses a (10px) gap and the smaller dimensions in frontmatter. On phones its minimum height increases to (44px). The light speedrun button uses warm white fill. Text links combine a compact semibold label and an arrow; hover adds orange and an underline offset (5px).

Primary buttons transition background and text color over (200ms). Shared interactive focus uses a (2px) orange outline offset (5px). Disabled buttons reduce opacity to (0.55) and display a waiting cursor. Circular arrow actions are (40px) square with a one-pixel divider border.

### Search Input

The search field is open and underlined rather than boxed. A row combines an outline search icon, the flexible input, and a close action; its bottom border is orange. Text is (20px), reducing to (18px) on phones. Placeholder text is muted and the caret is orange.

Search begins after two characters, debounces for (250ms), and cancels stale requests. Results use avatar, player name, rating visibility text, and arrow; they cap their scroll area at (330px). Opening search focuses the field. Escape and the close control restore focus to its trigger.

### Navigation

The brand mark is `NN//`, with warm orange slashes. The wordmark pairs
`NONAME` with `ALL GAME`; the homepage keeps its NoName / All Game headline.
This identity appears in the header and footer of every refactor route.

### Complete Leaderboard

The leaderboard has a dedicated stylesheet after the shared styles and does
not import the original global theme. Its three leaders reserve a column for
the original rank artwork (96px wide, 144px tall; 88px by 132px on phones).
Player identity, Elo, win rate, and games sit alongside that artwork.
Highlights occupy four columns on desktop and two on phones. The standings
use charcoal cells, tabular numbers, plain trend lines, and a last-ten legend
with an outline marking MVP results. Below 700px, rows become labeled stat
blocks with every column retained. Player filtering preserves the actual rank.

Desktop links use Barlow semibold (15px), with orange text and a (3px) bottom rule for the current page. The More disclosure opens a (224px) raised panel. Hover uses orange. Mobile links use padded surface-colored cells; the expanded community tools retain the two-column structure. Search and the mobile menu close one another; Escape restores appropriate trigger focus.

### Filters

Recent-match filters use small rounded text buttons. Default labels are muted; hover adds a panel fill and warm white text; the selected filter uses the raised fill and `aria-pressed`. Phone filters have a minimum height (44px). Red/blue filters operate on the latest twelve loaded results; up to five matching rows are displayed.

### Queue Panel and Slots

The queue is a bordered charcoal container with a condensed count, uppercase snapshot label, numbered slots, supporting state text, and a full-width orange destination. Slot borders use the shared line color; filled slots gain a warm brown surface, peach initials, and stronger type. Slots are (42px) high in four columns on desktop, then (37px) high in eight columns on phones.

The queue refreshes every (15 seconds) while visible and immediately on returning to the tab. Manual refresh remains available. Loading, confirmed empty, full, and unavailable states use different text and counts; unavailable counts use an em dash. A genuine active match gains orange status emphasis and a watch destination.

### Match and Player Records

Match rows use one-pixel bottom rules and a subtle background hover over (180ms). Desktop thumbnails are (76×49px), reducing at each smaller composition. A missing map image is represented by an outline map icon on a raised surface. Blue/red scores remain labeled. Entire rows link to their real destination.

Standings combine rank, avatar (33px), player identity, career games, and tabular Elo. Hover emphasizes the player name in orange. Failed avatars become a text fallback. The visible ladder contains up to five public ratings with at least ten career games.

### Community Stories

The featured story uses a warm charcoal-brown fill, generous padding, a large real player name, and an orange numeric stat. A decorative Medic cutout connects the record to TFC. Each secondary story is one full-row anchor containing an orange number, the player name as its heading, a compact record-context paragraph, and an arrow. The player heading uses condensed bold type (26px) with line height (1.1); hover turns the heading and arrow orange. These rows retain the shared visible keyboard focus. Long names may wrap; all figures come from the API.

### Map Tiles and Speedrun Scene

Map tiles combine a real battleground image, dark bottom gradient, condensed title, pickup count, and arrow. Hover scales imagery to (1.04) over (500ms) with the shared ease. The three selected maps have real available imagery and are ordered by pickup count.

The speedrun section uses a red-orange material with authentic concjump scenery, a two-line condensed headline (64px), light action button, and small uppercase captions. It is at least (295px) high on desktop and (375px) on phones, where copy becomes one column.

### Hero Class Artwork and Controls

The hero layers an authentic wide TFC scene, a left dark gradient, compressed title, game destination, and decorative class cutout. Its desktop art box is (230px) wide, reducing to (185px) and (150px). The cutout rotates by (-3 degrees) and enters over (850ms) with the shared ease.

The active manifest-driven rotation uses a shuffled bag at (12-second) intervals: all ten available classes appear once per active bag before that bag repeats, and an immediate repeat between bags is avoided. Images decode before replacement. A (180ms) fade accompanies changes; Next and Pause/Play provide explicit control, with (44px) tall targets. Controls only appear when at least two valid artwork entries are available. Automatic rotation defaults off for reduced motion and suspends in hidden tabs; manual Next remains available. The initial static Soldier is a loading fallback and remains usable if the manifest is unavailable; failed artwork is excluded from subsequent bags.

The reduced-motion media query disables CSS animation, transitions, and smooth scrolling throughout the page. Interaction and live data remain functional without movement.

## Do's and Don'ts

### Do:

- **Do** use the source CSS custom properties for shared colors and font families.
- **Do** combine authentic TFC imagery with dark overlays that protect the text.
- **Do** keep team names visible alongside red and blue score colors.
- **Do** show loading, empty, and unavailable data as distinct readable states.
- **Do** preserve visible keyboard focus and user control over automatic class rotation.
- **Do** use the implemented responsive grid changes instead of shrinking desktop rows indefinitely.

### Don't:

- **Don't** substitute invented players, records, queue presence, or statistics for unavailable API data.
- **Don't** use team blue or red as the primary action color.
- **Don't** wrap every data record in an elevated card.
- **Don't** make the class artwork or animation necessary to understand or operate the page.
- **Don't** expose hidden ratings in standings or player search.
