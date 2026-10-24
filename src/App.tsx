import { useCallback, useEffect, useRef, useState } from "react";
import Lenis from "lenis";
import {
  ArrowRight,
  Bike,
  BookOpen,
  Check,
  Clock3,
  Command,
  ChevronDown,
  HeartHandshake,
  LayoutDashboard,
  PackagePlus,
  Radio,
  RotateCcw,
  ShieldCheck,
  Warehouse,
  X,
  type LucideIcon,
} from "lucide-react";
import OperationsDashboard from "./components/OperationsDashboard";
import {
  browserAction,
  getBrowserDemoStatus,
  readBrowserState,
  type BrowserDemoPersistence,
} from "./browserDemo";
import {
  DonorConsole,
  ReceiverConsole,
  RiderConsole,
} from "./components/RoleConsoles";
import {
  ACTIVE_RESERVATIONS,
  batchTotals,
  formatTime,
  type Action,
  type ActionResult,
  type OperationsState,
} from "./domain/types";

const roles = [
  { id: "operations", label: "Operations control", icon: LayoutDashboard },
  { id: "donor", label: "Donor desk", icon: PackagePlus },
  { id: "rider", label: "Rider board", icon: Bike },
  { id: "receiver", label: "Receiving points", icon: Warehouse },
] as const;
type Role = (typeof roles)[number]["id"];
type AppRoute = Role | null;

function useHomeSmoothScroll(enabled: boolean) {
  useEffect(() => {
    if (!enabled || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const lenis = new Lenis({
      autoRaf: true,
      stopInertiaOnNavigate: true,
      respectReducedMotion: true,
      prevent: (node) => node.closest("[data-lenis-prevent]") !== null,
    });

    return () => lenis.destroy();
  }, [enabled]);
}

function routeFromHash(): AppRoute {
  const hash = globalThis.location?.hash.slice(1) ?? "";
  return roles.some((item) => item.id === hash) ? (hash as Role) : null;
}

type HomeCardProps = {
  role: Role;
  title: string;
  label: string;
  description: string;
  status: string;
  icon: LucideIcon;
  operations?: boolean;
  open: (role: Role) => void;
};

function HomeCard({
  role,
  title,
  label,
  description,
  status,
  icon: Icon,
  operations = false,
  open,
}: HomeCardProps) {
  return (
    <article
      className={`home-role-card ${operations ? "home-role-card-operations" : ""}`}
    >
      <div className="home-card-topline">
        <span
          className={`home-card-icon home-card-icon-${role}`}
          aria-hidden="true"
        >
          <Icon size={20} strokeWidth={1.8} />
        </span>
        <span className="eyebrow">{label}</span>
      </div>
      <h2>{title}</h2>
      <p className="home-card-description">{description}</p>
      <div className="home-card-footer">
        <p className="home-card-status">
          <span className="live-dot" /> {status}
        </p>
        <button
          className={`button ${operations ? "primary" : "secondary"} home-card-action`}
          aria-label={`Open ${title}`}
          onClick={() => open(role)}
        >
          Open <ArrowRight size={14} />
        </button>
      </div>
    </article>
  );
}

function HomeScreen({
  state,
  openRole,
}: {
  state: OperationsState;
  openRole: (role: Role) => void;
}) {
  const availableDonorUnits = state.batches.reduce((total, batch) => {
    if (batch.unavailable || batch.safeUntil <= state.now) return total;
    return total + Math.max(0, batchTotals(state, batch.id).available);
  }, 0);
  const onlineRiders = state.riders.filter((rider) => rider.online).length;
  const availableRiders = state.riders.filter(
    (rider) => rider.online && rider.available,
  ).length;
  const openReceivers = state.receivers.filter(
    (receiver) => receiver.isOpen,
  ).length;
  const outstandingDemand = state.receivers.reduce(
    (total, receiver) =>
      total +
      Object.values(receiver.demand).reduce((sum, value) => sum + value, 0),
    0,
  );
  const activeReservations = state.reservations.filter((reservation) =>
    ACTIVE_RESERVATIONS.includes(reservation.status),
  ).length;
  const activeShipments = state.shipments.filter(
    (shipment) =>
      shipment.quantity > shipment.deliveredQuantity &&
      shipment.status !== "EXPIRED",
  ).length;
  const attention =
    state.shipments.filter(
      (shipment) =>
        shipment.status === "RECOVERY_REQUIRED" ||
        shipment.status === "REROUTE_REQUIRED" ||
        shipment.status === "EXPIRED",
    ).length +
    state.reservations.filter(
      (reservation) => reservation.status === "WARNING_INACTIVE",
    ).length;

  return (
    <section className="home-screen" aria-labelledby="home-title">
      <header className="home-intro">
        <div>
          <div className="eyebrow">
            <span className="live-dot" /> LIVE RELAY{" "}
            <span className="eyebrow-divider">/</span> DEMO NETWORK
          </div>
          <h1 id="home-title" className="home-title">
            Choose the next good handoff
            <span className="heading-period">.</span>
          </h1>
          <p className="home-description">
            Four desks, one state-backed relay. Open the view that matches the
            work in front of you.
          </p>
        </div>
        <div className="home-snapshot" aria-label="Live snapshot">
          <span className="eyebrow">LIVE SNAPSHOT</span>
          <strong>{formatTime(state.now)} IST</strong>
          <span>Simulation time · snapshot {state.version}</span>
        </div>
      </header>
      <div className="home-role-grid">
        <HomeCard
          role="donor"
          title="Donor"
          label="SUPPLY DESK"
          description="Post what is ready, keep the safety window visible, and follow every unit to handoff."
          status={`${availableDonorUnits} units ready · ${state.donors.length} stations`}
          icon={PackagePlus}
          open={openRole}
        />
        <HomeCard
          role="rider"
          title="Rider"
          label="FIELD DESK"
          description="Accept a safe route, confirm physical custody, and keep the relay moving with progress updates."
          status={`${onlineRiders}/${state.riders.length} online · ${availableRiders} available`}
          icon={Bike}
          open={openRole}
        />
        <HomeCard
          role="receiver"
          title="Receiving Point"
          label="RECEIVING DESK"
          description="Keep demand, storage, opening status, and receiving facilities honest for every arrival."
          status={`${openReceivers}/${state.receivers.length} open · ${outstandingDemand} units requested`}
          icon={Warehouse}
          open={openRole}
        />
        <HomeCard
          role="operations"
          title="Operations Centre"
          label="CONTROL DESK"
          description="Dispatch, pressure-test constraints, and inspect the live custody trail across the network."
          status={`${activeReservations + activeShipments} active relays · ${attention} need attention`}
          icon={LayoutDashboard}
          operations
          open={openRole}
        />
      </div>
      <div className="home-note">
        <ShieldCheck size={16} />
        <span>Every card reads from the shared simulation state.</span>
      </div>
    </section>
  );
}

function isKnownStaticHost(): boolean {
  const hostname = globalThis.location?.hostname ?? "";
  return hostname === "vercel.app" || hostname.endsWith(".vercel.app");
}

function RoleNavigation({
  active,
  open,
}: {
  active: AppRoute;
  open: (role: Role) => void;
}) {
  return (
    <nav className="topbar-role-nav" aria-label="Role consoles">
      {roles.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          aria-label={`Open ${item.label}`}
          aria-current={active === item.id ? "page" : undefined}
          onClick={(event) => {
            event.preventDefault();
            open(item.id);
          }}
        >
          {item.id === "operations"
            ? "Ops"
            : item.id === "receiver"
              ? "Receiver"
              : item.label.split(" ")[0]}
        </a>
      ))}
    </nav>
  );
}

