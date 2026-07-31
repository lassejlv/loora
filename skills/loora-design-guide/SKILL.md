---
name: loora-design-guide
description: Build, edit, refine, and review polished responsive product interfaces through the Loora MCP server and its structured Canvas tools. Use when an agent must create or modify a Loora design, turn a product brief or reference into editable Canvas nodes, establish tokens or reusable components, add interactions or motion, work safely on a Loora branch, inspect screenshots, or export implementation code without treating HTML, JSX, or CSS as the authoring model.
---

# Loora Design Guide

Create real, editable Loora designs through the MCP tools. Treat the Canvas
document—not generated code—as the source of truth. Work like a designer:
understand the product, establish a system, build coherent sections, inspect the
render, and refine the weak parts.

## Load the right reference

- Read [references/tool-workflows.md](references/tool-workflows.md) before
  choosing a design, branch, mutation sequence, or merge flow.
- Read [references/canvas-authoring.md](references/canvas-authoring.md) before
  constructing unfamiliar node descriptors, NodeRefs, tokens, responsive
  overrides, interactions, components, or motion.
- Read [references/design-craft.md](references/design-craft.md) when creating or
  materially restyling a design. Use its visual rubric during screenshot review.
- Read [references/worked-examples.md](references/worked-examples.md) when a
  concrete payload pattern would prevent schema guesswork.

Do not load every reference for a small text or spacing edit.

## Follow the core loop

1. **Orient.** Call `getUsage` if budget matters. Call `listDesigns`, select the
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
   or node. Compare the pixels against the brief and the rubric in
   `design-craft.md`. Do not call a mutation successful merely because its tool
   response succeeded.
7. **Refine surgically.** Fix the largest visible problem first. Batch related
   patches, render again, and repeat until hierarchy, spacing, contrast,
   alignment, content, and responsive behavior are convincing.
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
- Report what changed, which target was used, what was visually checked, and
  any remaining uncertainty. Include the returned Loora URL when useful.

## Handle failure without thrashing

- On schema rejection, read the relevant tool schema or
  `canvas-authoring.md`; correct the payload instead of retrying variants at
  random.
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
