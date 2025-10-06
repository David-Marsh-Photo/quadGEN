# Potential Sources for Linearization Guidance

## Sources Identified

### 1. **QuadToneRIP Official Sources** ✓ Searched
- **User Guide PDF**: quadtonerip.com/User%20Guide.pdf (blocked/encrypted)
- **QIDF Specification**: chainick.github.io/qidf-spec/ (incomplete on web)
- **Official Website**: quadtonerip.com
- **Status**: PDFs not accessible via web scraping

### 2. **Piezography (Commercial QTR Implementation)** ⚠️ Access Blocked
- **Linearization Manual**: shop.inkjetmall.com/linearizing-piezography (403 forbidden)
- **Community Edition**: piezography.com
- **InkjetMall Community Forums**: community.inkjetmall.com
- **Status**: May require account/purchase access

### 3. **QTR Community Resources**
- **Groups.io Mailing List**: groups.io/g/QuadToneRIP
  - Active discussions, searchable archive
  - Topics on .quad file creation, linearization workflows
- **Black and White Mastery**: bwmastery.com
  - QuadToneProfiler-Pro tool
  - Blog posts on .quad editing and linearization
  - Advanced workshops

### 4. **Professional Print Forums**
- **Luminous Landscape**: Tutorial on QTR digital negatives
- **Photrio.com**: Digital negative discussions
- **Large Format Photography Forum**: QTR setup discussions
- **Status**: General user discussions, may not have technical specs

### 5. **Reference .quad Files in Repository**
Located in `/media/psf/quadGEN/archives/reference/`:
- Prints on Paper Studio curves (Toyobo, Toray materials)
- Multiple multi-ink configurations (MK-C-LK, OpenBite, etc.)
- QTR official profiles (P700-900 series)
- **Action**: Analyze these for delayed-onset patterns

### 6. **ICC Profile Standards** (Not yet searched)
- **ISO 15076-1**: ICC color management specification
- **ICC.1 specification**: Color management architecture
- **Potential**: General guidance on multi-channel linearization

### 7. **Print Industry Standards** (Not yet searched)
- **ISO 12647**: Graphic technology process control
- **CGATS standards**: Committee for Graphic Arts Technologies Standards
- **Potential**: Multi-ink press linearization guidance

### 8. **Academic/Technical Papers** (Not yet searched)
- Search for: "inkjet linearization multi-channel"
- Search for: "tone reproduction curve multi-ink"
- **Potential**: Fundamental algorithms and theory

## Recommended Next Steps

### Immediate Actions (Can Do Now)

1. **Analyze Repository .quad Files**
   - Compare before/after linearization examples if available
   - Look for patterns in delayed-onset channel transformations
   - Document ink split strategies in professional curves

2. **Contact Community**
   - Post on groups.io/g/QuadToneRIP with specific technical question
   - Ask Black and White Mastery directly
   - Reach out to DNPRO developers

3. **Examine Reference Implementation**
   - Find QTR source code (if available)
   - Look for QuadToneProfiler-Pro implementation details
   - Check if any linearization tools are open source

### Research Actions (Requires Time)

4. **Download Official Documentation**
   - Obtain QTR User Guide PDF directly (not via web)
   - Purchase/access Piezography manual if needed
   - Get QIDF specification PDF

5. **Academic Literature Search**
   - Google Scholar: inkjet tone reproduction
   - IEEE Xplore: multi-channel color management
   - Print industry journals

6. **Standards Review**
   - ISO standards for color management
   - ICC profile specifications
   - CGATS committee publications

### Empirical Validation (Requires Equipment)

7. **Print Testing**
   - Print patches with quadGEN approach
   - Print patches with DNPRO approach
   - Measure with spectrophotometer
   - Compare L* linearity

## Questions to Ask Community

When posting to QTR forums/groups:

> "When applying LAB linearization to a multi-ink .quad file where some channels have delayed ink onset (e.g., K channel outputs 0 ink for 0-60% input, then ramps up), should the linearization correction:
>
> A) Apply uniformly to all channels at the same input position (preserving original onset positions)?
>
> B) Remap each channel's active ink range independently to achieve the linear L* target (changing onset positions)?
>
> I'm comparing output from QuadGEN vs. DNPRO and seeing significantly different behaviors. DNPRO appears to compress delayed-onset channels into a narrower input range. Is this expected/correct for QTR linearization?"

## Contacts to Reach Out To

- **Roy Harrington**: QTR original author (if still active in community)
- **Jon Cone**: Piezography/InkjetMall
- **Black and White Mastery**: Paul Roark (QuadToneProfiler-Pro author)
- **DNPRO developers**: Via their support channels

## Documentation Already Created

- `LINEARIZATION_DOMAIN_MAPPING_BUG.md` - Technical analysis
- `INVESTIGATION_SUMMARY.md` - Executive summary
- Analysis scripts demonstrating the difference
- Test data showing quadGEN vs. DNPRO outputs
