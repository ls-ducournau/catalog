// scripts/preflight.mjs
//
// Zero-dependency design-taste pre-flight scanner (Node 22+ ESM).
// Usage: node scripts/preflight.mjs <file-or-dir> [...more]
//
// HARD rules (any hit, any file -> exit 1): the em dash, `transition: all`,
// `outline: none` / `outline: 0` with no `:focus-visible` escape hatch
// anywhere in the same file, `z-index` >= 999 (raw CSS or a Tailwind
// arbitrary value), and a `scale(0)` entry animation.
//
// WARN rules (reported, never affect the exit code): a space-padded en dash
// used as a separator, more than 3 distinct `font-family` values, an
// uppercase-tracking micro-label count above ceil(sections / 3), and
// `h-screen` / `100vh`.
//
// ponytail: markdown files (.md) only run the two prose rules (em dash, en
// dash separator). The code-authoring rules (transition:all, scale(0),
// outline, z-index, font-family, uppercase-tracking, viewport units) are
// skipped for .md, because this skill's own reference docs legitimately
// show "here is the banned pattern" inside teaching examples (e.g.
// reference/motion.md's "Never animate from scale(0)" section) -- scanning
// those would self-flag the documentation that explains the ban. Em dash
// and en dash bans are about copy the model writes, not authored CSS/JSX,
// so those two still apply everywhere, prose included. Upgrade path if a
// finer split is ever needed: parse fenced code blocks per language and
// exclude blocks that are explicitly a "wrong"/"bad" example.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const SCAN_EXTENSIONS = new Set([".html", ".css", ".tsx", ".jsx", ".vue", ".svelte", ".md"]);
const SKIP_DIRS = new Set([".git", "node_modules", ".forge"]);

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const EN_DASH_SEPARATOR = new RegExp(`[ \\t]${EN_DASH}[ \\t]`);
// HTML entities and JS/JSX escapes that render the em dash without the glyph.
const EM_DASH_ALIASES = /&mdash;|&#8212;|&#x2014;|\\u\{?2014\}?/i;

// Rule regexes cover raw CSS, JS style objects (React inline style / Motion
// props) and the Tailwind utility spelling, since .tsx/.jsx is where most of
// the target code is written.
const TRANSITION_ALL = /transition:\s*["']?all\b|transition-property:\s*all\b|\btransition-all\b/;
const SCALE_ZERO = /scale\(0\)|\bscale:\s*0(?![.\d])|\bscale-0\b/;
const OUTLINE_OFF = /outline:\s*(none|0)\b|\boutline-(none|hidden)\b/;

function collectFiles(inputPaths) {
  const files = [];
  for (const p of inputPaths) {
    const stat = statSync(p);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(p, { withFileTypes: true })) {
        const full = join(p, entry.name);
        if (entry.isSymbolicLink()) continue; // never follow links out of the scan root
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          files.push(...collectFiles([full]));
        } else if (SCAN_EXTENSIONS.has(extname(entry.name))) {
          files.push(full);
        }
      }
    } else if (SCAN_EXTENSIONS.has(extname(p))) {
      files.push(p);
    }
  }
  return files;
}

function snippet(line) {
  return line.trim().slice(0, 80);
}

