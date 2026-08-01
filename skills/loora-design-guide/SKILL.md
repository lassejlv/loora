---
name: loora-design-guide
description: Build, edit, refine, troubleshoot, and review polished responsive product interfaces through the Loora MCP server and its structured Canvas schemas. Use when an agent must create or modify a Loora design, recover from MCP schema errors or missing authoring tools, turn a brief or reference into editable Canvas nodes, establish tokens or reusable components, add themes, interactions, or motion, work safely on a Loora branch, verify with or without image vision, or export implementation code without treating HTML, JSX, or CSS as the authoring model.
---

# Loora Design Guide

Create real, editable Loora designs through the MCP tools. Treat the Canvas
document—not generated code—as the source of truth. Work like a designer:
understand the product, establish a system, build coherent sections, inspect the
render, and refine the weak parts.

## Gate the MCP surface first

Inspect the callable Loora tools before creating or mutating anything. Require:

- `createPage`, `insertNodes`, and `patchNodes` for new design authoring
- `createComponent` and `createInstance` for reusable component work
- `setTokens` for tokens or themes
- `setAnimations` and `animateNodes` for motion
- branch lifecycle tools for branch work

If a required tool is absent, stop before `createDesign` or any partial mutation.
`createDesign` creates only an empty record; it is not a successful Canvas
design. Report the missing tools and the manifest/session mismatch. Do not
substitute HTML, JSX, browser clicks, or repeated speculative calls.

If a callable tool exposes nested arguments such as `ref`, `nodes`, or `patch`
as `unknown`, treat that as a schema-display limitation, not permission to
guess. Use the schema reference below.

## Load references by action

| Before this action | Read first | Read as well when applicable |
|---|---|---|
| Select a design, target Main, create/use a branch, compare, propose, or apply | [tool-workflows.md](references/tool-workflows.md) | [worked-examples.md](references/worked-examples.md) for branch theming or merge payloads |
| Call `createPage`, `insertNodes`, `patchNodes`, component, token, interaction, or motion tools | [mcp-schema.md](references/mcp-schema.md) | [worked-examples.md](references/worked-examples.md) for a known-good envelope |
| Compose responsive layout, components, themes, interactions, or motion | [canvas-authoring.md](references/canvas-authoring.md) | [design-craft.md](references/design-craft.md) for new or materially restyled work |
| Review pixels with image vision | [design-craft.md](references/design-craft.md) | [tool-workflows.md](references/tool-workflows.md) for screenshot limits |
| Verify without image vision | [tool-workflows.md](references/tool-workflows.md) | [mcp-schema.md](references/mcp-schema.md) to verify effective fields and collection semantics |

For a one-field text or spacing patch, read `mcp-schema.md` plus the target node;
do not load every design reference.

## Follow the core loop

1. **Check capability and orient.** Confirm the required authoring tools are
   callable. Call `getUsage` if budget matters. Call `listDesigns`, select the
   target explicitly, then call `getDesignContext`. For an existing design,
   inspect the relevant area with `readTree`, `readNode`, or `searchNodes`.
2. **Protect the target.** Confirm whether the user intends Main or a branch.
   Carry the same `designId` and optional `draftId` through every call. For a
   broad or speculative redesign, prefer a new branch. Never silently switch
   targets.
3. **Form a visual direction.** Extract the audience, job, content hierarchy,
   mood, constraints, and required states from the request. If the prompt is
   underspecified, choose a coherent direction and state it briefly; do not
   default to a generic dashboard.
4. **Establish the system.** Reuse existing tokens, themes, components, spacing,
   and typography. For a new design, define a small token set and reusable
   components before repeating them. Use semantic, human-readable node names.
5. **Build in meaningful batches.** Use `createPage` for the Page and its initial
   hierarchy. Use `insertNodes` for later sections, `patchNodes` for atomic
   refinements, and `moveNodes` for source structure. Prefer flex/grid with
   `fill` and `hug`; reserve absolute positioning for intentional overlays or
   artwork.
6. **Inspect after meaningful edits.** Call `getScreenshot` on the affected Page
   or node. With image vision, compare the pixels against the brief and
   `design-craft.md`. Without image vision, use the renderer result plus
   `readTree`/`readNode` as described in `tool-workflows.md` and state that pixel
   quality was not visually judged. A successful mutation alone is not proof.
