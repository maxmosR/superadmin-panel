---
name: BirraOra Operator Console
description: The internal console where BirraOra operators set up restaurants, owners, domains, sections and delivery zones.
colors:
  signal-blue: "oklch(0.65 0.2 250)"
  signal-blue-foreground: "oklch(0.98 0 0)"
  alarm-red: "oklch(0.6 0.25 15)"
  go-green: "oklch(0.6 0.2 140)"
  caution-amber: "oklch(0.7 0.2 60)"
  floor: "oklch(0.98 0 0)"
  panel: "oklch(1 0 0)"
  ink: "oklch(0.15 0 0)"
  quiet-ink: "oklch(0.45 0 0)"
  well: "oklch(0.96 0 0)"
  chip-grey: "oklch(0.95 0 0)"
  hairline: "oklch(0.9 0 0)"
  field-border: "oklch(0.88 0 0)"
typography:
  page-title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.33
  section-title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.33
  data-mono:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.33
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
components:
  button-primary:
    backgroundColor: "{colors.signal-blue}"
    textColor: "{colors.signal-blue-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-outline:
    backgroundColor: "{colors.floor}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-ghost:
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-ghost-hover:
    backgroundColor: "{colors.chip-grey}"
  button-destructive:
    backgroundColor: "{colors.alarm-red}"
    textColor: "{colors.panel}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  input:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
    height: "36px"
  card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "24px"
  badge-secondary:
    backgroundColor: "{colors.chip-grey}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "2px 8px"
  readiness-chip:
    textColor: "{colors.caution-amber}"
    rounded: "{rounded.full}"
    padding: "0 6px"
---

# Design System: BirraOra Operator Console

## Overview

**Creative North Star: "The Control Room"**

The console is where a small BirraOra team keeps many restaurants running. Like a control room, it is calm at rest and loud only where something needs attention. Surfaces are neutral greys with no hue. Type is one family (Geist) at small, working sizes. Colour is kept for state: a restaurant with no owner, zones not set up, unpublished changes, a failed save. An operator should be able to scan a screen and see what needs doing from the colour alone, then confirm it in words.

The look is deliberately plain. This is an internal tool with no brand to project; it follows shadcn's "new-york" conventions so it reads as familiar and predictable. Ambition shows in precision instead: exact states, plain status copy, versioned and reversible changes. The delivery-zones editor is the reference for that: a step-by-step flow, autosave with a visible "Saving… / Saved" line, a draft-vs-live comparison and a confirmation before anything reaches customers.

Density is moderate to high. Tables and forms use 14px body text and 12px secondary text, with tight 8–12px gaps. Pages sit in a centred column (max 1152px for lists, 1400px for the wide sections matrix); the zones editor takes the full viewport with a 420px side panel.

**Key Characteristics:**
- Neutral, hue-free surfaces; one accent (Signal Blue) for the primary action, focus and active state.
- Colour means state, never decoration.
- One type family at working sizes; monospace only for ids, slugs, coordinates and JSON.
- Flat panels separated by 1px hairlines; shadows are minimal.
- Status always shown in words next to colour ("Not set up", "Unpublished changes", "Live v3").

## Colors

A hue-free grey scale carries the whole interface; four saturated colours are reserved for action and state.

### Primary
- **Signal Blue** (`signal-blue`): the one primary action per view (e.g. "New business", "Publish"), focus rings (at 50% alpha, 3px), selected tabs and checkbox accents. Same value in light and dark.

### Tertiary (state colours)
- **Alarm Red** (`alarm-red`): destructive buttons, error alerts, "Not set up" badges, blocker counts on zone steps, unsaved/failed save lines.
- **Caution Amber** (`caution-amber`; in markup usually Tailwind `amber-700` text on `amber-600/40` borders, `amber-50` fill): readiness gaps ("no owner", "no SMS sender"), "Unpublished changes", warnings that need acknowledgement before publishing.
- **Go Green** (`go-green`; in markup `green-700` / `emerald-600`): confirmed good states such as an active payout account or a successful test quote.

### Neutral
- **Floor** (`floor`): page background.
- **Panel** (`panel`): cards, dialogs, popovers; one step lighter than the floor.
- **Ink** (`ink`): primary text and headings.
- **Quiet Ink** (`quiet-ink`): descriptions, secondary cell text, timestamps, helper copy.
- **Well** (`well`): muted fills: table header rows, input fill token, loading areas.
- **Chip Grey** (`chip-grey`): secondary buttons and badges, hover fills on ghost buttons.
- **Hairline** (`hairline`): every border and divider.
- **Field Border** (`field-border`, CSS `--input`): the outline of inputs and selects, one step darker than Hairline so empty fields stay visible on Panel and Well.

