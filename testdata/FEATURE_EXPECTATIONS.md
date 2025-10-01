# Feature Expectations for Printer-Space Sanity Checks

Use these samples to verify that image-space inputs are being normalized correctly and that quadGEN plots printer-space behavior as expected.

**Sample Overview**

```
Filename                         Type                          Expected Feature After Load
--------------------------------------------------------------------------------------------------------------
testdata/humped_shadow_dip.quad  QuadToneRIP .quad (P400)      K channel shows a dip below the diagonal near ~55% input
                                                              (mid-shadows). Other channels plot as straight ramps.
                                                              Because it’s already printer space, the dip should land
                                                              exactly where defined.

testdata/highlight_bump_1d.cube  1D LUT (image space)          After conversion, a sharp dip in the highlights around
                                                              ~25% input (less ink in bright highlights).

testdata/midtone_collapse_3d.cube 3D LUT neutral axis (image)  Expect a hump above the diagonal centered near ~50% input;
                                                              the neutral-axis entry was forced dark, so printer space
                                                              remaps it to extra midtone ink.

testdata/midtone_lift.acv        Photoshop curve (image space) Deep dip around ~50% input (lightening midtones). Smart
                                                              key points should align when Edit Mode is enabled.

testdata/lab_banded_shadow.txt   LAB measurement               Global correction produces a dip near 60% input (GRAY 60
                                                              measured too dark). The dip should align with the LAB
                                                              overlay marker.

testdata/linear_reference_lab.txt LAB measurement              Strict linear baseline (no correction). Use this to sanity
                                                              check contrast intents—the curve should lie on the
                                                              diagonal until an intent reshapes it (L* values follow
                                                              CIE density math, so they look non-linear in raw form).
```

## Sanity Test Steps
1. Load each file through the appropriate UI (Global Corrections or channel-specific). For `.quad`, use **Load .quad**; for LUT/ACV/LAB use **Load Data File**.
2. Confirm the tooltip/processing detail lists the filename and that the plotted curve shows the feature described.
3. Toggle Edit Mode to ensure Smart key-point seeding lands in the same location (no mirrored/misaligned features).
4. For LUT/ACV files, sanity-check that the feature appears at the printer-space coordinate listed rather than its original image-space coordinate. If it appears mirrored, the conversion pipeline is misbehaving.
