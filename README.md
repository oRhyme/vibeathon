# RelaySafe

**Keep good moving. Keep every handoff accountable.**

A working, deterministic prototype for the Vibe-A-Thon perishable-aid micro-logistics problem. It coordinates donors, volunteer riders, and receiving points with capacity-aware splits, bounded pickup leases, dependency checks, and physical-custody recovery. There are no user-facing AI decisions.

## Start

### Deploy quickly to Vercel (browser-local demo)

Import this repo, use the Vite preset (build `npm run build`, output `dist`), and deploy. `vercel.json` sets these defaults. On a known Vercel host, the UI enters clearly labelled **browser-local demo mode** because static hosting cannot answer `/api/state`; it uses the same rules engine and persists to browser storage. On another host, browser-local mode requires an explicit user choice. This supports static judging, but is not a shared backend or cross-device synchronization. The local and Render Express modes below remain the full shared-state implementation.

### Deploy to Render (shared server)

Use a **Node Web Service**, not a Static Site. `render.yaml` contains the defaults:

```text
Build command: npm ci && npm run build
Start command: npm start
Health check: /health
Node: 22
```

Render serves the built React app and the Express API from one origin. It injects `PORT`; the server binds to `0.0.0.0` and exposes both `/health` and `/api/health`. Free instances can sleep and have an ephemeral filesystem, so an idle/restarted service may return to the seeded demo. The client detects the per-process `X-RelaySafe-Boot-Id`, reloads the new seed snapshot, and shows a reset notice rather than keeping stale state. During a cold start it keeps the last snapshot read-only and retries with backoff; it does not silently switch a shared session into local mode.

Requires Node.js 22.12+ and npm. From the repository root:

```sh
npm ci
npm run dev
```

Open **http://localhost:5173**. The same server hosts the React app and operations API. Switch roles in the sidebar; open a second browser tab to see changes propagate (polling every 1.8 seconds). There is no separate backend to start.

For a production asset build:

```sh
npm run build
npm start
```

`npm start` uses `PORT` when provided and defaults to `5173`. The demo starts at **21:00 simulated IST**, not the real wall clock. Advance time with the workbench or role clock controls. Leases and freshness change only when simulated time advances; leaving a browser idle does not silently consume the demo.

## Why this is more than a donation board

- **Safe to dispatch, not merely matched:** readiness, strict expiry buffer, ETA, rider load, outstanding demand, committed storage, open status, and all required receiving facilities.
- **Reservations are leases, not ownership:** warn at 3 minutes, normally time out at 5, bound extensions by an absolute pickup deadline and remaining safe reassignment time. Old reservations cannot collect or deliver.
- **Physical custody is an invariant:** uncollected portions may be released; collected portions remain on a shipment even during failure or expiry. Partial handoffs preserve accounting.
- **Recovery is a real operation:** compatible fallback routing or a visible frozen exception; replacement-rider dispatch does not change custody until rendezvous time and explicit handoff verification.
- **Explainable by construction:** every consequential decision or rejection enters the event trail; export the state and decision history from the sidebar.

These are the prototype's differentiators, not a claim that no other logistics product implements them.

## Five-minute judge demo

### 1. Split 180 meals

1. Open **Operations control** and click **Auto-dispatch network**.
2. See 180 meals split into six reservations carried by five 40-unit riders, satisfying priority receiver needs of 50 / 80 / 50. One rider has two smaller receiver allocations sharing the same 40-unit capacity.
3. Inspect the dispatch queue, relay ledger, and decision trail. The other 40 seeded units are raw rations, not extra meals; totals across aid types use generic units.

### 2. Prove ghost-reservation release

1. Without acknowledging jobs, click **+1 minute** three times. Reservations warn of inactivity.
2. Advance two more minutes. They time out, release uncollected stock, and mark silent riders offline.
3. Open **Rider board**, select **Fatima**, check **Online**, then **Available for assignments**. Return to operations and dispatch again.
4. The old timeout records stay invalid. The decision trail records release and new allocation.

### 3. Prove safe receiver-closure rerouting

1. **Reset demo** and confirm. Auto-dispatch.
2. Open **Rider board**, select **Meera**. Accept her job and **Start pickup trip**.
3. Advance its displayed pickup travel time (3 minutes for Meera). If the lease is warning, a heartbeat restores its phase.
4. Confirm donor arrival, then confirm the actual physical pickup quantity. Use a smaller number to demonstrate partial pickup.
5. Read this shipment's destination. Open **Receiving points**, select that destination, and uncheck **Open for receiving**.
6. The shipment changes to a compatible fallback or an explicit recovery exception. Its collected quantity never becomes available at the donor.
7. Back on the rider board, advance toward the new ETA in steps of at most 5 minutes, sending **Progress heartbeat** between steps. After 7 minutes of silence physical aid enters recovery.
8. At ETA, **Confirm delivery**. Demand and stored quantity change only for confirmed received units.

### 4. Prove receiver dependencies

