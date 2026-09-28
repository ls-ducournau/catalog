# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- Node floor raised from 20 to 22 (Node 20 reached end of life 2026-04-30); added `.nvmrc`.
- `scripts/preflight.mjs` no longer follows symlinked files when walking a directory.
- `reference/design-systems.md`: US public-sector row and install command now point at `@uswds/uswds` (v3) instead of the superseded `uswds` package.

## [2.0.0] - 2026-09-21

### Added
- `reference/core-rules.md`: ported taste-skill v2 sections that pre-flight already referenced but the skill never taught: 4.1 (Typography), 4.2 (Color Calibration), 4.4 (Materiality, Shadows, Cards), 4.8 (Image & Visual Asset Strategy), 4.9 (Content Density), 4.11 (Page Theme Lock), and 8 (Dark Mode Protocol).
- `reference/design-systems.md`: added the `5.A Sticky-Stack` heading, `5.D Forbidden Animation Patterns`, and `11. REDESIGN PROTOCOL` (11.A-11.F).
- `reference/pre-flight.md`: split the 62-box matrix into a universal `Pre-Flight: Universal Core` (~17 boxes) plus `Addendum A: Landing / Marketing Pages` and `Addendum B: React / Next`, so plain-HTML and non-React work no longer runs React-only boxes.
- `SKILL.md`: a `Routing` table (task type -> reference files -> pre-flight register) and a `Section index` mapping every section number to the file that owns it.
- `scripts/preflight.mjs` and `scripts/fixtures/{dirty,clean}.html`: a zero-dependency Node scanner for the mechanical failures (em dash, `transition: all`, missing `:focus-visible`, `z-index` scale, `scale(0)` entries, and more).
- `scripts/upstream-drift.sh` and `scripts/upstream-snapshot.txt`: report-only drift check against the four upstream files this skill ported or copied from.
- `.claude-plugin/plugin.json`: plugin manifest for marketplace discovery.
- `license` and `metadata.version` fields in the `SKILL.md` frontmatter.
- This `CHANGELOG.md`.

### Changed
- Removed every literal em dash (U+2014) from `SKILL.md`, `README.md`, `NOTICE`, and `reference/*.md`; the ban statements that used to print the character now name it as U+2014 (and U+2013 for the en-dash-as-separator case) instead.
- `reference/anti-slop.md`: the dangling link to an unshipped `brand.md` file now points at `core-rules.md` Section 4.2; "Codex-specific"/"codex" wording replaced with "AI" (this is a Claude skill).
- `reference/design-systems.md`: Section 3's default architecture is now conditional ("when the brief is a React/Next app") instead of an unconditional default; `7. DIAL DEFINITIONS` moved below the scroll-choreography section so the file reads 0,1,2,3,5,7,11,Install Commands.
- `reference/motion.md`: Core Philosophy trimmed to a one-line pointer at SKILL.md's own Philosophy section.
- `NOTICE` and `README.md`: structure diagram, license table, and reference-file list updated for `core-rules.md`.

### Fixed
- Every dangling "Section N" cite in the repo (taste-skill 4.1/4.2/4.4/4.8/4.9/4.11, 5.A, 5.D, 8, 11) now resolves to a real heading instead of a section the skill never ported.
- The `transition: all` contradiction between `design-systems.md`'s MOTION_INTENSITY dial and `pre-flight.md`'s own ban: the dial now recommends explicit `transform`/`opacity` transitions.

### Removed
- `reference/motion.md`'s duplicate `Review Format` and `Review Checklist` sections; `reference/pre-flight.md` remains the single home for both.

## [1.0.0] - 2026-05-31

Initial release: a merged synthesis of [emilkowalski/skill](https://github.com/emilkowalski/skill) (MIT), [pbakaus/impeccable](https://github.com/pbakaus/impeccable) (Apache-2.0), and [leonxlnx/taste-skill](https://github.com/leonxlnx/taste-skill) (MIT) into one `design-taste` skill for Claude Code and Cowork.
