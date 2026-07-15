---
name: quadGEN
description: A calm technical workspace for high-precision QuadToneRIP calibration.
colors:
  canvas-light: "#f9fafb"
  surface-light: "#ffffff"
  surface-subtle-light: "#f3f4f6"
  ink-light: "#111827"
  muted-light: "#374151"
  line-light: "#e5e7eb"
  canvas-dark: "#0a0a0a"
  surface-dark: "#171717"
  ink-dark: "#e5e5e5"
  muted-dark: "#9ca3af"
  line-dark: "#262626"
  action-slate: "#475569"
  focus-blue: "#2563eb"
  focus-blue-dark: "#60a5fa"
  confirm-green: "#10b981"
  process-cyan: "#00b5e2"
  process-magenta: "#ff2a8a"
  process-yellow: "#ffd400"
  process-key: "#1a1a1a"
typography:
  display:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: '"Segoe UI Semibold", "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif'
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0.03em"
  body:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.333
  mono:
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.25
rounded:
  control: "4px"
  compact: "6px"
  field: "8px"
  panel: "12px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  2xl: "24px"
components:
  button-action:
    backgroundColor: "{colors.action-slate}"
    textColor: "{colors.surface-light}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-secondary:
    backgroundColor: "{colors.surface-subtle-light}"
    textColor: "{colors.muted-light}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  input-light:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink-light}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "6px 12px"
  input-dark:
    backgroundColor: "{colors.canvas-dark}"
    textColor: "{colors.ink-dark}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "6px 12px"
  panel-light:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink-light}"
    rounded: "{rounded.panel}"
    padding: "8px"
  panel-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.ink-dark}"
    rounded: "{rounded.panel}"
    padding: "8px"
  tab-active-light:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.muted-light}"
    typography: "{typography.title}"
    padding: "6px 12px"
  tab-active-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.focus-blue-dark}"
    typography: "{typography.title}"
    padding: "6px 12px"
---

# Design System: quadGEN

## Overview

**Creative North Star: "The Calibration Bench"**

quadGEN should feel like the clean working surface beside a controlled-light viewing booth: precise, calm, and arranged around the proof under inspection. The default light theme supports a printmaker comparing paper and screen in a lit studio; the dark theme is an explicit low-light alternative, not the product's assumed personality.

The curve and its measured evidence remain visually primary. Panels are compact, familiar, and mostly flat, with borders and tonal layers establishing structure. The system rejects generic SaaS gloss, consumer photo-filter styling, novelty laboratory chrome, and inconsistent custom controls.

**Key Characteristics:**

- Light-first, with a complete neutral dark counterpart.
- Dense enough for expert calibration, but divided into legible workflow regions.
- Restrained graphite and slate controls with process color reserved for data and identity.
- Familiar browser affordances, visible focus, and state-only motion.
- Flat working surfaces, with elevation reserved for transient overlays.

## Colors

The palette resembles proofing paper, graphite labels, and neutral equipment housings. Saturated color communicates process channels, confirmation, focus, or a consequential state; it is never ambient decoration.

### Primary

- **Tool Slate** (`colors.action-slate`): durable action buttons and compact technical controls.
- **Precision Blue** (`colors.focus-blue`): focus rings and high-clarity interactive emphasis in the light theme.
- **Low-Light Precision Blue** (`colors.focus-blue-dark`): the dark-theme counterpart, tuned for contrast on near-black surfaces.

### Secondary

- **Confirmation Green** (`colors.confirm-green`): successful generation, enabled switches, and affirmative system state. It is semantic, not decorative.

### Tertiary

- **Process Cyan, Process Magenta, Process Yellow, and Process Key** (`colors.process-cyan`, `colors.process-magenta`, `colors.process-yellow`, `colors.process-key`): the quadGEN mark and channel-specific visualization. Always pair channel color with a text label, symbol, or position.

### Neutral

- **Proofing Canvas and Clean Surface** (`colors.canvas-light`, `colors.surface-light`): the light workspace and its working surfaces.
- **Soft Instrument Surface** (`colors.surface-subtle-light`): quiet headers, secondary controls, and code-like chips.
- **Ink and Graphite** (`colors.ink-light`, `colors.muted-light`): primary and secondary light-theme text.
- **Paper Hairline** (`colors.line-light`): panel boundaries and dividers.
- **Darkroom Canvas and Raised Surface** (`colors.canvas-dark`, `colors.surface-dark`): the low-light workspace and panels.
- **Silver Text and Meter Gray** (`colors.ink-dark`, `colors.muted-dark`): primary and secondary dark-theme text.
- **Dark Divider** (`colors.line-dark`): structural separation without luminous outlines.

**The Process Color Rule.** CMYK colors identify channels and the product mark. They never become generic card fills, decorative gradients, or unlabeled status colors.

**The Restrained Accent Rule.** Outside charts and channel indicators, saturated color occupies no more than ten percent of a screen.

## Typography

**Display Font:** System UI sans, with Segoe UI and platform fallbacks

**Body Font:** System UI sans, with Segoe UI and platform fallbacks

**Label/Mono Font:** System UI sans for labels; platform monospace for `.quad` content, measurements, and code

**Character:** The single sans family feels native, neutral, and trustworthy across offline environments. Weight, scale, and compact spacing carry hierarchy; typography never performs as decoration.

### Hierarchy