7. **Refine surgically.** Fix the largest verified problem first. With vision,
   use visible hierarchy, spacing, contrast, alignment, content, and responsive
   behavior. Without vision, fix only structural issues supported by reads or
   renderer metadata; do not invent pixel problems.
8. **Verify structure.** Re-read the affected tree or nodes. Confirm component
   instances, interactions, token references, responsive overrides, and target
   revision. Use `viewPage` or `viewNode` for a canonical Loora link.
9. **Finish deliberately.** If working on a branch, compare it with Main before
   proposing or applying it. Do not apply, close, or delete anything without the
   user's authority. Use `exportCode` only when the user needs a one-way
   implementation artifact.

## Preserve Canvas semantics

- Send structured nodes and fields. Never insert HTML, JSX, Tailwind classes,
  arbitrary CSS, or code nodes.
- Keep the three schema layers separate: the outer tool envelope, a NodeRef or
  descriptor locator, and the typed field value. Never move fields between
  those layers.
- Keep IDs distinct: `designId` selects a design, `draftId` selects a branch,
  `pageId` selects a Page, `componentId` selects a component, a NodeRef selects
  an existing node, and descriptor `ref` is only a temporary label.
- Use temporary descriptor `ref` values only inside a single create/insert
  payload. Save the permanent IDs returned in `refs` for later calls.
- Use the exact NodeRef returned by `readTree` for component descendants.
  `instancePath` is meaningful; do not replace it with an empty array.
- Edit a component source to change all instances. Patch an instance descendant
  only for a deliberate visual or content override. Do not structurally insert
  inside an instance.
- Use Page or component state definitions plus declarative interactions for
  behavior. Do not simulate application state with hidden duplicate trees when
  a typed state and action expresses it.
- Use tokens for repeated colors, numbers, and fonts. Use components for
  repeated structures with shared identity, not merely because two rectangles
  look similar.
- Set `mode` on every container that will lay out children. A frame may flow
  within its parent while still defaulting its own children to absolute
  positioning.
- Read before patching collection fields. Preserve existing Page/component
  states, interactions, animation lists, and an existing patch for the same
  breakpoint unless replacement is intentional.
- Keep motion restrained and purposeful. Prefer the provided presets. Always
  judge the static composition before animating it.
- Treat `deleteNodes`, `deleteDesign`, and `closeBranch` as destructive. Obtain
  explicit confirmation, then pass the required `confirmed: true`.

## Work efficiently

- Start with one context call, not a chain of broad reads.
- Read only the subtree being changed. Use `searchNodes` to locate known copy or
  names.
- Create a whole coherent section in one nested payload, but split very large
  pages by section so errors and refinements stay local.
- Batch independent node patches into one `patchNodes` call.
- Use `getScreenshot` at useful milestones, not after every field.
- Inspect at the Page's intended desktop width and at least one narrow width
  when responsive behavior matters.
- Report what changed, which target was used, whether verification was visual or
  structural, and any remaining uncertainty. Include the returned Loora URL
  when useful.

## Handle failure without thrashing

- On schema rejection, read the error path from the outer envelope inward, then
  compare it with `mcp-schema.md` and the live tool schema. Correct one coherent
  payload; do not retry variants at random.
- If mutation tools disappear from the callable surface, stop. Do not create an
  empty design and hope later calls become available.
- On an invalid or stale ID, re-read the nearest tree and use returned IDs.
- On a locked node, stop and tell the user unless unlocking it is clearly part
  of the request.
- On a read-only branch, inspect its status. Reopen a proposed branch only when
  the user wants further edits.
- On merge revision drift, call `compareBranch` again. Never reuse stale
  revisions or guess conflict resolutions.
- On `CANVAS_UNAVAILABLE`, explain that the legacy design is unsupported; do
  not attempt to reconstruct or overwrite it.
- On screenshot failure, preserve the successful structured edit, inspect the
  reported error or skipped images, and be explicit that visual verification
  is incomplete.
- On usage or plan limits, stop repeated calls and report the exact returned
  code and remaining work.
