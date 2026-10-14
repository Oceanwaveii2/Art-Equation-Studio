Pinned upstream: Parley 0.11.1, copied from the Cargo registry release package. Upstream project: https://github.com/linebender/parley. The registry package's `.cargo_vcs_info.json` preserves its exact upstream commit. Both original MIT and Apache-2.0 licenses are included.

Art Equation adds one optional method to `RangedBuilder`: `set_base_direction_rtl(Option<bool>)`. `Some(false)` supplies an explicit left-to-right paragraph base level, `Some(true)` supplies right-to-left, and `None` preserves upstream automatic first-strong inference. The value reaches the existing Unicode bidi resolver before contextual shaping. Canonical source characters, UTF-8 offsets and grapheme ranges are not changed.

Only three upstream files differ: `src/builder.rs`, `src/context.rs`, and `src/analysis/mod.rs`. `EXPLICIT_BASE_DIRECTION.patch` records the exact delta. Other builders retain their previous automatic behavior. Explicit right-to-left also runs the existing bidi resolver for entirely Latin text, where upstream would otherwise skip it.

The host validates the two direction enum values and tests Arabic in automatic and explicit LTR modes, Latin in explicit RTL mode, malformed values, and resetting to automatic mode on a reused engine. Actual browser line partitions, advances, baselines and glyph pixels remain separate acceptance gates. This patch provides paragraph direction, not a blanket claim of CSS layout parity.

When updating Parley, rebase this small patch onto the pinned release, recheck licenses and source identity, and repeat native and mounted-browser acceptance. Do not modify the private Cargo registry cache.
