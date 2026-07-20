# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

LochCAD is an open-source schematic and perfboard (Lochraster) CAD app that runs in the browser. React 18 + TypeScript + Vite, Zustand for state, Konva/react-konva for the 2D editors, three.js (react-three-fiber) for 3D preview, Tailwind for styling, and a WebSocket collaboration server in `server/collab-server.cjs`.

### Commands

- `npm run dev` — start the Vite dev server
- `npm run build` — type-check (`tsc -b`) and build
- `npm run lint` — run ESLint
- `npm run preview` — serve the production build

## UI Design Guidelines

These rules apply to every panel, dialog, and page in LochCAD. The goal is a dashboard-style UI that feels effortless: simple, aesthetic, and actually usable.

### Sidebar

The sidebar is the spine of the app. It holds persistent, globally relevant elements: navigation, profile management, search.

- Every link starts with a recognizable icon plus a short title, so the sidebar still works when collapsed and can carry notification counts or "new" chips.
- Group links by relevance to reduce cognitive load. Rarely used items (settings, help) go to the bottom.
- When the number of links grows, nest them into dropdowns instead of letting the list sprawl.
- Always show an active state (e.g. a highlighted rectangle) for the current section.
- Empty sidebar space can hold feature highlights or notifications, but that is optional.

### Main layout

- Do one thing well per view. If a screen looks like it needs a PhD to operate, it is too complex.
- Dashboard type scales are smaller and tighter than landing-page type scales. Use a compact type ramp with small steps between sizes.
- Follow the grid strictly. Dashboards use most or all of the screen, so misalignment shows immediately.
- What sits at the top of the main area signals what matters most to the user. Put the primary object of the app (the project, the board, the schematic) there, with supporting metrics below.
- Reserve the very top of a page for important page actions and simple navigation (e.g. a dropdown plus one primary button).
- Keep list rows minimal: icon, name, key detail, timestamp. A short description in the middle is fine; prefer a clean stacked list over per-row borders unless visual separation is genuinely needed.
- Design the empty state for every list. It is not an afterthought.
- Support multi-select in lists, revealing contextual bulk actions only when items are selected.

### Charts

- No decorative or ambiguous visualizations. If a viewer cannot tell what a chart shows, remove it.
- Start from a basic line or bar chart. Always include grid lines and axis numbers.
- Add a short summary and a date-range selector.
- Use icons/favicons next to bars or rows so entries are identifiable at a glance.
- Charts can be simple, informative, and aesthetic at the same time; those are not trade-offs.

### Modals, popovers, toasts, and pages

Pick the container by weight of the interaction:

- Popover: simple, non-blocking context (display settings, quick options). Clicking away has no consequences.
- Modal: more complex but still tied to the current page (e.g. creating an item shown in the list behind it). Blocking: the user must confirm or cancel. Follow a modal-driven change with a toast confirming it, since the page was hidden while the change happened.
- Toast: the notification system of the app. Use for confirmations, warnings, and errors without taking over the screen. Warning and error states are frequently forgotten; design them.
- New page: for permanent or large contexts (opening an existing item in full). A back button or breadcrumb is required on such pages.

### The four dashboard components

Almost every page is built from four elements:

1. Lists and tables. Separation comes from space, dividers, or color. A table becomes a tool when the user can search, filter, and sort it.
2. Cards. Keep margins generous so content is not tightly packed. Choose borders or background fills for card surfaces; outlines tend to work better in dark mode, background colors in light mode.
3. User input. Forms in modals and settings pages; sometimes tables of inputs inside cards.
4. Tabs. Use tabs to add related views without cluttering the sidebar or leaving the page context.

### Micro-interactions

- Keep animation tame and user-focused; this is a tool, not a landing page.
- Chart hover states may be more playful: value labels, percentage bubbles, dimming non-hovered series.
- Prefer optimistic UI: apply the change instantly, assume the server call succeeds, and reconcile on failure. No awkward pauses.

## Writing Style: Avoid AI Tells

All prose written in this repo (docs, README, changelogs, UI copy, commit messages, comments) must avoid the standard LLM default voice. Strip these fingerprints:

### Banned words

Do not use as filler: delve, unlock, leverage, robust, harness, showcase, navigate, vibrant, framework, ecosystem, seamless, utilize, facilitate, elevate, empower, streamline, foster, pivotal, crucial, comprehensive, holistic, innovative, cutting-edge, game-changer, transformative, synergy, dynamic, tapestry, landscape, realm, journey, embark, dive deep, unleash, supercharge, effortlessly, and similar buzzwords. Technical uses are exempt: "framework" for a named software framework, "key" for a cryptographic key, "navigate" for literal UI navigation.

### Banned phrases

- "in today's fast-paced world"
- "unlock the potential of"
- "it is worth noting that"
- "in conclusion"
- "drive meaningful impact"
- Sycophantic openers and summary closers in general. Cut them entirely rather than rephrasing them.

### Banned structures

- No em dashes and no en dashes. Use periods, colons, or rewrite the sentence.
- No compound-word hyphens where an unhyphenated form or acronym exists ("go-to-market" becomes "GTM" or "go to market").
- No default rule of three. Vary list length: sometimes two items, sometimes four, sometimes none.
- No bulleted lists with bolded titles as a default formatting crutch.
- No formulaic transitions: Furthermore, Moreover, Additionally, Subsequently, In addition, As previously mentioned.

### Weak verb constructions

Replace with direct verbs:

- "utilize" becomes "use"
- "facilitate" becomes a concrete verb for what actually happens
- "X serves as a bridge between A and B" becomes "X bridges A and B"
- "acts as a", "marks the", and filler uses of "features" get the same treatment

### The test

Read the sentence aloud. If it sounds like a committee or a press release wrote it, rewrite it. Quoted material and code (including variable names and comments quoting code) stay untouched.