function DemoMenu({
  openGuide,
  localDemo,
  memoryOnlyDemo,
  connected,
}: {
  openGuide: () => void;
  localDemo: boolean;
  memoryOnlyDemo: boolean;
  connected: boolean;
}) {
  return (
    <details className="demo-menu">
      <summary className="button small secondary demo-menu-trigger">
        <Command size={13} /> Demo <ChevronDown size={13} />
      </summary>
      <div className="demo-menu-popover">
        <button className="demo-menu-item" onClick={openGuide}>
          <BookOpen size={15} />
          <span>
            <strong>Judge’s field guide</strong>
            <small>Run the five-minute relay demo.</small>
          </span>
        </button>
        <div className="demo-menu-status">
          <span className={`live-dot ${connected ? "" : "offline"}`} />
          {localDemo
            ? memoryOnlyDemo
              ? "Memory-only preview"
              : "Browser-local preview"
            : connected
              ? "Shared state connected"
              : "Reconnecting"}
        </div>
      </div>
    </details>
  );
}

export default function App() {
  const [state, setState] = useState<OperationsState | null>(null);
  const [role, setRole] = useState<AppRoute>(routeFromHash);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [localDemo, setLocalDemo] = useState(false);
  const [demoPersistence, setDemoPersistence] =
    useState<BrowserDemoPersistence>("persisted");
  const demoRef = useRef(false);
  const serverSeen = useRef(false);
  const bootIdRef = useRef<string | null>(null);
  const refreshInFlight = useRef(false);
  const [toast, setToast] = useState<{
    ok: boolean;
    code: string;
    message: string;
  } | null>(null);
  const [guide, setGuide] = useState(false);
  const [reset, setReset] = useState(false);
  const [loadError, setLoadError] = useState("");
  const merge = useCallback(
    (incoming: OperationsState, force = false) =>
      setState((current) =>
        !current || force || incoming.version >= current.version
          ? incoming
          : current,
      ),
    [],
  );
  const enterBrowserDemo = useCallback(() => {
    merge(readBrowserState(), true);
    demoRef.current = true;
    setLocalDemo(true);
    setDemoPersistence(getBrowserDemoStatus().mode);
    setConnected(true);
    setLoadError("");
  }, [merge]);
  const refresh = useCallback(async (): Promise<boolean> => {
    if (refreshInFlight.current) return true;
    refreshInFlight.current = true;
    try {
      if (demoRef.current) {
        merge(readBrowserState());
        setDemoPersistence(getBrowserDemoStatus().mode);
        setConnected(true);
        return true;
      }
      const response = await fetch("/api/state", {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok)
        throw new Error("The operations server is not responding.");
      const incomingBootId = response.headers.get("X-RelaySafe-Boot-Id");
      const serverReset =
        !!incomingBootId &&
        !!bootIdRef.current &&
        incomingBootId !== bootIdRef.current;
      if (incomingBootId) bootIdRef.current = incomingBootId;
      merge((await response.json()) as OperationsState, serverReset);
      serverSeen.current = true;
      setConnected(true);
      setLoadError("");
      if (serverReset) {
        setToast({
          ok: false,
          code: "SERVER_RESET",
          message:
            "The shared server restarted and reset the demo to its seed state.",
        });
      }
      return true;
    } catch {
      // A known static host has no Express API. Any other host stays read-only
      // until the shared server responds, including during a Render cold start.
      if (!serverSeen.current && isKnownStaticHost()) {
        try {
          enterBrowserDemo();
          return true;
        } catch {
          /* Keep an explicit failure if browser storage is unavailable. */
        }
      }
      setConnected(false);
      setLoadError(
        "Waking up the shared operations server. Your last snapshot is read-only; do not assume a command completed.",
      );
      return false;
    } finally {
      refreshInFlight.current = false;
    }
  }, [enterBrowserDemo, merge]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const poll = async () => {
      const ok = await refresh();
      if (stopped) return;
      failures = ok ? 0 : failures + 1;
      const delay = ok
        ? 1800
        : Math.min(30000, 1800 * 2 ** Math.min(failures - 1, 4));
      if (!ok)
        setLoadError(
          `Waking up the shared operations server. Automatic retry in ${Math.ceil(delay / 1000)} seconds. Your last snapshot is read-only; do not assume a command completed.`,
        );
      timer = setTimeout(() => void poll(), delay);
    };
    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (!toast || !toast.ok) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const listener = () => {
      setRole(routeFromHash());
    };
    addEventListener("hashchange", listener);
    return () => removeEventListener("hashchange", listener);
  }, []);

  const act = useCallback(
    async (action: Action) => {
      if (busyRef.current) throw new Error("Another command is in progress.");
      if (!demoRef.current && !connected) {
        const unavailable = new Error(
          "The shared operations server is unavailable; this view is read-only.",
        );
        unavailable.name = "ConnectionUnavailable";
        setToast({
          ok: false,
          code: "SERVER_UNAVAILABLE",
          message: unavailable.message,
        });
        throw unavailable;
      }
      busyRef.current = true;
      setBusy(true);
      try {
        let result: ActionResult;
        let serverReset = false;
        if (demoRef.current) {
          result = await browserAction(action);
          setDemoPersistence(getBrowserDemoStatus().mode);
        } else {
          const response = await fetch("/api/actions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key":
                globalThis.crypto?.randomUUID?.() ??
                `command-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            },
            body: JSON.stringify(action),
            signal: AbortSignal.timeout(15000),
          });
          const incomingBootId = response.headers.get("X-RelaySafe-Boot-Id");
          serverReset =
            !!incomingBootId &&
            !!bootIdRef.current &&
            incomingBootId !== bootIdRef.current;
          if (incomingBootId) bootIdRef.current = incomingBootId;
          result = (await response.json()) as ActionResult;
          serverSeen.current = true;
          setConnected(true);
          if (result.state) merge(result.state, serverReset);
        }
        setToast(
          serverReset
            ? {
                ok: false,
                code: "SERVER_RESET",
                message:
                  "The shared server restarted; this confirmed action was applied to the new seed state.",
              }
            : { ok: result.ok, code: result.code, message: result.message },
        );
        if (!result.ok) {
          const rejection = new Error(result.message);
          rejection.name = "ActionRejected";
          throw rejection;
        }
        setConnected(true);
      } catch (error) {
        if (!(error instanceof Error) || error.name !== "ActionRejected") {
          setToast({
            ok: false,
            code: "CONNECTION_UNCERTAIN",
            message:
              "Connection interrupted. The command may have reached the server. Refresh and inspect the timeline before repeating it.",
          });
          void refresh();
        }
        throw error;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [connected, merge, refresh],
  );
  const changeRole = (value: Role) => {
    setRole(value);
    location.hash = value;
    window.scrollTo({ top: 0 });
  };
  const goHome = () => {
    setRole(null);
    if (location.hash)
      history.pushState({}, "", `${location.pathname}${location.search}`);
    window.scrollTo({ top: 0 });
  };
  const exportTimeline = () => {
    if (!state) return;
    const blob = new Blob(
      [
        JSON.stringify(
          { exportedAt: new Date().toISOString(), ...state },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `relaysafe-audit-v${state.version}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const memoryOnlyDemo = localDemo && demoPersistence === "memory-only";

  const isHome = role === null;

  useHomeSmoothScroll(isHome);

  return (
    <div className={`app-shell ${isHome ? "home-shell" : ""}`}>
      <main className="main-content" id="main">
        <header className={`topbar ${isHome ? "home-topbar" : ""}`}>
          <a
            className="brand topbar-brand"
            href="/"
            aria-label="RelaySafe home"
            onClick={(event) => {
              event.preventDefault();
              goHome();
            }}
          >
            <span className="brand-mark">
              <HeartHandshake size={20} strokeWidth={1.8} />
            </span>
            <span>
              Relay<span>Safe</span>
            </span>
          </a>
          <div className="topbar-navigation">
            <RoleNavigation active={role} open={changeRole} />
            <div className="topbar-right">
              <span className="clock-display">
                <Clock3 size={14} />
                {state ? formatTime(state.now) : "—"}{" "}
                <small>IST · simulated</small>
              </span>
              <button
                className="button small secondary reset-button"
                disabled={busy || !state}
                onClick={() => setReset(true)}
              >
                <RotateCcw size={12} />
                Reset
              </button>
              <DemoMenu
                openGuide={() => setGuide(true)}
                localDemo={localDemo}
                memoryOnlyDemo={memoryOnlyDemo}
                connected={connected}
              />
            </div>
          </div>
        </header>
        {localDemo && (
          <div className="connection-banner" role="status">
            <ShieldCheck size={15} />
            {memoryOnlyDemo
              ? "Memory-only demo mode · browser storage is unavailable, so changes last until this tab reloads."
              : "Static demo mode · actions use the same safety engine and save in this browser. No shared server or cross-device sync."}
          </div>
        )}
        {loadError && state && (
          <div className="connection-banner" role="alert">
            <Radio size={15} />
            {loadError}
            <button
              className="button text-button small"
              onClick={() => void refresh()}
            >
              Refresh
            </button>
            {!localDemo && !serverSeen.current && (
              <button
                className="button secondary small"
                onClick={enterBrowserDemo}
              >
                Use browser-local demo
              </button>
            )}
          </div>
        )}
        <div className={`page-content ${isHome ? "home-page-content" : ""}`}>
          {state ? (
            isHome ? (
              <HomeScreen state={state} openRole={changeRole} />
            ) : (
              <>
                {role === "operations" && (
                  <OperationsDashboard
                    state={state}
                    act={act}
                    busy={busy || !connected}
                    exportTimeline={exportTimeline}
                  />
                )}
                {role === "donor" && (
                  <DonorConsole
                    state={state}
                    act={act}
                    busy={busy || !connected}
                  />
                )}
                {role === "rider" && (
                  <RiderConsole
                    state={state}
                    act={act}
                    busy={busy || !connected}
                  />
                )}
                {role === "receiver" && (
                  <ReceiverConsole
                    state={state}
                    act={act}
                    busy={busy || !connected}
                  />
                )}
              </>
            )
          ) : (
            <div className="app-loading">
              <ShieldCheck size={36} />
              <h1>
                {loadError
                  ? "The relay is waiting."
                  : "Connecting the evening relay…"}
              </h1>
              <p>{loadError || "Loading your shared operations state."}</p>
              {loadError && (
                <div className="dialog-actions">
                  <button
                    className="button primary"
                    onClick={() => void refresh()}
                  >
                    Try again
                  </button>
                  {!serverSeen.current && !localDemo && (
                    <button
                      className="button secondary"
                      onClick={enterBrowserDemo}
                    >
                      Use browser-local demo
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          <footer className="app-footer">
            <span>
              <ShieldCheck size={13} /> Safety by rules. Recovery by design.
            </span>
            <span>
              RelaySafe / prototype ·{" "}
              {state ? `snapshot ${state.version}` : "connecting"}
            </span>
          </footer>
        </div>
      </main>
      {toast && (
        <div
          className={`toast app-toast ${toast.ok ? "toast-success" : "toast-error"}`}
          role={toast.ok ? "status" : "alert"}
        >
          <span className="toast-symbol">
            {toast.ok ? <Check size={19} /> : <ShieldCheck size={19} />}
          </span>
          <div>
            <strong>
              {toast.ok ? "Decision confirmed" : "Safety decision"}{" "}
              <code>{toast.code}</code>
            </strong>
            <p>{toast.message}</p>
          </div>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {reset && (
        <div className="dialog-backdrop" onClick={() => setReset(false)}>
          <section
            className="app-dialog reset-dialog"
            data-lenis-prevent
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-title"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="eyebrow">A FRESH EVENING</span>
            <h2 id="reset-title">Reset the demo network?</h2>
            <p>
              This restores seeded batches, riders, and receivers at 21:00. It
              affects every connected role. Previous decisions stay in the audit
              history.
            </p>
            <div className="dialog-actions">
              <button
                className="button secondary"
                onClick={() => setReset(false)}
              >
                Keep this relay
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => {
                  void act({ type: "RESET" })
                    .then(() => setReset(false))
                    .catch(() => {});
                }}
              >
                Reset network
              </button>
            </div>
          </section>
        </div>
      )}
      {guide && <FieldGuide close={() => setGuide(false)} />}
    </div>
  );
}

function FieldGuide({ close }: { close: () => void }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    addEventListener("keydown", handler);
    return () => removeEventListener("keydown", handler);
  }, [close]);
  return (
    <div className="dialog-backdrop" onClick={close}>
      <section
        className="app-dialog field-guide"
        data-lenis-prevent
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="dialog-close"
          onClick={close}
          aria-label="Close field guide"
        >
          <X size={20} />
        </button>
        <span className="eyebrow">
          <Command size={13} /> THE JUDGE’S FIELD GUIDE
        </span>
        <h2 id="guide-title">
          Break the plan.
          <br />
          Watch the relay recover.
        </h2>
        <p className="guide-intro">
          This is not a donation directory. It is a deterministic dispatch and
          custody system. Every button uses the same safety engine.
        </p>
        <ol className="guide-steps">
          <li>
            <strong>Split the surplus.</strong>
            <p>
              Auto-dispatch the seeded 180 meals. Each rider carries at most 40,
              across receivers needing 50, 80, and 50. Every unit is accounted
              for.
            </p>
          </li>
          <li>
            <strong>Let a reservation go stale.</strong>
            <p>
              Advance 3 minutes without rider progress: a warning appears.
              Advance to minute 5: leases time out and unpicked units are
              released. Bring the offline reserve rider online and available to
              reassign.
            </p>
          </li>
          <li>
            <strong>Move physical custody.</strong>
            <p>
              Reset. Accept one job → start pickup → advance its pickup ETA (2–4
              minutes) → confirm arrival → confirm pickup. Use a smaller
              quantity to prove partial handoff accounting.
            </p>
          </li>
          <li>
            <strong>Close the destination.</strong>
            <p>
              Target that shipment’s receiver in the workbench and close it. The
              shipment reroutes to a safe compatible fallback, or explicitly
              enters recovery. Collected units never return to donor stock.
            </p>
          </li>
          <li>
            <strong>Finish with proof.</strong>
            <p>
              Advance in small steps and send a shipment heartbeat before 7
              minutes of silence. Confirm delivery after ETA. Inspect or export
              the decision trail.
            </p>
          </li>
        </ol>
        <div className="guide-extra">
          <ShieldCheck size={22} />
          <p>
            <strong>Try the hard cases.</strong> Raw rations without cooking
            fuel, a 15-minute expiry, reduced demand, rider failure after
            pickup, duplicate pickup, partial receipt, and no safe fallback.
          </p>
        </div>
        <p className="guide-disclaimer">
          Simulation only. Rule checks are logistics constraints, not
          food-safety or medical certification. No GPS, real traffic, AI
          decisions, or public authentication.
        </p>
        <button className="button primary" onClick={close}>
          Open the dispatch desk <ArrowRight size={15} />
        </button>
      </section>
    </div>
  );
}
