# Loora MCP tool workflows

Use this reference to select tools, preserve the correct target, and finish
safely. Tool behavior is grounded in `apps/mcp/src/server.ts` and the shared
`@loora/agent/canvas-tools` schemas.

## Contents

- [Target model](#target-model)
- [Tool map](#tool-map)
- [Create a new design](#create-a-new-design)
- [Edit an existing design](#edit-an-existing-design)
- [Use branches safely](#use-branches-safely)
- [Validate the visual result](#validate-the-visual-result)
- [Efficiency and limits](#efficiency-and-limits)
- [Failure guide](#failure-guide)

## Target model

Most Canvas tools require:

```json
{
  "designId": "d...",
  "draftId": "dr..."
}
```

Omit `draftId` for Main. Include it for a branch. Do not infer the target from
an editor URL once a tool run begins; carry the IDs explicitly.

An active branch is writable. Proposed, applied, and closed branches are
read-only. Main stays writable unless product access prevents it.

`getDesignContext` is the best first read. It returns:

- target identity and status
- revision and update time
- canonical editor URL
- breakpoints and active theme
- themes and tokens
- Page and component summaries
- a compact semantic tree

Use a deeper `readTree` only for the area being edited. Use `readNode` when the
complete source/effective node is required.

## Tool map

### Orientation and inspection

| Tool | Use |
|---|---|
| `getUsage` | Read weekly MCP allowance without consuming a call |
| `listDesigns` | Discover structured designs and canonical URLs |
| `getDesignContext` | Read one target's system and compact tree before editing |
| `readTree` | Inspect a Page, component, frame, group, or instance subtree |
| `readNode` | Inspect a complete source node, effective node, and instance override |
| `searchNodes` | Find names or text without traversing the whole tree |
| `listAssets` | Discover uploaded image asset IDs and metadata |
| `listVersions` | Inspect Main or branch history |

### Structured authoring

| Tool | Use |
|---|---|
| `createPage` | Create a responsive Page and initial nested hierarchy atomically |
| `insertNodes` | Add a coherent nested section to a source container |
| `patchNodes` | Batch layout, style, content, responsive, state, and interaction edits |
| `moveNodes` | Reparent or reorder source nodes |
| `deleteNodes` | Delete source subtrees after explicit confirmation |
| `createComponent` | Create an off-canvas reusable definition |
| `createInstance` | Insert a component instance into a source container |
| `setTokens` | Upsert themes and color, number, or font tokens |
| `setAnimations` | Define reusable keyframe animations or presets |
| `animateNodes` | Apply hover/press/focus states and animation references |

### Visual and delivery surfaces

| Tool | Use |
|---|---|
| `getScreenshot` | Render Page or NodeRef pixels through Loora's DOM/CSS engine |
| `viewPage` | Get a Page URL and semantic tree |
| `viewNode` | Get a node URL and semantic details |
| `viewCanvas` | Get a design URL and Page summary |
| `exportCode` | Produce one-way Tailwind JSX, JSX, or standalone HTML |

### Design and branch lifecycle

| Tool | Use |
|---|---|
| `createDesign` / `renameDesign` | Manage design identity |
| `deleteDesign` | Permanently delete after explicit confirmation |
| `listBranches` | Inspect branch IDs and statuses |
| `createBranch` | Fork current Main into an isolated active branch |
| `compareBranch` | Compute semantic changes/conflicts against current Main |
| `proposeBranch` | Freeze an active branch for review |
| `reopenBranch` | Make a proposed branch active again |
| `applyBranch` | Merge using exact current revisions and explicit conflict choices |
| `closeBranch` | Archive without applying after explicit confirmation |

## Create a new design

1. Call `createDesign` with a concise product-oriented name.
2. Call `setTokens` if the design will reuse a visual system.
3. Create truly repeated building blocks with `createComponent`.
4. Call `createPage` with the Page shell and initial hierarchy. A new design is
   empty; `createPage` is required before inserting ordinary nodes.
5. Continue with section-sized `insertNodes` calls.
6. Apply motion only after the static layout is sound.
7. Call `getScreenshot` for the Page and inspect it.
8. Patch the largest visual issues, then render again.
9. Return the canonical URL from `viewPage`, `viewCanvas`, or mutation context.

Prefer a single Page creation payload containing header, main content, and
section skeletons over dozens of one-node insertions. Split elaborate content
into later section calls so any schema error remains local.

## Edit an existing design

1. Call `getDesignContext`.
2. Locate the affected subtree with `searchNodes` or `readTree`.
3. Read exact nodes when styles, instance overrides, interactions, or
   responsive behavior matter.
4. Preserve the established system unless the user asked for a redesign.
5. Preserve existing record/array fields when adding states, interactions,
   animation uses, or a patch to an existing breakpoint.
6. Use `patchNodes` for local refinements; use `insertNodes` only when structure
   is genuinely missing.
7. Call `getScreenshot` with the affected Page or NodeRef.
8. Re-read the changed subtree and report the target revision.

Do not rebuild a Page to change one section. Do not patch a component source
when only one instance should differ.

## Use branches safely

Prefer a branch when:

- the user requested alternatives
- the edit is broad or experimental
- Main is shared with other work
- the result needs review before publication

Flow:

1. `createBranch`
2. Keep `draftId` on every read and write
3. Build and visually verify
4. `compareBranch`
5. Optionally `proposeBranch`
6. Present the branch URL and comparison
7. Apply only when authorized

`compareBranch` returns `mainRevision`, `draftRevision`, a summary, and field
conflicts. Supply those exact revisions to `applyBranch`. For every conflict,
map its ID to either `"main"` or `"draft"`. If Main or the branch changes,
compare again.

Never propose merely to mark work "done": proposing freezes the branch.
Never apply a branch just because the design looks good unless the user's
request authorizes merging it into Main.

## Validate the visual result

`getScreenshot` accepts one of:

```json
{
  "designId": "d...",
  "pageId": "page...",
  "width": 1440,
  "pixelRatio": 1
}
```

```json
{
  "designId": "d...",
  "ref": {
    "nodeId": "frame...",
    "instancePath": []
  },
  "width": 800,
  "pixelRatio": 2
}
```

Choose either `pageId` or `ref`, not both. Width is 200–3840 and pixel ratio is
1–2. A Page screenshot is best for composition; a NodeRef screenshot is best
for a component or local detail.

`getScreenshot` has no input for runtime Page state or a temporary theme
selection. It proves the default rendered composition, not every interactive
state or theme. Verify interaction rules and theme modes structurally with
`readNode`/`readTree`, and do not claim alternate-state pixels were checked
unless they were actually exercised in Loora.

Render after:

- the first complete Page composition
- a material style or layout pass
- responsive overrides
- component/instance changes
- the final refinement pass

Inspect the returned metadata as well as the PNG. Record `skippedImages`; a
composition can render while an image was omitted.

## Efficiency and limits

- One `getDesignContext` usually replaces `listBranches`, `readTree`, and
  separate token reads.
- `searchNodes` returns up to 200 matches.
- `createPage` and `insertNodes` accept up to 5000 descriptors, but practical
  section-sized batches are easier to debug.
- `patchNodes`, `moveNodes`, and `deleteNodes` accept up to 1000 changes.
- Depth is capped at 10 in `getDesignContext` and 20 in `readTree`.
- `getScreenshot` starts Chromium and is more expensive than semantic reads.
- `exportCode` refuses responses over 2 MB; export one Page or node.
- Every tool except `getUsage` may consume metered usage. Prefer purposeful
  calls over speculative probing.

## Failure guide

| Signal | Response |
|---|---|
| `CANVAS_UNAVAILABLE` | The legacy design is unsupported; choose/create a structured design |
| `MCP_USAGE_LIMIT_REACHED` | Stop mutations and report usage/reset metadata |
| `MCP_USAGE_UNAVAILABLE` | Do not assume the mutation ran; report metering failure |
| Plan limit code | Report the exact limit; do not retry creation |
| Branch is read-only | Reopen only if the user wants to continue editing |
| Node not found | Re-read the nearest tree; IDs may have changed or target may be wrong |
| Instance path invalid | Use the exact NodeRef returned by the semantic tree |
| Locked node | Do not bypass silently |
| Main or branch changed | Re-run `compareBranch` and use fresh revisions |
| Screenshot skipped images | Inspect asset URLs/ownership and disclose incomplete pixels |
