# Where to Look for Linearization Guidance - Summary

## What We've Found So Far

### Official QTR Documentation
- **Exists but not fully accessible online**: User Guide PDF and QIDF spec require direct download
- **Web search reveals**: Linearization is a standard QTR workflow, but technical implementation details not publicly documented
- **Community consensus**: "Print target → measure → linearize → validate" workflow is standard

### Key Discovery from Web Search
From search results, the QTR linearization process mentions:
> "A LINEARIZE line with two sets of numbers is generated, and users should use the one labeled 'For Digital Negatives'"

This suggests QTR has **built-in linearization functionality** that generates correction data. We need to understand what this LINEARIZE line does to curves.

### Reference .quad Files in Repository
- Multiple professional multi-ink .quads exist in `archives/reference/`
- Example: `Toyobo-10chan-MK-C-LK.quad` also has delayed K onset
- These are presumably working/tested configurations
- **We could analyze these to see patterns in ink splits**

## Most Promising Next Steps (Ranked)

### 1. **Contact the QTR/Print Community** 🎯 HIGHEST VALUE
**Why**: Direct answers from people who use this daily

**Where to ask**:
- **groups.io/g/QuadToneRIP** - Active mailing list
- **Black and White Mastery** (Paul Roark) - QTRProfiler-Pro developer
- **InkjetMall Community** - Piezography users
- **DNPRO support** - They might explain their approach

**Question to ask**:
> "When applying LAB linearization to multi-ink .quads with delayed onset channels (e.g., K starts at 60% input), should the correction preserve original ink onset positions, or remap/compress each channel's active range to achieve linear L* output?
>
> Comparing quadGEN vs DNPRO shows very different behaviors - DNPRO compresses the delayed K channel by 76% and shifts onset from 61% to 91% input. Is this expected/correct for QTR linearization?"

### 2. **Empirical Print Testing** 🎯 DEFINITIVE ANSWER
**Why**: Actual measurements will show which approach is correct

**What to do**:
1. Print test patches using quadGEN's corrected .quad
2. Print test patches using DNPRO's corrected .quad
3. Measure both with spectrophotometer
4. Compare L* linearity curves
5. **Winner = whichever produces more linear L* progression**

**Requirements**:
- Printer (P800)
- Spectrophotometer (i1Pro, ColorMunki, etc.)
- Same paper/ink as original target
- Test pattern software

### 3. **Analyze QTR Source Code** 🔍 TECHNICAL TRUTH
**Why**: The implementation is the specification

**Where**:
- QTR may be open source or have available source
- QuadToneProfiler-Pro might be documented
- Look for curve manipulation algorithms

**Status**: Need to investigate if source is available

### 4. **Download Official Documentation Directly**
**Why**: Specs may exist, just not web-accessible

**Action**:
- Download QTR User Guide PDF from quadtonerip.com (not via WebFetch)
- Get QIDF specification PDF
- Purchase Piezography manual if needed
- Review any included technical appendices

### 5. **Study ICC/ISO Color Management Standards**
**Why**: General principles may apply

**Standards to review**:
- ISO 15076-1 (ICC color management)
- ISO 12647 (graphic technology process control)
- CGATS linearization standards

**Caveat**: May be too general for QTR-specific implementation

## What We Know from Analysis

### DNPRO's Behavior (Industry Tool)
- Compresses delayed-onset channels into narrower input range
- Expands early-onset channels to fill domain
- Each channel independently remapped
- Achieves different correction magnitudes at same input position
- **This is a deliberate design choice, not a bug**

### quadGEN's Current Behavior
- Applies same correction at same input position across all channels
- Preserves original ink onset positions
- Works by correcting existing curve values in place
- **Also a valid interpretation of "linearization"**

## The Core Question

**There are two valid interpretations**:

**A) Input-Position Mapping (quadGEN)**
- "Linearization correction at 50% input applies to all channels at index 127"
- Preserves multi-ink balance and onset timing from original .quad
- May not achieve perfect L* linearity if channels don't cover full range

**B) Active-Range Remapping (DNPRO)**
- "Linearization redistributes each channel's ink across the input domain to achieve linear L* output"
- Changes onset positions and ink split strategy
- Achieves more accurate L* linearization
- Treats linearization as a re-optimization, not just value adjustment

**Without specification or community consensus, either could be "correct"**

## Recommendation

**Step 1**: Post detailed technical question to groups.io/g/QuadToneRIP
- Include comparison data
- Ask for clarification on expected behavior
- Reference DNPRO as industry example

**Step 2** (parallel): Contact DNPRO directly
- Ask them to explain their algorithm/rationale
- Understand if they follow a specification or empirical approach

**Step 3**: If still unclear, perform empirical print testing
- Measurements will reveal which approach produces better linearization
- Real-world results trump theoretical correctness

**Step 4**: Based on findings, either:
- Keep quadGEN's current approach (if it's correct)
- Implement DNPRO-style remapping (if that's the standard)
- Or: Offer BOTH as options with a setting

## Files for Reference

All investigation documentation is in `/media/psf/quadGEN/docs/investigation/`:
- `LINEARIZATION_DOMAIN_MAPPING_BUG.md` - Full technical analysis
- `INVESTIGATION_SUMMARY.md` - Executive summary
- `GUIDANCE_SOURCES.md` - Resource inventory
- `WHERE_TO_LOOK_NEXT.md` - This file

Analysis scripts:
- `analysis-correction-comparison.cjs` - Side-by-side comparison
- `analysis-dnpro-domain-mapping.cjs` - Reverse engineering DNPRO