- **Display** (`typography.display`): the product name and rare top-level headings.
- **Title** (`typography.title`): uppercase workspace tabs and strong panel navigation.
- **Body** (`typography.body`): control descriptions, help content, and concise prose, capped near 70 characters when it forms a reading column.
- **Label** (`typography.label`): buttons, field labels, table headings, and compact state text.
- **Mono** (`typography.mono`): file preview, numeric evidence, and machine-readable content only.

**The Instrument Label Rule.** Labels are short and literal. Uppercase is reserved for workspace navigation, never for paragraphs or routine form labels.

**The Data Type Rule.** Monospace signals data that benefits from character alignment. It is forbidden as a general technical aesthetic.

## Elevation

The workspace is flat by default. One-pixel dividers and tonal surface changes establish hierarchy without floating every region into a card. Only dialogs, tooltips, and other transient layers receive shadows.

### Shadow Vocabulary

- **Dialog lift** (`box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25)`): the Options panel and comparable light-theme dialogs.
- **Low-light dialog lift** (`box-shadow: 0 16px 48px rgba(0, 0, 0, 0.60)`): dark-theme modal surfaces.
- **Tooltip lift** (`box-shadow: 0 8px 16px rgba(0, 0, 0, 0.18)`): small transient explanations above the working plane.

**The Bench Surface Rule.** Persistent panels remain flat. If a static panel needs a large shadow to read as a region, its border, spacing, or tonal hierarchy is wrong.

## Components

Components are compact, familiar, and tactile enough to confirm state without becoming ornamental.

### Buttons

- **Shape:** gently compact controls (`rounded.control`) with bold 12 to 14px labels.
- **Primary:** Tool Slate with light text and 8px by 12px internal spacing (`components.button-action`). Reserve stronger blue or green fills for semantically specific actions.
- **Hover / Focus:** darken one tonal step on hover; show a two-pixel Precision Blue focus outline with a two-pixel offset. Press feedback moves at most two pixels and disappears under reduced motion.
- **Secondary:** Soft Instrument Surface with Graphite text (`components.button-secondary`). Ghost buttons are reserved for tab and icon actions.

### Chips

- **Style:** compact six-pixel corners, Graphite text, and a quiet surface. Channel chips include a labeled process-color swatch.
- **State:** selected chips receive a low-chroma tint plus explicit text or checkbox state. Color alone is insufficient.

### Cards / Containers

- **Corner Style:** gently curved panels (`rounded.panel`) and smaller grouped fields (`rounded.field`).
- **Background:** Clean Surface in light mode and Raised Surface in dark mode (`components.panel-light`, `components.panel-dark`).
- **Shadow Strategy:** no shadow at rest; use a one-pixel theme line for grouping.
- **Border:** Paper Hairline or Dark Divider according to theme.
- **Internal Padding:** eight pixels for dense tool groups, twelve to sixteen pixels for explanatory panels and dialogs.

### Inputs / Fields

- **Style:** native text, number, range, checkbox, radio, and select controls with familiar affordances. Text fields use `components.input-light` or `components.input-dark` and a one-pixel theme line.
- **Focus:** Precision Blue ring plus a visible border shift. Focus may never depend on a subtle color change alone.
- **Error / Disabled:** errors combine semantic color with text; disabled controls retain legible labels and reduce emphasis without disappearing.

### Navigation

Tabs use the title role, a flat shared rail, and one explicit active indicator. Horizontal tabs use a bottom indicator; narrow layouts stack the right-hand tool panel below the chart at 830px. Transitions last 150 to 200ms and communicate state only.

### Curve Workspace

The chart is the signature component. It occupies the largest uninterrupted region, uses neutral grid and axis tokens, and keeps zoom, status, and resize controls visually subordinate. Channel hues describe data series and must remain distinguishable through labels and interaction, not hue alone.

### Dialogs and Tooltips

Dialogs use a dimmed backdrop, a twelve-pixel surface radius, a structural border, and the dialog shadow vocabulary. Tooltips are concise, near-black with light text, six-pixel corners, and a maximum width of 320px.

## Do's and Don'ts

### Do:

- **Do** keep the curve and measured evidence visually primary.
- **Do** use Tool Slate for ordinary actions and reserve saturated color for focus, confirmation, process channels, and consequential state.
- **Do** preserve native radio, checkbox, range, select, number, and text-field behavior.
- **Do** pair every channel color, warning, and selection with a label, symbol, position, or text state.
- **Do** use visible two-pixel focus treatment and maintain WCAG 2.2 AA contrast.
- **Do** keep transitions between 150 and 200ms, state-driven, and removable under reduced motion.

### Don't:

- **Don't** introduce generic SaaS gloss: promotional dashboards, hero metrics, decorative gradients, glass effects, or visual noise that competes with the curve.
- **Don't** imitate consumer photo-filter apps that reduce calibration to presets or hide meaningful processing choices.
- **Don't** imitate novelty laboratory interfaces with dense chrome, tiny labels, theatrical gauges, or instrument cosplay.
- **Don't** create inconsistent custom controls that replace familiar browser affordances without improving the workflow.
- **Don't** extend the current Download button's blue-to-violet gradient. It is a legacy exception, not a reusable design token.
- **Don't** use a colored side stripe wider than one pixel as a card or navigation accent. Existing instances are remediation targets, not precedent.
- **Don't** use process color as decoration or communicate a state through color alone.
- **Don't** add shadows to persistent panels, animate layout properties, or choreograph page-load motion.
