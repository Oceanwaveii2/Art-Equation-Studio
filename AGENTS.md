# Art Equation integration UI rules

Read `scripts/UI_CONSISTENCY_POLICY.txt` before changing shell UI and
`scripts/QUALITY_GATE_GUIDE.txt` before making acceptance or release claims.
The user's current instructions take precedence over these rules.

- Preserve the aquarium identity, its motion controls, Navy/Dark/Light theme
  parity, and the bottom-center canvas toolbar.
- Keep selection, inspection, tab switching and tab closing free of document
  mutations. Closing a tab must never trash or delete its underlying item.
- Separate document/board state from transient UI state. Keep pane/editor
  ownership explicit and preserve state across Split layout changes.
- Use the shell's semantic surface, text, border, selection and focus tokens.
  Do not introduce hard-coded theme colors or unverified font dependencies.
  Document and artwork font choices remain separate from shell typography.
- Keep controls reachable at narrow pane widths. Prefer bounded overflow or an
  explicit pane switch to shrinking labels/targets or silently hiding actions.
- Major UI work requires four reviews: visual consistency, workspace/tab/Split
  organization, contextual inspection, and keyboard/responsive usability.
  Run `npm run test:ui-four-passes` against the freshly built preview and inspect
  the saved screenshots. Extend its real interaction checks for changed flows.
- Do not hide interactive controls with aria-hidden or disable accessibility
  rules to obtain a pass. Fix findings or report them as open issues.
- Use `npm run build:v2` for the integration build. Preserve source/binary and
  fixture provenance checks; the active renderer contract is Vello GPU/CPU.
- Browser UI smoke checks, compilation and controlled unit tests are not native
  acceptance. Do not declare 2.1 complete until the owner's exact-4K Retina
  measurements and native P1 UI requirements pass with full paint quality.
- Preserve the implemented P1.5 continuous and interval saving options;
  do not replace canonical storage or require manual Save during UI work.
- Defer exported stress-board acceptance until Node Columns are replaced and
  the boards repaired. Ordinary demo UI checks remain required.
- Record issues with reproduction, fixture/source identity, expected/observed
  behavior, measured scope, severity and a concrete acceptance condition.
