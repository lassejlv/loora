# Loora MCP schema map

Use this reference before any structured Canvas mutation. It explains the
payload shapes that MCP clients sometimes collapse to `unknown`. The live tool
schema is authoritative when it exposes more detail; this map is the fallback
for the current Loora `@loora/agent/canvas-tools` schemas.

## Contents

- [Check tool availability](#check-tool-availability)
- [Understand the payload stack](#understand-the-payload-stack)
- [Keep identifiers distinct](#keep-identifiers-distinct)
- [Use the mutation envelopes](#use-the-mutation-envelopes)
- [Build node descriptors](#build-node-descriptors)
- [Use layout and style values](#use-layout-and-style-values)
- [Patch existing nodes](#patch-existing-nodes)
- [Preserve complete fields](#preserve-complete-fields)
- [Diagnose schema errors](#diagnose-schema-errors)

## Check tool availability

Inspect the callable Loora tool list before writing. Do not assume every tool in
the server source is exposed in the current authenticated session.

| Task | Required callable tools |
|---|---|
| Create a design | `createDesign`, `createPage`, `insertNodes`, `patchNodes` |
| Edit structure | `readTree`, `insertNodes`, `moveNodes`, `patchNodes` |
| Build components | `createComponent`, `createInstance`, `patchNodes` |
| Add themes | `getDesignContext`, `setTokens`, `patchNodes` |
| Add motion | `setAnimations`, `animateNodes` |
| Work on a branch | `createBranch`, `getDesignContext`, `compareBranch` plus the required mutation tools |

If a required mutation tool is missing, stop before creating a design or branch.
`createDesign` returns an empty design with no Page or nodes. It is not a useful
partial result. Report the missing tool names so the MCP manifest, auth, or
session can be fixed.

## Understand the payload stack

Every mutation has three separate layers:

```text
tool envelope
├── target: designId + optional draftId
└── operation
    ├── locator: NodeRef, parent, pageId, or componentId
    └── value: descriptor, patch, token, interaction, or motion object
```

For example, this is one complete `patchNodes` call:

```json
{
  "designId": "DESIGN_ID",
  "draftId": "BRANCH_ID",
  "changes": [
    {
      "ref": {
        "nodeId": "TEXT_NODE_ID",
        "instancePath": []
      },
      "patch": {
        "text": "Updated copy"
      }
    }
  ]
}
```

Do not put `designId` inside a patch, put `text` beside `changes`, or replace a
NodeRef with a raw node ID where the schema asks for `ref`.

## Keep identifiers distinct

| Identifier | Meaning | Where it comes from |
|---|---|---|
| `designId` | Design record | `listDesigns` or `createDesign` |
| `draftId` | Branch target; omit for Main | The returned `id` from `createBranch` or `listBranches` |
| `pageId` | Page root | `createPage`, `getDesignContext`, or `readTree` |
| `componentId` | Component definition | `createComponent` or a component summary |
| NodeRef | Exact existing source/effective node address | `getDesignContext`, `readTree`, or `readNode` |
| descriptor `ref` | Temporary label within one create/insert call | Chosen by the caller, then mapped in the mutation response |

A NodeRef always has this shape:

```json
{
  "nodeId": "NODE_ID",
  "instancePath": []
}
```

For a component descendant inside an instance, use the exact returned path:

```json
{
  "nodeId": "SOURCE_TEXT_ID",
  "instancePath": ["INSTANCE_ID"]
}
```

Never guess an instance path or replace a non-empty returned path with `[]`.
Descriptor `ref` is not a node ID and expires after its one payload.

## Use the mutation envelopes

### Create a Page

`createPage` creates the Page root and may create its nested hierarchy in the
same transaction:

```json
{
  "designId": "DESIGN_ID",
  "draftId": "BRANCH_ID",
  "name": "Overview",
  "width": 1440,
  "minHeight": 900,
  "layout": {
    "mode": "flex",
    "direction": "column",
    "align": "stretch"
  },
  "style": {
    "fills": [
      { "type": "solid", "color": "#ffffff" }
    ]
  },
  "states": {},
  "children": []
}
```

`name` is required. `x`, `y`, `width`, `minHeight`, `states`, and `children`
have defaults, but include the layout intent rather than relying on defaults.
Do not put a `page` descriptor inside `children`.

### Insert nested nodes

`insertNodes` requires an existing source container and one or more descriptors:

```json
{
  "designId": "DESIGN_ID",
  "parent": {
    "nodeId": "PAGE_OR_CONTAINER_ID",
    "instancePath": []
  },
  "nodes": [
    {
      "ref": "hero",
      "type": "frame",
      "name": "Hero",
      "layout": {
        "mode": "flex",
        "direction": "column",
        "width": { "unit": "fill" },
        "height": { "unit": "hug" },
        "gap": 16
      },
      "children": []
    }
  ]
}
```

The parent must be a Page, component, frame, or group with an empty
`instancePath`. Structural insertion inside an instance is rejected.

### Patch nodes

`patchNodes` requires `changes`; every change contains a NodeRef and a `patch`:

```json
{
  "designId": "DESIGN_ID",
  "changes": [
    {
      "ref": {
        "nodeId": "HERO_ID",
        "instancePath": []
      },
      "patch": {
        "layout": { "gap": 24 },
        "style": { "radius": 12 }
      }
    }
  ]
}
```

Batch independent changes in the array. Do not send `{ "nodeId": ..., "gap":
24 }`, a top-level `patch`, or a descriptor in place of a patch.

### Create a component and an instance

`createComponent` has the same `layout`, `style`, `states`, and `children`
shapes as `createPage`, plus `width`, `height`, and unique `variants`:

```json
{
  "designId": "DESIGN_ID",
  "name": "Button",
  "width": 140,
  "height": 40,
  "variants": ["primary", "secondary"],
  "layout": {
    "mode": "flex",
    "direction": "row",
    "align": "center",
    "justify": "center"
  },
  "children": []
}
```

Insert the definition with `createInstance`:

```json
{
  "designId": "DESIGN_ID",
  "parent": {
    "nodeId": "PARENT_ID",
    "instancePath": []
  },
  "componentId": "COMPONENT_ID",
  "name": "Primary action",
  "variant": "primary"
}
```

Variant names create identities only. Define actual visual differences by
patching the component root's complete `variantOverrides` record.

### Define tokens and themes

`setTokens` upserts complete themes and complete tokens by ID:

```json
{
  "designId": "DESIGN_ID",
  "draftId": "BRANCH_ID",
  "themes": [
    { "id": "dark", "name": "Dark" }
  ],
  "tokens": [
    {
      "id": "surface",
      "name": "Surface",
      "type": "color",
      "value": "#ffffff",
      "modes": {
        "dark": "#1c1d1a"
      }
    }
  ]
}
```

Token types are `color`, `number`, and `font`. Preserve the token's current
base value and all existing modes when adding a mode; an upsert replaces that
token object rather than merging `modes`.

### Define and apply motion

Define reusable animations with `setAnimations`, then address nodes with exact
NodeRefs in `animateNodes`:

```json
{
  "designId": "DESIGN_ID",
  "presets": ["fade-in-up"],
  "animations": [],
  "remove": []
}
```

```json
{
  "designId": "DESIGN_ID",
  "refs": [
    { "nodeId": "CARD_ID", "instancePath": [] }
  ],
  "play": [
    {
      "animationId": "fade-in-up",
      "trigger": "in-view",
      "once": true
    }
  ],
  "hover": "lift",
  "stagger": 60
}
```

`animateNodes` requires at least one motion field or `clear: true`.

## Build node descriptors

Descriptors are valid only inside `createPage.children`,
`createComponent.children`, or `insertNodes.nodes`. They do not accept `id`,
`parentId`, `order`, `states`, `variants`, `variantOverrides`, `animations`, or
`metadata`.

Common descriptor fields are:

```text
ref, type, name, layout, style, hidden, locked, rotation,
responsive, interactions
```

Type-specific fields are:

| `type` | Fields | Rules |
|---|---|---|
| `frame` | `children`, `semanticTag` | May contain children; set `layout.mode` for its own children |
| `group` | `children` | May contain children; set `layout.mode` for its own children |
| `text` | `text`, `runs` | Typography belongs in `style.typography` |
| `shape` | `shape` | `rectangle`, `ellipse`, or `line` |
| `vector` | `viewBox`, `paths` | Each path uses `d`, optional fill/stroke/strokeWidth |
| `image` | `src`, `alt`, `fit` | `src` is required; fit is `cover`, `contain`, or `fill` |
| `instance` | `componentId`, `variant` | `componentId` is required; instances cannot have children |

Only frames and groups accept `children`. Create Page and component roots with
their dedicated tools, not descriptors.

## Use layout and style values

`width` and `height` are length objects, never bare numbers:

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

Layout fields include:

```text
position: flow | absolute
x, y
width, height
minWidth, maxWidth, minHeight, maxHeight, aspectRatio
mode: absolute | flex | grid
direction: row | column
wrap, gap
padding: { top, right, bottom, left }
align: start | center | end | stretch
justify: start | center | end | space-between | space-around
columns
```

Set `mode` on every frame/group that lays out children. A node can be in its
parent's flow while its own children still use the default absolute layout.

Style fields include:

```text
fills, stroke, radius, shadows, opacity, overflow, blendMode, typography
```

A solid fill is `{ "type": "solid", "color": "#fff" }` or uses a token
color `{ "token": "surface" }`. A linear gradient has `angle` and 2–20
`stops`. `stroke` requires `color` and `width`. `padding` requires all four
sides. Typography requires `family`, `size`, `weight`, `lineHeight`,
`letterSpacing`, and `align`; `wrap`, `decoration`, and `transform` are optional.

Do not send CSS strings, class names, CSS variables, a flat `background`, or a
flat `color` field.

## Patch existing nodes

Source-node patches can use:

```text
name, hidden, locked, rotation, order
layout, style, semanticTag
text, runs
src, alt, fit
shape, viewBox, paths
interactions
states, viewport
variants, defaultVariant, variantOverrides
componentId
visualStates, transition, animations
responsive, metadata
```

Use type-appropriate fields. Patch `states` only on Page/component roots,
`viewport` only on Pages, and `variants`/`defaultVariant`/`variantOverrides`
only on components.

An instance-descendant NodeRef may patch only these visual/content fields:

```text
name, hidden, locked, rotation, layout, style, semanticTag,
text, runs, src, alt, interactions, variant
```

Do not patch structure, responsive rules, states, paths, component identity, or
motion fields through an instance descendant. Edit the component source for
shared structural behavior.

Responsive patches use real breakpoint IDs returned by `getDesignContext`:

```json
{
  "responsive": {
    "MOBILE_BREAKPOINT_ID": {
      "layout": {
        "direction": "column",
        "gap": 16
      }
    }
  }
}
```

Do not invent `mobile`, `tablet`, or `desktop` unless those exact IDs exist.

## Preserve complete fields

Read the current node or context before editing any array or record. The patch
engine does not recursively merge every nested value.

| Field | Patch behavior | Safe update |
|---|---|---|
| `layout` | Merges supplied layout keys | Send only changed keys |
| `style` and `style.typography` | Merge supplied keys | Send only changed keys; arrays inside style still replace |
| `viewport` | Merges supplied keys | Send only changed keys |
| `visualStates` | Merges by `hover`, `press`, `focus` | Preserve a state only when replacing that same state |
| `metadata` | Merges top-level keys | Send changed keys |
| `responsive` | Merges breakpoint IDs, but replaces the whole patch at an existing breakpoint ID | Read and resend the existing breakpoint patch with the new change |
| `states` | Replaces the complete record | Read, merge, and resend every state |
| `interactions`, `runs`, `animations`, `paths`, `variants` | Replace the complete array | Read, append/change, and resend the complete array |
| `variantOverrides` | Replaces the complete record | Read, merge all variants/source-node entries, and resend it |
| `transition` | Replaces the object | Send the complete transition |
| token `modes` through `setTokens` | The complete token object is upserted | Preserve base value and every existing mode |
| `animateNodes.play` | Replaces a node's animation-use list when supplied | Include existing animation uses that must remain |

State record keys must equal the nested state's `id`. Interaction action IDs
must refer to real Page, node, state, component variant, or theme IDs.

## Diagnose schema errors

Read the error path from left to right:

```text
changes → 0 → patch → responsive → mobile → layout → width
```

Then check each layer:

1. Confirm the required tool is callable.
2. Confirm `designId` and optional `draftId` are at the outer level.
3. Confirm the envelope key: `children`, `nodes`, `changes`, `tokens`, or `refs`.
4. Confirm existing nodes use a NodeRef and new descriptors use temporary `ref`.
5. Confirm the field belongs to that node type and layer.
6. Confirm enums, length objects, complete padding, colors, and required fields.
7. Re-read IDs and collection fields before retrying.

Common failures:

| Symptom | Likely mistake |
|---|---|
| `ref` or `patch` appears as `unknown` in the client | Client schema display lost named definitions; use this map and exact examples |
| Node not found | Used a descriptor `ref`, guessed ID, stale ID, or wrong branch target |
| Instance path invalid | Rebuilt or emptied a returned instance path |
| Parent is not editable | Target is not Page/component/frame/group, or is inside an instance |
| Image requires source | `type: image` omitted a valid `src` |
| Instance requires component | `type: instance` omitted a real `componentId` |
| Children rejected | `children` was placed on text/shape/vector/image/instance |
| Invalid width/height | Sent a number instead of a Canvas length object |
| Unknown breakpoint | Invented a responsive key instead of reading it |
| State ID mismatch | Record key and nested `id` differ |
| Existing interaction or animation vanished | Replaced a complete array without preserving prior entries |

Correct the smallest coherent payload once. Do not cycle through guessed field
names or create additional empty designs while the authoring surface is broken.
