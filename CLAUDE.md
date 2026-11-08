# ryos-qntns

Public fork of ryokun6/ryos (AGPL-3.0, LICENSE untouched). Changed copy served to visitors, so its source stays public here.

- React + TypeScript + Vite, and the deps the build needs, are allowed (amends the QNTNs-ghost no-framework rule; STOP 1 Q13: "Amend the rule").
- Ghost gets only the built bundle. Nothing from this repo's source ships into the theme as-is.
- Work on `main`. Push every commit.
- No test browsers: no puppeteer, playwright or headless Chrome.
- The user judges every visual. Do not judge appearance yourself.
- All UI is native Mac OS X Aqua as of Tiger (10.4): windows, sheets, alerts, pop-ups, buttons, menus, form fields, toolbars, built from the Aqua theme classes (`src/themes/macosx.ts`, `src/styles/themes/aqua.css`). Never generic web UI: no flat cards, no material buttons, no custom-styled modals. Pieces already modelled on 10.3 stay.
- The plan lives in QNTNs-ghost `checklists/CHECKLIST-35-ryos-desktop.html`.
- The worker does not commit. The author commits and pushes this fork.
