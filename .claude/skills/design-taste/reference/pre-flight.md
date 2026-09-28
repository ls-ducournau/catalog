# 14. Pre-Flight & Review

> The Iron Law: never ship the first version. Build it, then run these checks with fresh, critical eyes. Sources: emil (review format + checklist) and taste-skill (pre-flight matrix).

**Run this first:** `node <this-skill-dir>/scripts/preflight.mjs <file-or-dir>` (the script ships inside this skill's directory, not the project; use its full path) catches the mechanical failures (em dash, `transition: all`, missing focus-visible, z-index scale, `scale(0)` entries, and more) before you get to the boxes below.

## Review Format (required when reviewing UI code)

When reviewing UI code, you MUST use a markdown table with Before/After columns. Do NOT use a list with "Before:" and "After:" on separate lines. Always output an actual markdown table like this:

| Before | After | Why |
| --- | --- | --- |
| `transition: all 300ms` | `transition: transform 200ms ease-out` | Specify exact properties; avoid `all` |
| `transform: scale(0)` | `transform: scale(0.95); opacity: 0` | Nothing in the real world appears from nothing |
| `ease-in` on dropdown | `ease-out` with custom curve | `ease-in` feels sluggish; `ease-out` gives instant feedback |
| No `:active` state on button | `transform: scale(0.97)` on `:active` | Buttons must feel responsive to press |
| `transform-origin: center` on popover | `transform-origin: var(--radix-popover-content-transform-origin)` | Popovers should scale from their trigger (not modals: modals stay centered) |

Wrong format (never do this):

```
Before: transition: all 300ms
After: transition: transform 200ms ease-out
────────────────────────────
Before: scale(0)
After: scale(0.95)
```

Correct format: A single markdown table with | Before | After | Why | columns, one row per issue found. The "Why" column briefly explains the reasoning.

---

## Motion Review Checklist (from emil)

When reviewing UI code, check for:

| Issue                                      | Fix                                                              |
| ------------------------------------------ | ---------------------------------------------------------------- |
| `transition: all`                          | Specify exact properties: `transition: transform 200ms ease-out` |
| `scale(0)` entry animation                 | Start from `scale(0.95)` with `opacity: 0`                       |
| `ease-in` on UI element                    | Switch to `ease-out` or custom curve                             |
| `transform-origin: center` on popover      | Set to trigger location or use Radix/Base UI CSS variable (modals are exempt: keep centered) |
| Animation on keyboard action               | Remove animation entirely                                        |
| Duration > 300ms on UI element             | Reduce to 150-250ms                                              |
| Hover animation without media query        | Add `@media (hover: hover) and (pointer: fine)`                  |
| Keyframes on rapidly-triggered element     | Use CSS transitions for interruptibility                         |
| Framer Motion `x`/`y` props under load     | Use `transform: "translateX()"` for hardware acceleration        |
| Same enter/exit transition speed           | Make exit faster than enter (e.g., enter 2s, exit 200ms)         |
| Elements all appear at once                | Add stagger delay (30-80ms between items)                        |

---

## Pre-Flight: Universal Core

Run this matrix before outputting code. This is the last filter. Applies to any UI, any stack.

**THIS IS NOT OPTIONAL. Run every box. If any box fails, the output is not done.**

- [ ] **Brief, dials and system** declared: Design Read (Section 0.B), dial values explicit and reasoned from the brief (not silently using baseline), design system chosen from Section 2 if applicable or aesthetic labeled honestly, one design system per project (no two systems mixed)?
- [ ] **Redesign mode** detected and audit performed (if applicable, Section 11)?
- [ ] **ZERO em-dashes (U+2014) anywhere on the page.** Headlines, eyebrows, pills, body, quotes, attribution, captions, buttons, alt text. Zero. (Section 9.G - non-negotiable.)
- [ ] **Theme, accent and shape locks**: ONE theme for the whole page, no section flips to inverted mode mid-page (Section 4.11); one accent color used identically across all sections (Section 4.2); one corner-radius system applied consistently (Section 4.4)?
- [ ] **Contrast**: every CTA text is readable against its background (no white-on-white, WCAG AA 4.5:1); form inputs, placeholders, focus rings, labels all pass WCAG AA against the section background; body text ≥4.5:1?
- [ ] **Type discipline**: no CTA label wraps to 2+ lines at desktop; if a serif is used it is NOT Fraunces or Instrument_Serif (or it is, with explicit brand justification) and different from your previous project; every italic word with a descender (`y g j p q`) reserves extra line-height and bottom padding so the descender is not clipped?
- [ ] **Copy Self-Audit**: every visible string re-read, no grammatically-broken or AI-hallucinated phrases ("free on its past" type) shipped?
- [ ] **Motion**: every animation can be justified in one sentence (hierarchy / storytelling / feedback / state transition), no animation-for-show; if `MOTION_INTENSITY > 4` the page actually animates, not just claimed; no `window.addEventListener('scroll')` anywhere, using Motion `useScroll()` / ScrollTrigger / IntersectionObserver / CSS scroll-driven animations only; reduced motion wrapped for everything `MOTION_INTENSITY > 3`?
- [ ] **Dark mode** tokens defined and tested in both modes?
- [ ] **Responsive**: high-variance layouts collapse to an explicit single column below 768px (full width, consistent horizontal padding, centered max-width container); full-height sections use a dynamic viewport-height unit, never the static viewport-height unit or a JS-measured height?
- [ ] **Empty / loading / error** states provided, alongside the rest of the eight required interaction states (default, hover, focus, active, disabled)?
- [ ] **Layout restraint**: cards omitted in favor of spacing where possible; one divider convention per list or table, not `border-t` + `border-b` on every row; no decorative status dots (zero by default, only for real semantic state)?
- [ ] **No fake visuals**: NO div-based fake screenshots, NO hand-rolled decorative SVGs; icons from an allowed library only (Phosphor / HugeIcons / Radix / Tabler), no hand-rolled SVG paths?
- [ ] **Fake-precise numbers** (`92%`, `4.1×`, `48k`) either come from real data or are explicitly labeled as mock, never invented spec aesthetics (Section 4.9)?
- [ ] **Navigation on ONE line** at desktop, height ≤ 80px?
- [ ] **No AI Tells** from Section 9 (Inter as default, AI-purple, three-equal cards, Jane Doe, Acme, "Quietly in use at")?
- [ ] **Core Web Vitals** plausibly hit (LCP < 2.5s, INP < 200ms, CLS < 0.1)?

If a single checkbox cannot be honestly ticked, the page is not done. Fix it before delivering.

---

## Addendum A: Landing / Marketing Pages

Run these in addition to the Core above when the brief is a landing page, marketing site, or portfolio.

- [ ] **Premium-consumer palette check**: if the brief is premium-consumer (cookware / wellness / artisan / luxury), the palette is NOT the AI-default beige+brass+oxblood+espresso family? Different family from your previous premium-consumer project?
- [ ] **Content density** sane: no 20-row data tables, ≤ 25-word sub-paragraphs by default; long lists (> 5 items) use the right UI component per Section 4.9, not a default `<ul>` with `divide-y`?
- [ ] **Real images used** (gen-tool first, then Picsum-seed, then explicit placeholder slots), NO pure-text minimalism?
- [ ] **Hero fits the viewport**: headline ≤ 2 lines, subtext ≤ 20 words AND ≤ 4 lines, CTA visible without scroll, font scale planned around image?
- [ ] **Hero top padding**: max `pt-24` at desktop, hero content does not float halfway down the viewport?
- [ ] **Hero stack discipline**: max 4 text elements in hero (eyebrow OR brand strip, headline, subtext, CTAs)? No tiny tagline below CTAs, no trust micro-strip in hero?
- [ ] **EYEBROW COUNT (mechanical)**: count instances of `uppercase tracking` micro-labels above section headlines across all components. Count ≤ ceil(sectionCount / 3)? Hero counts as 1.
- [ ] **Split-Header Ban**: no "left big headline + right small explainer paragraph" pattern as a section header (vertical stack instead)?
- [ ] **Zigzag Alternation Cap**: no 3+ consecutive sections with the same image+text-split layout?
- [ ] **No Duplicate CTA Intent**: no two CTAs with the same intent ("Get in touch" + "Let's talk" both on page = Fail)?
- [ ] **Logo wall = logo only**: no industry / category labels printed below logos?
- [ ] **Bento Background Diversity**: at least 2-3 bento cells have real visual variation (image, gradient, pattern), not all white-on-white text cards?
- [ ] **"Used by / Trusted by" logo wall** lives UNDER the hero, not inside it, uses REAL SVG logos (Simple Icons / devicon) or generated SVG marks, NOT plain text wordmarks?
- [ ] **Marquee max-one-per-page**: no two horizontal marquees on the same page?
- [ ] **Section-Layout-Repetition** check: no two sections share the same layout family (at least 4 different families across 8 sections)?
- [ ] **Bento has rhythm AND exact cell count** (N items → N cells, no empty cells in middle or at end)?
- [ ] **No pills/labels overlaid on images** (no `Plate · Brand`, no `Field notes - journal`)?
- [ ] **No photo-credit captions as decoration** (`Field study no. 12 · Ines Caetano`)?
- [ ] **No version footers** (`v1.4.2`, `Build 0048`) on marketing pages?
- [ ] **No micro-meta-sentences** under eyebrows ("Each of these is a feature we ship today...")?
- [ ] **No decoration text strip at hero bottom** (`BRAND. MOTION. SPATIAL.`)?
- [ ] **No floating top-right sub-text** in section headings?
- [ ] **No scoring/progress bars with filled background tracks** as comparison visuals?
- [ ] **No locale / city-name / time / weather strips** unless brief is genuinely globally-distributed or place-focused?
- [ ] **No scroll cues** (`Scroll`, `↓ scroll`, `Scroll to explore`)?
- [ ] **No version labels in hero** (V0.6, BETA, INVITE-ONLY) unless the brief is a launch?
- [ ] **No section-numbering eyebrows** (`00 / INDEX`, `001 · Capabilities`, `06 · how it works`)?
- [ ] **Quotes ≤ 3 lines** of body, attribution clean (no em-dash)?

---

## Addendum B: React / Next

Run these in addition to the Core above when the brief is a React or Next.js app. See `reference/design-systems.md` Section 3 for the default stack (RSC, Tailwind v4, Motion) and when it applies.

- [ ] **GSAP sticky-stack / horizontal-pan** implemented per Section 5.A / 5.B canonical skeleton (`start: "top top"`, `pin: true`, correct scrub)?
- [ ] **`useEffect` animations** have strict cleanup functions?
- [ ] **Motion** isolated in client-leaf components with `'use client'` at the top, memoized?
