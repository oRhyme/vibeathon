# Verification and handoff

## Delivered

React/TypeScript operations dashboard, donor/rider/receiver consoles, deterministic safety engine, simulated clock and failure controls, shared serialized API, local durable snapshots and recent-command deduplication, custody-aware two-step recovery, and exportable audit history.

Start with `npm ci` then `npm run dev`; open `http://localhost:5173`. Follow the in-app **Judge’s field guide** or `README.md` for the demonstration.

## Actual verification

- `npm test`: **94 passed** (87 domain tests, 6 API integration tests, 1 static-demo persistence test).
- `npm run build`: passed TypeScript checking and production asset generation.
- `npm run typecheck`: passed.
- Real browser dashboard inspected at desktop width; browser-suite screenshots inspected at desktop and 390px phone width.
- Last `npm run test:e2e`: **7 passed, 1 failed**. Passed: split allocations, donor creation shared across tabs, full pickup/closure/reroute/receipt, missing-fuel reason code, and all four role views without horizontal overflow at 1440/768/390px.
- Remaining last-run failure: ghost-reservation scenario’s final `getByText("Fatima").first()` selected a hidden SVG `<title>` instead of the visible relay ledger. Timeout/release and reserve-rider activation completed; screenshot and server-backed UI showed a new 40-unit allocation. Selector is now scoped to `.ledger-title`; **not rerun after that correction**, respecting the request to stop repeated browser-suite retries.
- No claim that every possible logistics case is covered. Automated domain coverage includes malformed inputs, double claims, rider capacity, storage, readiness, strict safety-buffer boundaries, missing dependencies, stale/resurrected assignments, partial pickup/delivery, post-pickup silence, no fallback, bundled stops, receiver changes, recovery rendezvous, failed recovery rider, and expired physical custody.

## Environment issues resolved or still open

- Vercel/static-host deployment fix: `vercel.json` builds `dist`. When no API is available before a server session begins, the UI explicitly enters browser-local demo mode using the real rules engine and local storage; it never silently switches after an active server session fails. No shared backend or cross-device sync is claimed for static hosting. Typecheck, 94 tests and production build passed after this fix; the browser suite was not rerun.
- Final isolated browser smoke passed: intercepted API requests with 404 responses, verified the visible browser-local mode label, dispatched 180 meals through the actual UI, and confirmed those reservations survived a page reload. No shared-server mutations occurred. This was one targeted smoke check, not a rerun of the full browser suite.

- Minimal container initially lacked Chromium libraries, fonts and Fontconfig, causing browser startup/render crashes. Required runtime libraries and fonts were installed; subsequent browser tests ran normally. Fontconfig package post-install emitted a container ownership warning; this did not prevent the last browser run.
- GitHub push was attempted after the first local feature commit and failed: `could not read Username for 'https://github.com'`. Authentication was not supplied to this container. Local commits are saved; remote publication needs an authenticated `git push -u origin main` from the user’s terminal. Never put a token in project files or chat.
- The supplied X post did not load; Stripe and the author’s public Taste Skill repository were reviewed instead. No third-party skill installer or remote executable script ran.

## Prototype boundaries

No authentication, public production deployment, live GPS/traffic, SMS, payments, or medical/food-safety certification. One server process per local snapshot file. Physical handoffs are operator-attested. All locations, organizations and quantities are fixtures. Simulated time advances only through commands. See `README.md` for details and the complete demo script.
