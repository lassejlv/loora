---
version: alpha
name: Loora
description: Loora's visual language for its canvas, product interface, and public materials.
url: https://loora.design
colors:
  ink: "#1a1917"
  background: "#fafaf8"
  surface: "#ffffff"
  canvas: "#f1f0ec"
  canvas-dot: "#d3d1c9"
  muted: "#75726b"
  ultramarine: "#2440e6"
  vermilion: "#e8442e"
  yellow: "#f5c518"
  green: "#23a25d"
typography:
  sans: Archivo
  mono: Spline Sans Mono
spacing:
  base: 4px
rounded:
  control: 6px
  surface: 12px
  large: 16px
---

# Loora Design

Loora is a minimal canvas for designing real interfaces with an AI agent. Its visual language should feel like a precise creative tool: quiet enough to keep the work in focus, distinctive enough to be recognizable without decoration.

## Principles

- Keep the canvas and the user's work visually dominant.
- Prefer direct manipulation, visible state, and controls close to what they affect.
- Use structure, spacing, and typography before adding decoration.
- Make complexity available when it is needed, not permanently visible.
- Keep actions predictable, reversible where possible, and fully keyboard accessible.
- Spend visual emphasis on the single most important action or state in a view.

## Brand

Write the product name as `loora` in running text and simple wordmarks. The signature lockup is `loora` followed by an ultramarine dot.

The primary logo asset is available at <https://loora.design/logo.png>.

## Color

| Token | Value | Use |
| --- | --- | --- |
| Ink | `#1a1917` | Primary text, icons, and high-emphasis controls |
| Background | `#fafaf8` | Application chrome and page background |
| Surface | `#ffffff` | Dialogs, menus, cards, and raised controls |
| Canvas | `#f1f0ec` | Infinite canvas and creative workspace |
| Canvas dot | `#d3d1c9` | Canvas grid and quiet structural marks |
| Muted | `#75726b` | Secondary text and metadata |
| Ultramarine | `#2440e6` | Focus, selection, links, and the brand dot |
| Vermilion | `#e8442e` | Warm accent or destructive emphasis |
| Yellow | `#f5c518` | Highlight or warning emphasis |
| Green | `#23a25d` | Success and positive status |

Use neutral surfaces for most of the interface. Ultramarine is the primary accent and should identify interaction or state, not fill large decorative areas. Never rely on color alone to communicate status.

## Typography

- **Archivo** is the product and brand sans. Use weights 400–700 with compact, clear hierarchy.
- **Spline Sans Mono** is for shortcuts, code, identifiers, measurements, and tabular data.
- Default interface copy is 14px. Use 12px for supporting labels and 16–24px for compact titles.
- Tighten tracking slightly for large headings; keep body copy comfortably spaced.
- Prefer sentence case for headings, labels, buttons, and messages.

## Layout

Loora uses a 4px spacing foundation. Common steps are 4, 8, 12, 16, 24, 32, and 40px.

- Use 8px within a compact group, 16px between related groups, and 24–40px between sections.
- Align controls deliberately to a grid, edge, or text baseline.
- Let panels and dialogs explain hierarchy through position, border, and surface color.
- Keep dense editor chrome compact while preserving at least a 24px pointer target and a 44px touch target on mobile.
- Verify layouts on mobile, laptop, and wide screens without horizontal overflow.

## Shape and depth

- Use a 6px radius for everyday controls, 12px for floating surfaces, and 16px only for large containers.
- Reserve full pills for statuses, compact filters, and circular controls.
- Prefer a crisp, translucent border before adding a shadow.
- Keep shadows soft and layered. A floating surface should look separated, not glowing.
- Do not stack glass effects or use translucency as decoration.

## Components and interaction

- One primary action per view. Secondary actions use a neutral surface or a quiet text treatment.
- Every interactive element must show a visible `:focus-visible` state.
- Icon-only controls need an accessible name and a tooltip when the action is not obvious.
- Hover, active, selected, disabled, loading, empty, and error states are part of the component design.
- Use native semantics first and ARIA only where native HTML cannot express the behavior.
- Keep menus, popovers, and panels spatially connected to the control that opened them.

## Motion

Motion explains a change in state or position; it is never ambient decoration.

- Keep small state transitions near 150ms, floating surfaces near 200ms, and overlays near 300ms.
- Prefer opacity and transform animations over layout-affecting properties.
- Make interactions interruptible and preserve spatial continuity when panels open or close.
- Honor `prefers-reduced-motion` by removing nonessential movement.

## Voice

Loora is calm, direct, and specific.

- Use active voice and plain verbs: `Save changes`, `Export design`, `Open billing`.
- Name the object an action affects; avoid vague labels such as `Continue` or `Confirm`.
- Describe errors as what happened and what the person can do next.
- Use the ellipsis character for ongoing work: `Opening checkout…`.
- Avoid filler, exaggerated claims, and technical implementation language in product copy.

## Related

- Product: <https://loora.design>
- Pricing: <https://loora.design/pricing.md>