### Map colours
The zones map uses its own fixed set, defined in `components/superadmin/zones/zone-map.tsx`: ten ring colours in order (green `#16a34a`, blue `#2563eb`, purple `#9333ea`, orange `#ea580c`, cyan `#0891b2`, …), grey `#9ca3af` for non-deliverable areas, orange `#f97316` for the live outline, near-black `#111827` for cut lines and the centre pin, red `#dc2626` for selected points. Keep ring colours in that order so ring 1 always reads as the same colour in the map, the step list and the comparison table.

### Named Rules
**The State-Only Rule.** Saturated colour appears only to mean something: an action, a state or a warning. If removing the colour would lose no information, remove it.

**The Words-Too Rule.** Every coloured state also carries a text label. Amber and red are never the only signal.

## Typography

**Body Font:** Geist (via `geist/font/sans`, CSS variable `--font-geist-sans`)
**Label/Mono Font:** Geist Mono (`--font-geist-mono`)

**Character:** One neutral grotesque at small sizes, so the data carries the page. Weight, not size, does most of the hierarchy work.

### Hierarchy
- **Page title** (700, 24px, 32px line): one per page, e.g. "Businesses", "Admin panel sections". Always followed by a one-line Quiet Ink description at 14px.
- **Section title** (600, 16px, tight): card titles such as "3 restaurant(s)" and dialog section headings.
- **Body** (400, 14px, 20px line): table cells, form inputs (16px on mobile to avoid zoom), alert text.
- **Label** (500, 12px): table secondary lines, badges, autosave status, form hints.
- **Data mono** (400, 12px): slugs, ids, coordinates, JSON fields.

### Named Rules
**The Two-Sizes Rule.** Working screens use 14px and 12px. 24px is for the page title only. Don't add sizes in between.

**The Ten-Pixel Floor.** Nothing goes below 12px for new work. The existing 10–11px badges and chips are a known exception to fix, not a pattern to copy.

## Layout

- **Page frame:** a full-width header bar with a bottom hairline, then a centred `main` column, 16px side padding (24px from 640px), 24px top padding. Every page uses the same 1152px column; narrow pages (Operators) left-align a 768px block inside it, and wide tables scroll inside their card.
- **Page head:** title and description on the left, the one primary action on the right, 24px below.
- **Lists:** a Card containing a table that scrolls horizontally inside its own container on narrow screens. Actions sit right-aligned in the last column.
- **Zones editor:** full viewport. Header (back link, restaurant name, Export / Import / Discard draft), full-width alerts stacked under it with square corners, then a two-column grid: map on the left, a 420px step panel on the right with its own scroll. Below the desktop breakpoint the editor switches to a read-only map with a message explaining why.
- **Rhythm:** 8px between related controls, 12px between groups in a row, 16px inside panels, 24px between page blocks.

## Elevation & Depth

Flat. Depth comes from the Floor/Panel tonal step and 1px hairlines, not shadows. Buttons, inputs and cards carry shadcn's near-invisible `shadow-xs` / `shadow-sm`. Dialogs and popovers sit on a dimmed overlay with `shadow-lg`. Map overlays (search box, legend) use `shadow-md` so they read above the map tiles.

### Named Rules
**The Hairline Rule.** Separate things with a 1px Hairline border or a Floor/Panel step. Never stack shadows to create hierarchy.

## Shapes

Gently rounded, from one base radius (`--radius`, 8px): 6px for buttons, inputs and badges, 8px for alerts and table wrappers, 12px for cards and dialogs. Pills (`rounded-full`) are only for readiness chips and the coloured ring dots in the zones list. Alerts that span the full width of the zones editor drop their radius and side borders so they read as bars, not cards.

## Components

### Buttons
Plain and compact.
- **Shape:** gently rounded (6px), 36px tall by default, 32px for the `sm` size used in tables and headers.
- **Primary:** Signal Blue fill, near-white text, 16px horizontal padding, 14px medium text. One per view.
- **Outline:** Floor fill with a Hairline border, for secondary page actions ("Sign out", "Retry", "Export JSON").
- **Ghost:** no fill until hover (Chip Grey), for row actions ("Edit", "Delivery zones") and header links.
- **Destructive:** Alarm Red fill, white text. Use for the final confirm of a destructive action, not for the row button that opens it.
- **Focus:** 3px Signal Blue ring at 50% alpha plus a ring-coloured border. **Disabled:** 50% opacity, no pointer events.
- **Icons:** lucide-react at 16px, placed before the label with an 8px gap.

### Chips and badges
- **Badge:** 12px medium text, 6px radius, 2px × 8px padding. Variants: `secondary` (Chip Grey; neutral facts like "Live v3", "none"), `destructive` (Alarm Red; "Not set up"), `outline` with amber border and text ("Unpublished changes").
- **Readiness chip:** pill-shaped, amber border at 40% alpha, amber-700 text, for setup gaps under a restaurant name ("no owner", "no SMS sender").

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** Panel on Floor.
- **Shadow Strategy:** `shadow-sm` only (see Elevation & Depth).
- **Border:** 1px Hairline.
- **Internal Padding:** 24px vertical, 24px horizontal; 24px gap between header and content.

