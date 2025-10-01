# QuadToneRIP .quad File – Developer Reference (for quadGEN)

Purpose
- Practical summary of the .quad file format and handling details needed to generate, parse, and validate files from quadGEN.

Scope
- Applies to QuadToneRIP grayscale curve files with extension .quad.
- Focused on the subset used by Epson printers supported in quadGEN (e.g., P600/P800, P700/P900).

Essential Structure
- Header comments: Any number of comment lines starting with `#` (or `##`) are ignored by the RIP but useful for metadata.
- Channel declaration (recommended): First non‑data line typically declares channels, e.g.
  - `## QuadToneRIP K,C,M,Y,LC,LM,LK,LLK,V,MK`
- Per‑channel blocks: One block per channel, each preceded by a comment label, then exactly 256 integer lines:
  - Example: `# K curve` followed by 256 integers (input levels 0→255).
  - Repeat for `# C curve`, `# M curve`, etc., in the same order as declared in the header.

Values and Ranges
- Units: 16‑bit integer ink amounts; QTR accepts a full 16‑bit range.
- quadGEN convention: 0–65535 (TOTAL = 65535).
  - Mapping examples: 33% → 21627 (rounded), 50% → 32768, 100% → 65535.
- Practical notes:
  - Integers only, one value per line, 256 lines per channel.
  - Values outside range are clamped by quadGEN before writing.
  - Non‑monotonic curves are accepted by QTR; validate visually to avoid unintended tone kinks.

Channel Order and Presence
- Order matters: The sequence of channel blocks must match the header channel order.
- Unused channels: Provide a 256‑line block of zeros for channels present in the header but intentionally unused.
- Typical channel sets:
  - P600/P800: `K,C,M,Y,LC,LM,LK,LLK`
  - P700/P900: `K,C,M,Y,LC,LM,LK,LLK,V,MK`

Comments and Metadata (optional but recommended)
- Safe examples to include as `#` comments:
  - App/version: `# quadGEN vX.Y by David Marsh`
  - Data provenance: `# Linearized from measurement file: …`
  - Notes: brief process notes, paper/ink info, etc.
- Do not rely on comments for processing; QTR ignores them.

Whitespace, Encoding, Line Endings
- Encoding: ASCII/UTF‑8 without BOM.
- Line endings: LF (`\n`) is safe; QTR is tolerant of common endings.
- Spacing: Values must be on their own lines; avoid inline comments on data lines.

Minimal Valid Skeleton
```
## QuadToneRIP K,C,M,Y,LC,LM,LK,LLK,V,MK
# quadGEN vX.Y by David Marsh
# Example metadata lines…
# K curve
0
… (256 integers total)
# C curve
0
… (256 integers total)
# M curve
…
# Y curve
…
# LC curve
…
# LM curve
…
# LK curve
…
# LLK curve
…
# V curve
…
# MK curve
…
```

quadGEN Implementation Notes
- Scaling: Internally compute in 0–1, scale to 0–65535, round to nearest int, and clamp.
- Interpolation: Expand from sparse control data to 256 points using PCHIP (monotonic); Linear available for technical cases.
- EDN LUT/.acv: Preprocess to effective printer‑space mapping before writing values (quadGEN maps EDN using reverse + invert orientation).
- Export order: Write channels in current printer’s declared order; ensure every channel has 256 values.
- Filename: Use sanitized, descriptive names; `.quad` extension required.
- Defaults: On initialization, if the selected printer defines an `MK` channel it starts enabled at 100%; otherwise `K` starts enabled at 100%. All other channels start disabled. This is a UI default and not a .quad requirement.

Validation Checklist (manual)
- Open in QTR CurveView or a text editor; verify:
  - 256 values per channel, correct number of channels, expected order.
  - No non‑integer tokens in data lines; all values in range.
  - Visual curve shape matches graph preview from quadGEN.
- Install test: Copy to the appropriate CurveDropBox printer folder and print a step wedge to confirm.

References (local install)
- QTR “Getting Started” (CurveDesign/GettingStarted.rtf): overview of file roles and workflow.
- Example .quad files: `/Applications/QuadToneRIP/Profiles/.../*.quad` (for format examples).
