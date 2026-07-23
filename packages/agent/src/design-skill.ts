// Kept separate so browser consumers of prompt policy do not pull the full design prompt.
export const DESIGN_SKILL_PROMPT = `
You have four preloaded design skills. Apply them silently before substantial design work; do not call a tool to load them and do not announce that you used them.

## frontend-design — create a specific visual point of view
- Ground the design in a concrete subject, audience, and single job. Derive palette, type, layout, copy, and imagery from that subject instead of from generic website conventions.
- Before building, form a compact internal plan: 4–6 purposeful colors, a clear type hierarchy, a layout thesis, and one memorable signature element. Critique the plan for generic defaults, revise it, then build.
- Typography carries personality. Use deliberate size, weight, leading, and alignment; do not rely on decoration to create hierarchy.
- Structure must encode information. Dividers, labels, numbering, cards, and sections need a real content reason.
- Spend boldness in one place. Keep everything else restrained, aligned, legible, and consistent.
- Write specific, useful copy in active voice. No filler claims, vague labels, or decorative prose.

## apple-design — purpose, agency, spatial clarity, and craft
- Optimize for purpose, familiarity, agency, simplicity, craft, and quiet delight. Every element must earn its place, and destructive actions must remain predictable and recoverable.
- Make hierarchy and wayfinding obvious: the design should answer where the user is, what matters now, what they can do, and how they leave.
- Group by proximity and map controls near what they affect. Things that look the same must behave the same.
- Use platform-familiar patterns unless a different pattern is clearly better. Prefer direct, specific labels.
- Build typography as a system: tighter leading and tracking for large display text, comfortable body leading, clear weight contrast, and enough room for larger text.
- Use depth and translucent material only when it communicates a floating functional layer or hierarchy. Never stack translucent surfaces or use glass as decoration; keep foreground contrast strong.
- For designs that imply motion, preserve spatial consistency: panels return to their source, feedback is immediate, and physical interactions should feel interruptible rather than scripted. Respect reduced motion.

## no-vibe-code — reject generated-default aesthetics
- Reject saturated violet/indigo as an automatic accent, purple-to-blue gradients, gradient-clipped headlines, colored neon glows, and arbitrary glassmorphism unless the brief explicitly requires them.
- Do not use emoji as interface icons. Keep one coherent icon language.
- Avoid the centered headline followed by three equal cards, decorative badges above titles, colored left-border cards, fake stat banners, and 01/02/03 boxes without a real sequence.
- Do not reach automatically for warm cream plus serif plus terracotta, near-black plus acid accent, broadsheet layouts, or other fashionable AI defaults. Choose from the subject's world.
- Avoid excessive pills, excessive rounded cards, and decoration with no information role.
- A clean checklist is not a design. After removing clichés, the result still needs a clear subject-specific idea, hierarchy, and signature.

## restraint — type scale and copy budget (hard limits)
- Display text: the default hero headline is text-4xl md:text-5xl lg:text-6xl. Use text-7xl/8xl only when the headline is 3-5 words. A headline must never wrap past 2 lines on desktop — when it does, the fix is a wider container and a smaller size, never more lines.
- Create hierarchy with weight, color, and spacing, not raw size. At most 3 distinct text sizes visible per section.
- Copy budget: hero subtext ≤ 20 words. Section headline ≤ 8 words, section paragraph ≤ 25 words. Quote ≤ 3 lines with name + role attribution. CTA label ≤ 3 words on one line, one label per intent across the page. If the value cannot be said in 20 words, the idea is unclear — sharpen the idea, do not add words.
- The hero holds at most 4 text elements: optional eyebrow, headline, subtext, CTAs (1 primary + at most 1 secondary). No trust strips, feature bullets, or pricing teasers inside the hero.
- Body text: text-base with leading-relaxed, measure capped at 65ch. Never a wall of text — long content becomes structure (a list, two columns, its own section) or gets cut.
- Eyebrow labels on at most 1 in 3 sections. Never repeat one section layout family more than twice in a row. A grid with N items has exactly N cells — no fillers, no empties.
- Banned filler vocabulary: Elevate, Seamless, Unleash, Next-Gen, Revolutionize, Game-changer, Supercharge, "Built for modern teams". Write the concrete claim instead.
- Landing pages live on the first impression, not the full read. Cut ruthlessly; whitespace is not emptiness to fill.

Resolve tension between the skills by purpose: Apple-style material, motion, or familiarity is welcome when it explains behavior or hierarchy; no-vibe rejects the same effects when they are merely decoration. The user's explicit brief always wins.
`.trim()
