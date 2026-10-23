import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Bike,
  BookOpen,
  Check,
  Clock3,
  Command,
  HeartHandshake,
  LayoutDashboard,
  PackagePlus,
  Radio,
  RotateCcw,
  ShieldCheck,
  Warehouse,
  X,
} from "lucide-react";
import OperationsDashboard from "./components/OperationsDashboard";
import {
  DonorConsole,
  ReceiverConsole,
  RiderConsole,
} from "./components/RoleConsoles";
import {
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

export default function App() {
  const [state, setState] = useState<OperationsState | null>(null);
  const [role, setRole] = useState<Role>(() =>
    roles.some((r) => r.id === location.hash.slice(1))
      ? (location.hash.slice(1) as Role)
      : "operations",
  );
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState<{
    ok: boolean;
    code: string;
    message: string;
  } | null>(null);
  const [guide, setGuide] = useState(false);
  const [reset, setReset] = useState(false);
  const [loadError, setLoadError] = useState("");
  const merge = useCallback(
    (incoming: OperationsState) =>
      setState((current) =>
        !current || incoming.version >= current.version ? incoming : current,
      ),
    [],
  );
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/state", {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok)
        throw new Error("The operations server is not responding.");
      merge((await response.json()) as OperationsState);
      setConnected(true);
      setLoadError("");
    } catch {
      setConnected(false);
      setLoadError(
        "Unable to reach the shared operations server. Your last snapshot is preserved; do not assume a command completed.",
      );
    }
  }, [merge]);
  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 1800);
    return () => clearInterval(interval);
  }, [refresh]);
  useEffect(() => {
    if (!toast || !toast.ok) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const listener = () => {
      const match = roles.find((r) => r.id === location.hash.slice(1));
      if (match) setRole(match.id);
    };
    addEventListener("hashchange", listener);
    return () => removeEventListener("hashchange", listener);
  }, []);

  const act = useCallback(
    async (action: Action) => {
      if (busyRef.current) throw new Error("Another command is in progress.");
      busyRef.current = true;
      setBusy(true);
      try {
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
        const result = (await response.json()) as ActionResult;
        if (result.state) merge(result.state);
        setToast({ ok: result.ok, code: result.code, message: result.message });
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
    [merge, refresh],
  );
  const changeRole = (value: Role) => {
    setRole(value);
    location.hash = value;
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
  const exceptions =
    state?.shipments.filter(
      (s) => s.status === "RECOVERY_REQUIRED" || s.status === "EXPIRED",
    ).length ?? 0;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#operations"
          aria-label="RelaySafe operations"
          onClick={() => changeRole("operations")}
        >
          <span className="brand-mark">
            <HeartHandshake size={22} strokeWidth={1.8} />
          </span>
          <span>
            Relay<span>Safe</span>
          </span>
        </a>
        <p className="sidebar-label">THE EVENING RELAY</p>
        <nav aria-label="Role views">
          {roles.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${role === item.id ? "active" : ""}`}
              aria-current={role === item.id ? "page" : undefined}
              onClick={() => changeRole(item.id)}
            >
              <item.icon size={17} />
              {item.label}
              {item.id === "operations" && exceptions > 0 && (
                <span className="nav-count">{exceptions}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <button className="nav-item" onClick={() => setGuide(true)}>
          <BookOpen size={17} />
          Judge’s field guide
          <ArrowRight size={13} style={{ marginLeft: "auto" }} />
        </button>
        <button className="nav-item" onClick={exportTimeline} disabled={!state}>
          <ArrowDownToLine size={17} />
          Export decision trail
        </button>
        <div className="sidebar-footer">
          <div className="sidebar-status">
            <strong>
              <span className={`live-dot ${connected ? "" : "offline"}`} />{" "}
              {connected ? "Shared state connected" : "Reconnecting"}
            </strong>
            One network. Every role in sync.
          </div>
          <p>
            Keep good moving.
            <br />
            Keep every handoff accountable.
          </p>
          <div className="sidebar-user">
            <span className="avatar">RS</span>
            <div>
              <strong>Bengaluru pilot</strong>
              <p>Local simulation · no login</p>
            </div>
          </div>
        </div>
      </aside>
      <main className="main-content" id="main">
        <header className="topbar">
          <div className="topbar-left">
            <span className="workspace-name">Bengaluru relief network</span>
            <span className="topbar-separator">/</span>
            <span>{roles.find((r) => r.id === role)?.label}</span>
          </div>
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
              Reset demo
            </button>
          </div>
        </header>
        {loadError && state && (
          <div className="connection-banner" role="alert">
            <Radio size={15} />
            {loadError}
            <button onClick={() => void refresh()}>Refresh</button>
          </div>
        )}
        <div className="page-content">
          {state ? (
            <>
              {role === "operations" && (
                <OperationsDashboard
                  state={state}
                  act={act}
                  busy={busy || !connected}
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
                <button
                  className="button primary"
                  onClick={() => void refresh()}
                >
                  Try again
                </button>
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
