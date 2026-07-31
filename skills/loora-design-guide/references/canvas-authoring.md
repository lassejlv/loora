# Structured Canvas authoring

Use this reference when composing Loora MCP payloads. It covers the model
surface agents most often need; the live MCP tool schema remains authoritative.

## Contents

- [Node hierarchy](#node-hierarchy)
- [Layout](#layout)
- [Style](#style)
- [NodeRefs and temporary refs](#noderefs-and-temporary-refs)
- [Responsive design](#responsive-design)
- [Tokens and themes](#tokens-and-themes)
- [Components and instances](#components-and-instances)
- [State and interactions](#state-and-interactions)
- [Motion](#motion)
- [Images, vectors, and semantics](#images-vectors-and-semantics)
- [Good and bad patterns](#good-and-bad-patterns)

## Node hierarchy

Root nodes are `page` and `component`. Create them with `createPage` and
`createComponent`; do not insert them as ordinary descriptors.

Nested descriptor types:

- `frame`: semantic visual container; may have children
- `group`: structural container; may have children
- `text`: editable text and optional styled runs
- `shape`: rectangle, ellipse, or line
- `vector`: SVG-like viewBox and validated paths
- `image`: owned asset, safe URL, or supported data URL
- `instance`: reference to a component definition

Only frames and groups accept descriptor `children`. Pages and components
accept children through their creation tools.

Give nodes useful names such as `Hero content`, `Primary navigation`, or
`Pricing card — Pro`. Avoid `Frame 12`, `Rectangle`, and names copied from text
that will soon change.

## Layout

A layout patch may include:

```json
{
  "position": "flow",
  "x": 0,
  "y": 0,
  "width": { "unit": "fill" },
  "height": { "unit": "hug" },
  "minWidth": 0,
  "maxWidth": 1200,
  "minHeight": 0,
  "maxHeight": 900,
  "aspectRatio": 1.7778,
  "mode": "flex",
  "direction": "column",
  "wrap": false,
  "gap": 24,
  "padding": {
    "top": 64,
    "right": 64,
    "bottom": 64,
    "left": 64
  },
  "align": "stretch",
  "justify": "start",
  "columns": 3
}
```

Length values are:

```json
{ "unit": "px", "value": 320 }
```

```json
{ "unit": "percent", "value": 50 }
```

```json
{ "unit": "fill" }
```

```json
{ "unit": "hug" }
```

Guidance:

- Use a Page or section frame as a column flex container.
- Use row flex for navigation, paired content, and control groups.
- Use grid for repeated cards or content with stable columns.
- Explicitly set `mode` on every frame/group that will contain laid-out
  children. The descriptor may be placed in parent flow automatically, but its
  own default child layout remains absolute unless its mode is changed.
- Use `fill` for children that should consume available space.
- Use `hug` for content-driven frames and text groupings.
- Set `minWidth: 0` on fill children that must shrink inside rows.
- Use `maxWidth` on centered content frames rather than manually positioning
  every child.
- Use `absolute` only for overlays, intentional layered visuals, or decorative
  artwork. Normal UI in absolute coordinates will not adapt cleanly.

For a three-column grid:

```json
{
  "mode": "grid",
  "columns": 3,
  "gap": 20,
  "width": { "unit": "fill" },
  "height": { "unit": "hug" }
}
```

## Style

A style patch may include:

```json
{
  "fills": [
    {
      "type": "solid",
      "color": { "token": "surface" }
    }
  ],
  "stroke": {
    "color": { "token": "border-subtle" },
    "width": 1,
    "style": "solid"
  },
  "radius": 12,
  "shadows": [
    {
      "x": 0,
      "y": 10,
      "blur": 30,
      "spread": -12,
      "color": "rgba(0,0,0,0.18)"
    }
  ],
  "opacity": 1,
  "overflow": "hidden",
  "blendMode": "normal",
  "typography": {
    "family": "Inter",
    "size": 16,
    "weight": 450,
    "lineHeight": 1.5,
    "letterSpacing": -0.1,
    "align": "left",
    "wrap": true,
    "decoration": "none",
    "transform": "none"
  }
}
```

Fills may also be linear gradients:

```json
{
  "type": "linear-gradient",
  "angle": 135,
  "stops": [
    { "offset": 0, "color": "#16181d" },
    { "offset": 1, "color": "#282d36" }
  ]
}
```

Colors accept safe CSS color values or `{ "token": "id" }`. Do not send CSS
variables, class names, or style strings.

Typography belongs on text nodes. Keep line height unitless. Use a restrained
type scale; a landing Page rarely needs more than display, section heading,
body, label, and caption roles.

Do not assume CSS-like inheritance. New text nodes receive default typography
and no tokenized text fill. On a new themed or dark surface, assign the intended
typography and text color explicitly, then verify it in the screenshot.

## NodeRefs and temporary refs

A NodeRef is:

```json
{
  "nodeId": "text-heading",
  "instancePath": []
}
```

For an instance descendant, `nodeId` identifies the source node inside the
component and `instancePath` identifies the instance chain:

```json
{
  "nodeId": "component-label-source",
  "instancePath": ["instance-pricing-pro"]
}
```

Use exact refs returned by `getDesignContext` or `readTree`.

Descriptor `ref` is different:

```json
{
  "ref": "hero-copy",
  "type": "frame",
  "children": []
}
```

It is a temporary label scoped to that single create/insert call. The response
maps it to a permanent node ID so later calls can address the new node. It is
not a stable ID for future calls.

## Responsive design

Read breakpoint IDs from `getDesignContext`; do not invent them. Put breakpoint
patches in `responsive` keyed by those IDs:

```json
{
  "responsive": {
    "mobile": {
      "layout": {
        "direction": "column",
        "gap": 20,
        "padding": {
          "top": 32,
          "right": 20,
          "bottom": 32,
          "left": 20
        }
      }
    }
  }
}
```

Responsive patches use the same safe node fields as normal patches. Prefer
fluid base layouts that need only a few breakpoint overrides:

- collapse multi-column rows/grids
- reduce outer padding and large gaps
- adjust display typography
- hide genuinely secondary decoration
- preserve tap target size and reading order

Do not create a duplicate mobile Page unless the user explicitly wants a
separate composition.

## Tokens and themes

Token types are `color`, `number`, and `font`. IDs must contain only letters,
digits, underscore, or hyphen.

```json
{
  "themes": [
    { "id": "light", "name": "Light" },
    { "id": "dark", "name": "Dark" }
  ],
  "tokens": [
    {
      "id": "surface",
      "name": "Surface",
      "type": "color",
      "value": "#f6f5f2",
      "modes": {
        "dark": "#171816"
      }
    },
    {
      "id": "space-section",
      "name": "Section spacing",
      "type": "number",
      "value": 96
    },
    {
      "id": "font-ui",
      "name": "UI font",
      "type": "font",
      "value": "Inter"
    }
  ]
}
```

Define themes in the same `setTokens` call before using their IDs in token
modes. Use token objects in color fields. Number and font token use depends on
the consuming model surface; do not place token objects in fields whose live
schema expects raw numbers or a full typography object.

Avoid hundreds of premature tokens. Start with:

- canvas/background, surface, elevated surface
- primary text, secondary text, subtle text
- accent and accent contrast
- subtle border and focus
- optionally one display and one UI font

## Components and instances

Create a component when a structure repeats and should evolve as one unit:
navigation items, buttons, product cards, pricing cards, badges, or feature
rows. Define variants only when they represent a meaningful stable family.

Example flow:

1. `createComponent` named `Button` with variants `primary` and `secondary`.
2. Save its returned `componentId`.
3. `createInstance` into each source container.
4. Use an exact descendant NodeRef to override instance copy or visuals.

Edit the component source to update all instances. Patch a descendant through
an instance path for local text/style changes. Instance overrides accept visual
and content fields, not structural component fields. Structural insertion
inside an instance is rejected.

Declaring variant names does not create their visual differences. Patch the
component's `variantOverrides` with source-node patches for each meaningful
variant, then inspect at least one instance of every variant. Use a local
instance override only when the difference belongs to that one instance.

Do not create a component for a unique hero merely to appear systematic. Do not
copy-paste ten card trees when a component would keep them consistent.

## State and interactions

State definitions live on a Page or component:

```json
{
  "states": {
    "menuOpen": {
      "id": "menuOpen",
      "name": "Menu open",
      "type": "boolean",
      "initial": false
    }
  }
}
```

Types are `string`, `number`, and `boolean`. The record key must equal the
state's `id`.

Triggers:

- `click`, `double-click`
- `hover`, `hover-end`
- `submit`, `change`, `input`
- `focus`, `blur`
- `state-change` with a required `stateId`

Actions:

- navigate to a Page
- open a safe URL
- show, hide, or toggle a node
- open or close an overlay Page
- set an instance variant
- set, toggle, or increment state
- switch to a named theme

Example:

```json
{
  "interactions": [
    {
      "trigger": "click",
      "actions": [
        {
          "type": "toggle-state",
          "stateId": "menuOpen"
        },
        {
          "type": "visibility",
          "nodeId": "mobile-menu",
          "value": "toggle"
        }
      ]
    }
  ]
}
```

Use `when` rules for conditional actions. Keep behavior declarative and local.
Validate referenced Page, node, state, variant, and theme IDs through reads
before wiring them.

Read the current node before patching record or array fields. `states`,
`interactions`, and `animations` are assigned as complete fields. Responsive
records merge by breakpoint ID, but a new patch for an existing breakpoint
replaces that breakpoint's prior node patch. Preserve existing entries unless
the user asked to replace them.

## Motion

Keep the two motion concepts separate:

- A **transition** controls how a node moves between visual states such as
  hover, press, and focus. It lives on the node.
- An **animation** is a named document-level keyframe sequence. Define it once
  with `setAnimations`, then reference it from nodes with `animateNodes`.

Define reusable keyframe motion with `setAnimations`.

Available presets:

- `fade-in`
- `fade-in-up`
- `fade-in-down`
- `slide-in-left`
- `slide-in-right`
- `scale-in`
- `pulse`
- `float`
- `spin`

Apply definitions with `animateNodes`. Animation triggers are `load`, `in-view`,
`always`, `hover`, and `press`. Use `stagger` in milliseconds to offset a list
in the order refs are supplied.

Hover presets:

- `lift`
- `grow`
- `shrink`
- `fade`
- `nudge-right`

Example:

```json
{
  "refs": [
    { "nodeId": "card-1", "instancePath": [] },
    { "nodeId": "card-2", "instancePath": [] }
  ],
  "play": [
    {
      "animationId": "fade-in-up",
      "trigger": "in-view",
      "once": true
    }
  ],
  "hover": "lift",
  "stagger": 70
}
```

For motion not covered by a preset, define bounded opacity/transform keyframes:

```json
{
  "animations": [
    {
      "id": "settle-in",
      "name": "Settle in",
      "keyframes": [
        {
          "offset": 0,
          "opacity": 0,
          "transform": {
            "y": 12,
            "scale": 0.985
          }
        },
        {
          "offset": 1,
          "opacity": 1,
          "transform": {
            "y": 0,
            "scale": 1
          }
        }
      ],
      "duration": 460,
      "easing": {
        "cubicBezier": [0.22, 1, 0.36, 1]
      },
      "iterations": 1,
      "direction": "normal",
      "fill": "backwards"
    }
  ]
}
```

Motion changes opacity and transforms, not layout. Prefer 120–240 ms for direct
hover feedback and roughly 350–600 ms for entrances. Avoid infinite motion
unless it communicates ongoing status or is subtle ambient decoration.
Keep continuous animation off primary reading content and controls. The shared
motion stylesheet disables motion under `prefers-reduced-motion`; do not work
around that behavior. `animateNodes` assigns the node's animation list, so read
and include existing uses when adding another animation. Group refs in one call
only when their resulting animation lists should be identical; otherwise use
separate calls or precise `patchNodes` changes. `clear: true` removes visual
states, transitions, and animations from refs.

## Images, vectors, and semantics

Image sources may be:

- an owned `/api/asset/...` route
- supported image data URLs
- HTTPS URLs
- localhost HTTP URLs in development

`listAssets` returns asset IDs, names, media types, and sizes, but not a ready
source URL. Use a known owned asset route only when its URL contract is
available in context; do not fabricate it from an ID.

Always provide useful image `alt` text unless the image is purely decorative.
Set `fit` to `cover`, `contain`, or `fill`.

Vectors accept a viewBox and path records containing `d`, optional fill/stroke,
and stroke width. Keep path data bounded and validated. Prefer simple shapes or
existing assets over needlessly complex generated vectors.

Use `semanticTag` for meaningful containers and controls: `header`, `nav`,
`main`, `section`, `article`, `aside`, `footer`, `button`, `a`, or `form`.
Semantics do not replace interactions or accessible text.

## Good and bad patterns

Good:

- a Page column containing semantic sections
- a centered max-width content frame inside fill-width section backgrounds
- nested descriptor batches with temporary refs and meaningful names
- a component source plus instances for repeated cards
- tokens reused for core colors
- screenshot review at desktop and narrow widths

Bad:

- absolute coordinates for an entire responsive product Page
- one MCP call per text node
- dozens of unrelated changes in a single patch
- hardcoded near-identical colors everywhere
- empty `instancePath` for an instance descendant
- inserting inside an instance rather than editing its component source
- exporting JSX and trying to re-import it
- adding motion to disguise a weak static hierarchy
