# quadGEN Development Roadmap

This document outlines potential future goals and architectural strategies for the quadGEN project. These are ideas for consideration as the tool grows and evolves.

## Architectural Goals

### 1. Implement a Build Step for Development

- **Goal:** Preserve the project's core strength of single-file portability for end-users while adopting a modern, modular development workflow.

- **Current State:** The entire application (`HTML`, `CSS`, `JavaScript`) is contained in `quadgen.html`. This is excellent for user portability but can become difficult to maintain, test, and collaborate on as the project grows.

- **Proposed Strategy:**
    1.  **Develop in Modules:** The source code would be split into logical, separate files (e.g., `src/main.js`, `src/interpolation.js`, `src/styles.css`, `src/index.html`). This makes the code easier to navigate, maintain, and test.
    2.  **Introduce a Build Step:** Use a simple, modern build tool (like Vite or esbuild) to run a single command (e.g., `npm run build`).
    3.  **Automate Bundling:** The build tool would automatically compile all JavaScript and CSS, minify it to reduce file size, and inject it into the HTML skeleton.
    4.  **Distribute the Single File:** The output of the build process would be a single, self-contained, and optimized `quadgen.html` file, just like the one that exists now.

- **Benefits:**
    - **For Users:** The final product remains a single, portable file. They would see no change except for a potentially smaller file size.
    - **For Developers:** The development experience becomes much cleaner and more aligned with modern standards. It enables easier collaboration, better source control management, and makes implementing automated tests feasible.

### 2. Centralize State Management

- **Goal:** Improve the clarity, predictability, and traceability of data as it flows through the application.

- **Current State:** Application state (e.g., `linearizationData`, `loadedQuadData`, `perChannelLinearization`) is managed through several distinct global variables. While functional, this can make it difficult to track where and when data changes, especially as new features are added.

- **Proposed Strategy:**
    1. **Create a Single State Object:** Consolidate all dynamic application data into a single, comprehensive JavaScript object (e.g., `const quadgenState = { ... }`).
    2. **Explicit State Updates:** Refactor functions to read from and write to this central state object, rather than modifying global variables directly. This makes the data flow explicit.

- **Benefits:**
    - **Clarity & Debugging:** The entire state of the application can be inspected at any time by logging a single object (`console.log(quadgenState)`), providing a complete snapshot for debugging.
    - **Traceability:** It becomes much easier to find where a piece of data is being modified, as all changes are channeled through the central state object.
    - **Foundation for Future Features:** A centralized state is a prerequisite for advanced features like saving and loading user sessions.

### 3. Implement an Automated Test Suite

- **Goal:** Increase code quality and developer confidence by creating a safety net that automatically verifies the correctness of core logic.

- **Current State:** Testing relies on manual checks and isolated scripts. This is effective for targeted development but does not provide automated, comprehensive regression testing.

- **Proposed Strategy:**
    1. **Integrate a Testing Framework:** Introduce a lightweight, modern framework like **Vitest** or **Jest**. These tools are standard in the JavaScript ecosystem and provide a simple way to write and run tests.
    2. **Start with Pure Functions:** Begin by writing **unit tests** for the core mathematical and data-processing functions that do not depend on the UI. These are the easiest to test and provide the highest value. Good candidates include:
        - Interpolation algorithms (`createPCHIPSpline`, etc.)
        - Color science conversions (`cieDensityFromLstar`)
        - Coordinate space transformations (`DataSpace` object)
        - File parsers (`parseCube1D`, `parseACVFile`)
    3. **Expand Coverage:** Gradually add tests for more complex application logic.

- **Benefits:**
    - **Confidence & Safety:** Developers can make significant changes and run the test suite to instantly verify that they haven't accidentally broken existing functionality.
    - **Living Documentation:** Tests act as a form of documentation, showing exactly how a function is expected to behave with various inputs.
    - **Easier Onboarding:** New contributors can use the tests to understand the codebase and can contribute changes more safely.