function checkFile(path) {
  const content = readFileSync(path, "utf8");
  const lines = content.split("\n");
  const checkCode = extname(path) !== ".md";

  const hard = [];
  const warn = [];
  const outlineHits = [];
  let hasFocusVisible = false;
  const fontFamilies = new Set();
  let sectionCount = 0;
  let microLabelCount = 0;

  lines.forEach((line, idx) => {
    const n = idx + 1;

    if (line.includes(EM_DASH) || EM_DASH_ALIASES.test(line)) {
      hard.push({ n, rule: "EM_DASH", snippet: snippet(line) });
    }
    if (EN_DASH_SEPARATOR.test(line)) {
      warn.push({ n, rule: "EN_DASH_SEPARATOR", snippet: snippet(line) });
    }

    if (!checkCode) return;

    if (TRANSITION_ALL.test(line)) {
      hard.push({ n, rule: "TRANSITION_ALL", snippet: snippet(line) });
    }
    if (SCALE_ZERO.test(line)) {
      hard.push({ n, rule: "SCALE_ZERO_ENTRY", snippet: snippet(line) });
    }
    const zIndex =
      line.match(/z-index:\s*(\d+)/) || line.match(/zIndex:\s*["']?(\d+)/) || line.match(/z-\[(\d+)/);
    if (zIndex && Number(zIndex[1]) >= 999) {
      hard.push({ n, rule: "Z_INDEX_999", snippet: snippet(line) });
    }
    if (OUTLINE_OFF.test(line)) {
      outlineHits.push({ n, snippet: snippet(line) });
    }
    // Either the CSS pseudo-class or the Tailwind `focus-visible:` variant.
    if (/focus-visible/.test(line)) hasFocusVisible = true;

    const sectionTags = line.match(/<section[\s>]/gi);
    if (sectionTags) sectionCount += sectionTags.length;

    // First family only, unquoted, lowercased: `"Geist", sans-serif` and
    // `Geist` are the same family, not two.
    const fontMatch = line.match(/font-family:\s*["']?([^;}"']+)/);
    if (fontMatch) fontFamilies.add(fontMatch[1].split(",")[0].trim().toLowerCase());

    // ponytail: eyebrow heuristic is per-file and per-line. It sees Tailwind
    // class lists and one-line CSS rules only; a multi-line `.eyebrow {}` rule
    // reused across sections counts as zero, and a page composed from
    // per-component files never reaches the section threshold. Upgrade path:
    // count rendered instances from a built HTML page instead of source.
    const microLabel =
      (/uppercase/.test(line) && /tracking-/.test(line)) ||
      (/text-transform:\s*uppercase/.test(line) && /letter-spacing/.test(line));
    if (microLabel) microLabelCount += 1;

    if (line.includes("h-screen") || line.includes("100vh")) {
      warn.push({ n, rule: "VIEWPORT_UNIT", snippet: snippet(line) });
    }
  });

  if (checkCode && outlineHits.length > 0 && !hasFocusVisible) {
    for (const hit of outlineHits) {
      hard.push({ n: hit.n, rule: "OUTLINE_NONE_NO_FOCUS_VISIBLE", snippet: hit.snippet });
    }
  }
  if (checkCode && fontFamilies.size > 3) {
    warn.push({ n: 0, rule: "FONT_FAMILY_COUNT", snippet: `${fontFamilies.size} distinct values` });
  }
  if (checkCode && sectionCount > 0 && microLabelCount > Math.ceil(sectionCount / 3)) {
    warn.push({
      n: 0,
      rule: "EYEBROW_COUNT",
      snippet: `${microLabelCount} labels across ${sectionCount} sections`,
    });
  }

  hard.sort((a, b) => a.n - b.n);
  warn.sort((a, b) => a.n - b.n);
  return { hard, warn };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: node scripts/preflight.mjs <file-or-dir> [...more]");
    process.exit(1);
  }

  const files = collectFiles(args);
  let hardTotal = 0;
  let warnTotal = 0;

  for (const file of files) {
    const { hard, warn } = checkFile(file);
    for (const v of hard) {
      console.log(`${file}:${v.n}  ${v.rule}  ${v.snippet}`);
    }
    for (const v of warn) {
      console.log(`${file}:${v.n}  WARN:${v.rule}  ${v.snippet}`);
    }
    hardTotal += hard.length;
    warnTotal += warn.length;
  }

  console.log(`\n${files.length} file(s) scanned, ${hardTotal} hard violation(s), ${warnTotal} warning(s).`);
  process.exit(hardTotal > 0 ? 1 : 0);
}

main();