### Inputs / Fields
- **Style:** 36px tall, 1px Field Border, transparent fill, 6px radius, 12px horizontal padding, 14px text (16px on mobile).
- **Focus:** Signal Blue border plus the 3px 50% ring, same as buttons.
- **Error:** `aria-invalid` turns the border Alarm Red with a 20% red ring. **Disabled:** 50% opacity, not-allowed cursor.
- **Labels:** 14px medium, 8px above the field, tied to the input with `htmlFor`/`id`.

### Tables
14px text, header row in Quiet Ink at 500 weight, 1px Hairline between rows, row hover in Well at ~50%. The first column holds the record name in 500 weight with a 12px Quiet Ink line under it (abbreviation or slug). Wide matrices keep the first column sticky.

### Navigation
One shared header on every console page (`ConsoleShell`), on Panel with a bottom Hairline, 1152px wide on every page so it never moves; wide tables such as the sections matrix scroll inside their own card:
- **Left:** a 20px ShieldCheck icon in Signal Blue and "Operator console" in 600 weight, linking home.
- **Sections:** Restaurants, Operators, Admin panel sections, as 44px-tall text tabs in Quiet Ink. The current page is Ink with a 2px Signal Blue underline and `aria-current="page"`. Below 768px the tabs take their own row and scroll sideways without a scrollbar.
- **Right:** the signed-in email (from 1024px) and an outline "Sign out".
- Narrow pages (Operators) keep the full-width header and left-align their content under it.
- The zones editor keeps its own full-screen header with a "← Restaurants" link.

### Page head
Page title (24px, 700) with a one-line Quiet Ink description, and the page's one primary button on the right (it wraps under the title on phones).

### Setup checklist (signature)
How the console shows whether a restaurant can take orders. The steps come from `lib/readiness.ts` and mirror the storefront's `restaurant_can_take_orders`: Owner, Active domain, SMS sender, Order email, Payout account (only blocking when card is the only payment method), Delivery zones, Opening hours.
- **In the restaurants table:** "Ready to take orders" in green-700 with a check icon, or "Needs setup · 4 of 7 done" with an amber alert icon and a 12px "Missing: …" line. A "Needs setup (n)" filter sits next to the search.
- **In the edit dialog:** a Well-tinted box at the top with a two-column list. Done steps get a green check and Quiet Ink text; open steps get an amber circle (grey if not blocking) and a "Set it below →" link that scrolls to that section, "Open the zones editor →", or a note when the owner does it (opening hours).
- **After creating a restaurant:** the same list, with "Continue setup" opening the edit dialog.

### Autosave status (signature)
A 12px line next to the step controls in the zones editor: spinner + "Saving…" in Quiet Ink, "Saved" in Quiet Ink, "Not saved" in Alarm Red with an inline underlined "Retry", and a red conflict message when another window changed the draft. Reuse this pattern wherever the console saves without an explicit button.

### Zone step panel (signature)
A row of step tabs (Center, Rings, Cut, Pieces, Test, Publish, History) with red count badges for blockers, above a scrolling panel. Ring rows read as a sentence ("up to [km] km → € [fee]") with the ring's map colour as a 12px dot.

## Do's and Don'ts

### Do:
- **Do** keep one Signal Blue primary button per view; everything else is outline or ghost.
- **Do** pair every coloured state with words ("Not set up", "Unpublished changes", "no owner").
- **Do** use the Floor/Panel step and 1px Hairlines for structure.
- **Do** use 14px for working text and 12px for secondary lines; 16px in inputs on mobile.
- **Do** put slugs, ids, coordinates and JSON in Geist Mono.
- **Do** show restaurant status with the setup checklist and `getReadiness`; don't invent a separate status badge.
- **Do** reuse the zones editor patterns (autosave line, step tabs with blocker counts, compare-before-publish) for other multi-step or high-stakes work.
- **Do** keep ring colours in the fixed order from `RING_COLORS` everywhere a ring appears.

### Don't:
- **Don't** use colour for decoration, gradients or tinted backgrounds on neutral content.
- **Don't** add a second accent hue; status colours are for state only.
- **Don't** put small white text on Signal Blue: the pair is about 3.2:1, so keep it to 14px medium button labels and larger.
- **Don't** add new 10–11px text; 12px is the floor.
- **Don't** separate areas with shadows; use a hairline or the tonal step.
- **Don't** show BirraOra or console styling on anything a restaurant's customers see; this system is for the operator console only.
