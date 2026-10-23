# Verification and handoff

## Delivered

React/TypeScript operations dashboard, donor/rider/receiver consoles, deterministic safety engine, simulated clock and failure controls, shared serialized API, local durable snapshots and recent-command deduplication, custody-aware two-step recovery, and exportable audit history.

Start with `npm ci` then `npm run dev`; open `http://localhost:5173`. Follow the in-app **Judge’s field guide** or `README.md` for the demonstration.

## Actual verification

- `npm test`: **97 passed** (87 domain tests, 7 API integration tests, 3 browser-demo persistence/error-handling tests).
- `npm run build`: passed TypeScript checking and production asset generation.
- `npm run typecheck`: passed.
- `npx prettier --check package.json server/app.ts src/App.tsx src/browserDemo.ts src/ErrorBoundary.tsx src/main.tsx src/shell.css tests/api.test.ts tests/browserDemo.test.ts render.yaml`: passed.
- `git diff --check`: passed.
- Clean-install preflight: `npm ci` completed with 0 vulnerabilities, followed by a successful `npm run build`.
- Production smoke: `npm start` with a supplied `PORT` served `/health` as JSON with a per-process boot ID.
- Production asset/API preflight: a clean `npm start` on `PORT=4391` served `/`, returned the seeded `/api/state` payload (2 batches, 6 riders, 5 receivers, 1 event), and passed `/health` validation. The process was stopped after the check.
- Targeted browser smoke: `npx playwright test e2e/relay.spec.ts --grep "desktop operations renders honest zero state"` passed against the normal shared server; the UI loaded, dispatched the real 180-unit split, and reported no page errors.
- README deployment runbook updated with the Render dashboard steps, health/state curl checks, Free-tier caveats, and a reproducible local production preflight command.
- Real browser dashboard inspected at desktop width; browser-suite screenshots inspected at desktop and 390px phone width.
- Last `npm run test:e2e`: **7 passed, 1 failed**. Passed: split allocations, donor creation shared across tabs, full pickup/closure/reroute/receipt, missing-fuel reason code, and all four role views without horizontal overflow at 1440/768/390px.
- Remaining last-run failure: ghost-reservation scenario’s final `getByText("Fatima").first()` selected a hidden SVG `<title>` instead of the visible relay ledger. Timeout/release and reserve-rider activation completed; screenshot and server-backed UI showed a new 40-unit allocation. Selector is now scoped to `.ledger-title`; **not rerun after that correction**, respecting the request to stop repeated browser-suite retries.
- No claim that every possible logistics case is covered. Automated domain coverage includes malformed inputs, double claims, rider capacity, storage, readiness, strict safety-buffer boundaries, missing dependencies, stale/resurrected assignments, partial pickup/delivery, post-pickup silence, no fallback, bundled stops, receiver changes, recovery rendezvous, failed recovery rider, and expired physical custody.

## Environment issues resolved or still open

- Render deployment baseline: `render.yaml` defines a Node web service using `npm ci && npm run build`, `npm start`, Node 22, and `/health`. `tsx` is a runtime dependency, `.nvmrc` pins `22`, and `package.json` requires Node `>=22`.
- Vercel/static-host deployment: `vercel.json` builds `dist`. On known Vercel hosts the UI enters explicitly labelled browser-local demo mode using the real rules engine and guarded local storage; on other hosts the user must choose it. No shared backend or cross-device sync is claimed for static hosting.
- Shared-server failure handling: the API exposes a per-process `X-RelaySafe-Boot-Id`; a changed ID forces the client to accept the new server snapshot and show a reset notice. A cold/unreachable server leaves the last snapshot read-only and retries with backoff instead of silently switching modes.
- Final isolated browser smoke from the earlier static fallback implementation passed: intercepted API requests with 404 responses, verified the visible browser-local mode label, dispatched 180 meals through the actual UI, and confirmed those reservations survived a page reload. No shared-server mutations occurred. The current Phase 0 client now requires a known Vercel host or an explicit local-mode choice on non-static hosts; the full browser suite remains not rerun after the later selector correction.

- Minimal container initially lacked Chromium libraries, fonts and Fontconfig, causing browser startup/render crashes. Required runtime libraries and fonts were installed; subsequent browser tests ran normally. Fontconfig package post-install emitted a container ownership warning; this did not prevent the last browser run.
- GitHub push was attempted after the first local feature commit and failed: `could not read Username for 'https://github.com'`. Authentication was not supplied to this container. Local commits are saved; remote publication needs an authenticated `git push -u origin main` from the user’s terminal. Never put a token in project files or chat.
- The supplied X post did not load; Stripe and the author’s public Taste Skill repository were reviewed instead. No third-party skill installer or remote executable script ran.

## Prototype boundaries

No authentication, public production deployment, live GPS/traffic, SMS, payments, or medical/food-safety certification. One server process per local snapshot file. Physical handoffs are operator-attested. All locations, organizations and quantities are fixtures. Simulated time advances only through commands. See `README.md` for details and the complete demo script.
