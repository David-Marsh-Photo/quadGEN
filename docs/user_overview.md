# quadGEN at a Glance

quadGEN helps inkjet printers get the most from QuadToneRIP by turning raw measurements into beautifully smooth curves. The app runs entirely in your browser, so you can tweak, preview, and export calibration data without installing extra software.

## What You Can Do
- **Tune curves quickly.** Import existing `.quad` files or measurement data and refine them with Smart Edit Mode.
- **Stay flexible with formats.** Bring in LAB/CGATS/CTI3 readings, manual L* entries, LUT `.cube` files, or Photoshop `.acv` curves—the editor keeps everything in sync.
- **Lean on built-in guidance.** Contrast “intents,” undo/redo, key-point labels, and Lab Tech automations help you hit your target look faster.
- **Share or archive results.** Export a single-file bundle that contains your updated curve, notes, and a lightweight help panel for future reference.

## How the App Feels
quadGEN mirrors a darkroom workflow. You adjust tone ramps, watch the chart respond instantly, and see how small tweaks affect your print. Smart Edit Mode keeps curve transitions smooth while still letting you make precise, manual adjustments when needed.

## Getting Started
1. **Open the app.** Launch the development server (`npm run dev`) or the production bundle (`dist/index.html`).
2. **Load your data.** Use the import menu to pull in measurements or curves. The parser validates your file before it touches the working curve.
3. **Adjust with confidence.** Flip on Smart Edit Mode to protect tonal transitions, switch contrast intents to explore different looks, and use undo/redo while you experiment.
4. **Export and test.** Save your updated `.quad` file and print a test target to confirm the results.

## Learn More
- The in-app Help dialog links to the ReadMe, Glossary, Workflow tips, and version history.
- Need deeper guidance? See [`docs/quadgen_user_guide.md`](./quadgen_user_guide.md) for a step-by-step walkthrough, or explore the developer docs under [`docs/dev/`](./dev/) if you’re extending the tool.

quadGEN is designed to make curve editing approachable while preserving the control advanced printers expect. Dive in, try a few edits, and let the app keep your calibration workflow organized.