1. Reset. Open **Receiving points**, select **Jeevana Ration Point**.
2. The compatibility section explains that raw rations are blocked with `MISSING_COOKING_FUEL`.
3. Toggle cooking fuel to available. Compatibility recomputes through the shared engine; no UI-only bypass exists.
4. Try clean-water loss, demand reduction, receiver closure, or storage reduction. Active commitments re-evaluate.

### 5. Prove custody-aware recovery

1. Collect aid, then **Report rider failure**. The shipment freezes in recovery.
2. Enable an unloaded replacement rider. In operations or the failed rider's view, **Dispatch recovery**.
3. The aid remains with the original carrier. Advance to the displayed rendezvous time.
4. **Verify physical recovery handoff**. Only now does custody move. Confirm delivery after the new safe ETA.
5. Expire the batch instead to demonstrate that expired physical aid stays accounted for and cannot be delivered or reissued.

## Checks

```sh
npm test                 # Domain invariants and central API integration
npm run typecheck
npm run build
npm run format:check
```

The current Phase 0 baseline has **97 passing tests** (87 domain, 7 API, 3 browser-demo persistence/error cases). A production smoke check also starts `npm start` on a supplied `PORT` and confirms `/health` returns JSON with a boot ID.

Browser suite (isolated server on port 5174, separate local data file):

```sh
npx playwright install --with-deps chromium
npm run test:e2e
```

On minimal Linux images, the browser needs system libraries in addition to the downloaded browser. `npx playwright install-deps chromium` installs them. Browser screenshots and failure traces are written under ignored `test-results/`. The suite checks the actual UI, including split allocations, lease timeout, donor creation across tabs, receiver incompatibility, pickup/reroute/delivery, and responsive overflow at 1440, 768, and 390 pixels.

## Architecture and files

```text
src/domain/types.ts                   Typed entities, actions and inventory selectors
src/domain/seed.ts                    Deterministic Bengaluru pilot fixtures
src/domain/engine.ts                  Central rules and audited state transitions
server/app.ts                        Serialized API, durable receipts, atomic snapshot store
server/index.ts                      One-process app server, Vite dev and built-asset hosting
src/App.tsx                          Role navigation, shared state, connection/error handling
src/components/OperationsDashboard.tsx Network diagram, inventory, ledger and simulations
src/components/RoleConsoles.tsx       Donor, rider and receiver working flows
src/styles.css, src/shell.css         Operations visual system and responsive shell
src/components/roles.css             Role form and manifest layouts
tests/domain.test.ts                 Boundary, compatibility, expiry, leases and custody tests
tests/api.test.ts                    HTTP, concurrency, persistence and workflow integration
e2e/relay.spec.ts                    Real browser judge scenarios and responsive checks
```

Every UI mutation posts an action to `/api/actions`. The server validates against its latest snapshot synchronously, persists before publishing, and returns an audit receipt. Concurrent clients cannot both claim the same remaining units. Recent command identities survive restarts and deduplicate retries (last 128 receipts). This is a **single-server-process** design, not a distributed database transaction system.

The local snapshot is `.data/operations.json` (git-ignored). `PORT` changes the listener port; `DATA_FILE` chooses another local snapshot path. Run only one process per data file. Reset replaces scenario entities while retaining event history and monotonic IDs. Simulated timestamps consequently restart at 21:00 across reset boundaries; read reset events as scenario boundaries.

## Scope and honest limitations

- Seeded names, capacities, locations and routes are **demo fixtures**, not live shelters or volunteers. Meal shelf life in the seed is 45 simulated minutes to make safety pressure visible; you can post a 75-minute batch from the donor desk.
- This is a local/LAN judging prototype **without authentication or authorization**. Do not expose it publicly or enter real medical, beneficiary, or contact data. All connected clients can operate every role and reset the scenario.
- Routes are deterministic coordinate-based simulated ETAs, not GPS or traffic-aware navigation. Bundled cargo has sequential destination ETAs. Fallback recovery moves the full remaining physical shipment; partial splitting of an already-collected shipment is not implemented.
- Dependency policy is configurable through required capabilities, but it is not professional food-safety, medical, infant-feeding or regulatory certification. Physical handoff is operator-attested, not sensor-verified.
- No SMS, payments, accounts, AI decision-making, nationwide route optimization, or offline-mobile synchronization. Polling provides shared state while the server is reachable; cold starts are surfaced as read-only with automatic retry.
- Local JSON persistence is atomic on rename, not multi-process locking or an unlimited append-only audit service. Keep backups for important demonstrations.

## Visual references

The UI uses an editorial dispatch-desk direction: paper, forest-green ink, citrus status accents, actual inventory typography, and a schematic network derived from the pilot's entities. It takes broad hierarchy and product-interface inspiration from Stripe and the public Taste Skill project, without copying assets or installing/running remote scripts. The supplied X post could not be loaded; the public author repository was reviewed instead.

Reference sources: `https://stripe.com` and `https://github.com/Leonxlnx/taste-skill`. No third-party photos or remote font requests are needed for the demo.
