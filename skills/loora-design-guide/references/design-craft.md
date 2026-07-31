# Design craft and visual review

Use this reference for new Pages, redesigns, and material visual refinement.
The goal is not one house style. The goal is a deliberate, product-specific
system that survives screenshot inspection.

## Contents

- [Choose a direction](#choose-a-direction)
- [Build hierarchy before decoration](#build-hierarchy-before-decoration)
- [Compose responsive Pages](#compose-responsive-pages)
- [Use typography, color, and depth](#use-typography-color-and-depth)
- [Design real components and states](#design-real-components-and-states)
- [Avoid generic agent output](#avoid-generic-agent-output)
- [Screenshot review rubric](#screenshot-review-rubric)
- [Refinement order](#refinement-order)

## Choose a direction

Before mutating, reduce the brief to:

- audience and primary job
- desired feeling
- must-show content and primary action
- density: editorial, spacious, compact, or data-heavy
- visual cues from the product/domain
- accessibility and responsive constraints

Write a one-sentence internal direction, for example:

> A quiet, editorial analytics workspace with strong numeric hierarchy, warm
> mineral neutrals, and one electric signal color.

Use that sentence to reject incoherent choices. If the user supplies a design
reference, extract relationships—spacing, hierarchy, density, rhythm,
contrast—not just its colors.

## Build hierarchy before decoration

Every Page needs a clear reading order. At a glance, a reviewer should know:

1. where they are
2. what matters now
3. what they can do
4. what supporting information follows

Create hierarchy with size, weight, contrast, spacing, and grouping before
adding shadows or gradients.

Prefer one dominant element per viewport. Secondary panels should support it,
not compete through equal contrast and size.

Use a consistent spacing rhythm. A practical starting scale is 4, 8, 12, 16,
24, 32, 48, 64, 96. Deviate intentionally rather than introducing arbitrary
17, 29, and 43 pixel gaps across related components.

## Compose responsive Pages

Use three layers:

1. **Page:** viewport, background, global vertical flow
2. **Section:** full-width band and vertical rhythm
3. **Content frame:** centered, width-constrained layout

This makes full-bleed backgrounds compatible with aligned content.

For desktop:

- keep primary content within an intentional max width
- align section edges to a shared grid
- use asymmetry when it helps emphasis, not as random offset
- let negative space separate ideas

For narrow screens:

- preserve semantic reading order
- collapse columns before text becomes cramped
- reduce outer padding, not internal control hit areas
- let type scale down modestly
- hide decoration only when it carries no meaning
- prevent horizontal overflow

Do not assume a desktop screenshot proves responsive quality. Render at a
narrow width after responsive patches.

## Use typography, color, and depth

### Typography

- Choose one primary family and at most one contrasting display/mono family
  unless the brief needs more.
- Keep body copy readable: roughly 15–18 px with 1.4–1.7 line height.
- Use tighter line height and negative letter spacing cautiously for large
  headings.
- Constrain long copy width; a wide Page should not create 120-character body
  lines.
- Use weight and contrast before adding more font sizes.

### Color

- Establish background, surface, text, muted text, border, accent, and focus
  roles.
- Ensure text contrast remains legible on every surface.
- Reserve strong accent for primary action, selection, or key status.
- Use semantic status colors only for actual status.
- Avoid distributing multiple saturated gradients without a product reason.

### Shape and depth

- Choose a radius language: restrained, soft, sharp, or mixed by role.
- Do not make every container a floating rounded card.
- Use borders for grouping before heavy shadows.
- Keep shadow direction and softness consistent.
- Use layering to communicate elevation, not as decoration on all elements.

## Design real components and states

A polished mockup contains believable content and states:

- concise, specific labels instead of placeholder copy
- realistic quantities and names
- primary, secondary, destructive, disabled, loading, empty, and error states
  where relevant
- consistent control heights and tap targets
- visibly interactive controls
- navigation and form semantics

Create components around product behavior and reuse. A button component may
have primary/secondary variants; a one-off decorative frame usually should not.

For data-heavy surfaces, prioritize scanning:

- align numbers
- use stable column rhythm
- keep labels quieter than values
- use color sparingly
- make selected and hover states unambiguous

For marketing/editorial surfaces, prioritize narrative:

- strong opening proposition
- one primary action
- proof and detail in a deliberate sequence
- visual pacing between dense and quiet sections

## Avoid generic agent output

Watch for:

- a large gradient heading plus three identical cards regardless of product
- excessive rounded pills
- every section centered
- iconless buttons with vague labels such as "Get Started"
- meaningless floating blobs
- uniformly spaced, uniformly weighted content with no focal point
- purple/blue gradients chosen without direction
- empty charts or fake metrics that undermine the use case
- decorative motion on every element

Replace generic patterns with domain evidence. A deployment tool can borrow
from topology, logs, environments, and status signals. A writing tool can use
pages, revisions, margins, and editorial rhythm. A finance product can use
ledger density and trustworthy restraint.

Novelty should come from the product metaphor, composition, or interaction—not
from violating readability.

## Screenshot review rubric

Inspect the actual PNG at normal scale, then zoom into important areas.

### Composition

- Is the focal point obvious within two seconds?
- Does the Page have a stable grid and consistent section alignment?
- Is there enough breathing room without feeling empty?
- Are dense and quiet areas intentionally paced?

### Hierarchy

- Can the title, key value, primary action, and supporting content be ranked?
- Is secondary text visibly secondary but still readable?
- Are unrelated elements accidentally competing?

### Layout

- Are edges and baselines aligned?
- Are repeated gaps consistent?
- Do cards/controls share dimensions where they should?
- Is any text clipped, overflowing, or awkwardly wrapped?

### Color and depth

- Is contrast sufficient?
- Is accent concentrated on meaningful elements?
- Are borders, shadows, and radii consistent?
- Are nested surfaces distinguishable without excessive chrome?

### Content and semantics

- Is copy specific and believable?
- Are labels action-oriented?
- Do controls look interactive?
- Are image crops, alt intent, and empty/error states reasonable?

### Responsive behavior

- Does the narrow layout preserve reading order?
- Do multi-column regions collapse cleanly?
- Are controls still usable?
- Is horizontal overflow absent?

### Motion and interaction

- Does motion clarify state, hierarchy, or continuity?
- Is hover/press feedback restrained?
- Is a transition used for a state change and a named keyframe animation used
  for a timeline, rather than conflating the two?
- Does stagger follow visual reading order?
- Would the Page remain fully understandable with reduced motion?
- Are interaction targets wired to valid state, node, Page, variant, or theme
  IDs?

## Refinement order

Fix problems in this order:

1. broken structure, clipping, overflow, or missing content
2. wrong hierarchy or unclear primary action
3. Page grid and major spacing
4. typography and line length
5. contrast and token consistency
6. component consistency and interaction states
7. imagery and decorative detail
8. motion

After each material pass, render again. Avoid polishing a shadow while the
hero's reading order is still wrong.
