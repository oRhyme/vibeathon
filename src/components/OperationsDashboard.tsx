import { useState } from "react";
import {
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleHelp,
  Clock3,
  FlaskConical,
  MapPin,
  Package,
  Radio,
  Route,
  ShieldCheck,
  Sparkles,
  Truck,
  Zap,
} from "lucide-react";
import {
  ACTIVE_RESERVATIONS,
  AID_LABELS,
  batchTotals,
  formatTime,
  type Action,
  type ConsoleProps,
  type Location,
  type Reservation,
} from "../domain/types";

const statusLabel = (value: string) => value.toLowerCase().replaceAll("_", " ");
const shortName = (name: string) => name.split(" · ")[0];
const count = (value: number) => value.toLocaleString();

export default function OperationsDashboard({
  state,
  act,
  busy,
  exportTimeline,
}: ConsoleProps & { exportTimeline?: () => void }) {
  const [batchId, setBatchId] = useState("");
  const [riderId, setRiderId] = useState("");
  const [receiverId, setReceiverId] = useState("");
  const [reservationId, setReservationId] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [recoveryRiders, setRecoveryRiders] = useState<Record<string, string>>(
    {},
  );
  const [allocationQuantity, setAllocationQuantity] = useState("20");
  const [receiverDemand, setReceiverDemand] = useState("10");
  const [eventFilter, setEventFilter] = useState("ALL");
  const targetBatch =
    state.batches.find((b) => b.id === batchId) ?? state.batches[0];
  const targetRider =
    state.riders.find((r) => r.id === riderId) ?? state.riders[0];
  const targetReceiver =
    state.receivers.find((r) => r.id === receiverId) ?? state.receivers[0];
  const activeReservations = state.reservations.filter((r) =>
    ACTIVE_RESERVATIONS.includes(r.status),
  );
  const targetReservation =
    activeReservations.find((r) => r.id === reservationId) ??
    activeReservations[0];
  const onlineRiders = state.riders.filter((r) => r.online);
  const openReceivers = state.receivers.filter((r) => r.isOpen);
  const available = state.batches.reduce(
    (n, b) =>
      n +
      (!b.unavailable && b.safeUntil > state.now
        ? Math.max(0, batchTotals(state, b.id).available)
        : 0),
    0,
  );
  const reserved = activeReservations.reduce((n, r) => n + r.quantity, 0);
  const inTransit = state.shipments
    .filter(
      (s) =>
        s.status === "IN_TRANSIT" ||
        s.status === "REROUTE_REQUIRED" ||
        s.status === "RECOVERY_REQUIRED",
    )
    .reduce((n, s) => n + s.quantity - s.deliveredQuantity, 0);
  const delivered = state.shipments.reduce(
    (n, s) => n + s.deliveredQuantity,
    0,
  );
  const attention =
    state.shipments.filter(
      (s) =>
        s.status === "RECOVERY_REQUIRED" ||
        s.status === "REROUTE_REQUIRED" ||
        s.status === "EXPIRED",
    ).length +
    activeReservations.filter((r) => r.status === "WARNING_INACTIVE").length;
  const queue = [...state.batches].sort(
    (a, b) =>
      Number(a.unavailable) - Number(b.unavailable) ||
      a.safeUntil - b.safeUntil,
  );
  const events = [...state.events]
    .reverse()
    .filter((e) => eventFilter === "ALL" || e.severity === eventFilter);
  const send = async (action: Action) => {
    try {
      await act(action);
    } catch {
      /* The shared app toast explains rejected commands. */
    }
  };
  const quantityFor = (id: string, fallback: number) =>
    Number(quantities[id] ?? fallback);
  const quantityInput = (id: string, fallback: number, label: string) => (
    <input
      className="input quantity-input"
      aria-label={label}
      type="number"
      min="1"
      step="1"
      value={quantities[id] ?? fallback}
      disabled={busy}
      onChange={(e) => setQuantities((q) => ({ ...q, [id]: e.target.value }))}
    />
  );
  const mapPoint = (location: Location) => ({
    x: 65 + (location.x + 8) * 23,
    y: 82 + (location.y + 6) * 16,
  });
  const routePath = (from: Location, to: Location, offset = 0) => {
    const a = mapPoint(from),
      b = mapPoint(to);
    return `M ${a.x} ${a.y} C ${a.x + 70} ${a.y - 70 - offset}, ${b.x - 60} ${b.y + 60 + offset}, ${b.x} ${b.y}`;
  };
  const phaseHint = (reservation: Reservation) => {
    if (reservation.status === "ASSIGNED") return "Awaiting rider acceptance";
    if (reservation.status === "ACKNOWLEDGED")
      return `Start the ${reservation.pickupEta}-minute pickup trip`;
    if (reservation.status === "EN_ROUTE_TO_DONOR")
      return `Advance the clock for travel, then confirm arrival (${reservation.pickupEta} min trip)`;
    if (reservation.status === "ARRIVED_AT_DONOR")
      return "Count physical units; partial pickup releases the remainder";
    if (reservation.status === "WARNING_INACTIVE")
      return "Send a heartbeat to restore the current pickup phase";
    return `Pickup deadline ${formatTime(reservation.pickupDeadline)}`;
  };

  return (
    <div className="operations-dashboard">
      <header className="dashboard-heading">
        <div>
          <div className="eyebrow">
            <span className="live-dot" /> LIVE OPERATIONS{" "}
            <span className="eyebrow-divider">/</span> DEMO NETWORK
          </div>
          <h1 className="page-heading">
            Every relay counts<span className="heading-period">.</span>
          </h1>
          <p className="page-description">
            Good food. The right hands. Before the window closes.
          </p>
        </div>
        <div className="dashboard-heading-actions">
          <div
            className="dashboard-heading-glance"
            aria-label="Network snapshot"
          >
            <span>NETWORK SNAPSHOT</span>
            <strong>{formatTime(state.now)} IST</strong>
            <small>
              {activeReservations.length} live reservations ·{" "}
              {openReceivers.length} receiving points open
            </small>
          </div>
          <button
            className="button primary dispatch-button"
            disabled={busy}
            onClick={() => void send({ type: "AUTO_DISPATCH" })}
          >
            <Zap size={16} fill="currentColor" /> Auto-dispatch network{" "}
            <ArrowUpRight size={17} />
          </button>
        </div>
      </header>

      <section className="operations-metrics" aria-label="Live network totals">
        <div className="metric">
          <div className="metric-label">
            <Package size={14} /> Available at donor
          </div>
          <div className="metric-value">
            {count(available)}
            <span>units</span>
          </div>
          <div className="metric-detail">
            {count(reserved)} reserved for pickup
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">
            <Truck size={14} /> In transit
          </div>
          <div className="metric-value">
            {count(inTransit)}
            <span>units</span>
          </div>
          <div className="metric-detail">Units currently in custody</div>
        </div>
        <div className="metric">
          <div className="metric-label">
            <Check size={14} /> Delivered safely
          </div>
          <div className="metric-value">
            {count(delivered)}
            <span>units</span>
          </div>
          <div className="metric-detail">Receipt-confirmed deliveries</div>
        </div>
        <div className={`metric ${attention ? "metric-alert" : ""}`}>
          <div className="metric-label">
            <Radio size={14} /> Needs attention
          </div>
          <div className="metric-value">
            {count(attention)}
            <span>relays</span>
          </div>
          <div className="metric-detail">
            {attention
              ? "Review exceptions in the ledger"
              : "No open custody exceptions"}
          </div>
        </div>
      </section>

      <section className="network-section">
        <div className="network-map-wrap">
          <div className="section-heading map-heading">
            <div>
              <span className="eyebrow">THE BIG PICTURE</span>
              <h2>Your city, connected.</h2>
            </div>
            <span className="map-location">
              <MapPin size={13} /> Bengaluru
            </span>
          </div>
          <div className="network-map">
            <svg
              className="network-svg"
              viewBox="0 0 720 405"
              role="img"
              aria-label={`Simulated locality network with ${state.donors.length} donors, ${openReceivers.length} open receivers and ${onlineRiders.length} online riders. Not GPS.`}
            >
              <defs>
                <pattern
                  id="street-grid"
                  width="46"
                  height="38"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(-18)"
                >
                  <path
                    d="M 46 0 L 0 0 0 38"
                    fill="none"
                    stroke="#d9ded1"
                    strokeWidth=".8"
                  />
                </pattern>
                <pattern
                  id="minor-grid"
                  width="23"
                  height="19"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(-18)"
                >
                  <path
                    d="M 23 0 L 0 0 0 19"
                    fill="none"
                    stroke="#e5e8df"
                    strokeWidth=".5"
                  />
                </pattern>
              </defs>
              <rect width="720" height="405" fill="#edf0e7" />
              <rect width="720" height="405" fill="url(#minor-grid)" />
              <rect width="720" height="405" fill="url(#street-grid)" />
              <path
                d="M 390 -30 C 330 40 420 66 430 130 S 365 240 470 298 S 510 350 520 440"
                fill="none"
                stroke="#d8e3db"
                strokeWidth="25"
              />
              <path
                d="M 390 -30 C 330 40 420 66 430 130 S 365 240 470 298 S 510 350 520 440"
                fill="none"
                stroke="#f6f7ef"
                strokeWidth="2"
              />
              <path
                d="M-20 280 Q 160 225 330 250 T 760 150 M70 -20 Q 140 115 320 160 T 730 235"
                stroke="#f9faf4"
                strokeWidth="11"
                fill="none"
              />
              <path
                d="M-20 280 Q 160 225 330 250 T 760 150 M70 -20 Q 140 115 320 160 T 730 235"
                stroke="#d7dccc"
                strokeWidth="1"
                fill="none"
              />
              <text x="56" y="65" className="map-district">
                CENTRAL DISTRICT
              </text>
              <text x="498" y="355" className="map-district">
                EAST BENGALURU
              </text>
              <text
                x="470"
                y="92"
                className="map-water-label"
                transform="rotate(16 470 92)"
              >
                Ulsoor catchment
              </text>
              {state.donors[0] &&
                state.receivers.map((receiver) => (
                  <path
                    key={`network-${receiver.id}`}
                    d={routePath(state.donors[0].location, receiver.location)}
                    fill="none"
                    stroke="#a9b7a5"
                    strokeWidth="1.3"
                    strokeDasharray="3 7"
                    opacity=".65"
                  />
                ))}
              {activeReservations.map((reservation, i) => {
                const batch = state.batches.find(
                    (b) => b.id === reservation.batchId,
                  ),
                  receiver = state.receivers.find(
                    (r) => r.id === reservation.receiverId,
                  ),
                  donor = state.donors.find((d) => d.id === batch?.donorId);
                return donor && receiver ? (
                  <path
                    key={reservation.id}
                    d={routePath(
                      donor.location,
                      receiver.location,
                      (i % 3) * 12,
                    )}
                    fill="none"
                    stroke="#3c7152"
                    strokeWidth="2.5"
                    strokeDasharray="6 5"
                    opacity=".8"
                  >
                    <title>{`${reservation.quantity} units reserved · ${statusLabel(reservation.status)}`}</title>
                  </path>
                ) : null;
              })}
              {state.shipments
                .filter(
                  (s) => s.status !== "DELIVERED" && s.status !== "EXPIRED",
                )
                .map((shipment, i) => {
                  const rider = state.riders.find(
                      (r) => r.id === shipment.riderId,
                    ),
                    receiver = state.receivers.find(
                      (r) => r.id === shipment.receiverId,
                    );
                  return rider && receiver ? (
                    <path
                      key={shipment.id}
                      d={routePath(
                        rider.location,
                        receiver.location,
                        (i % 3) * 10,
                      )}
                      fill="none"
                      stroke={
                        shipment.status === "IN_TRANSIT" ? "#173f38" : "#b86c35"
                      }
                      strokeWidth="3"
                      strokeDasharray="8 4"
                    >
                      <title>{`${shipment.quantity - shipment.deliveredQuantity} units · ${statusLabel(shipment.status)}`}</title>
                    </path>
                  ) : null;
                })}
              {state.receivers.map((receiver, i) => {
                const p = mapPoint(receiver.location);
                const incoming =
                  activeReservations
                    .filter((r) => r.receiverId === receiver.id)
                    .reduce((n, r) => n + r.quantity, 0) +
                  state.shipments
                    .filter(
                      (s) =>
                        s.receiverId === receiver.id &&
                        s.status !== "DELIVERED" &&
                        s.status !== "EXPIRED",
                    )
                    .reduce((n, s) => n + s.quantity - s.deliveredQuantity, 0);
                return (
                  <g key={receiver.id}>
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r="15"
                      fill="#f7f8ef"
                      opacity=".8"
                    />
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r="7"
                      fill={receiver.isOpen ? "#173f38" : "#a46b53"}
                      stroke="#f7f8ef"
                      strokeWidth="3"
                    />
                    <text
                      x={p.x + (i === 2 ? -14 : 14)}
                      y={p.y + (i === 2 ? -30 : -10)}
                      textAnchor={i === 2 ? "end" : "start"}
                      className="map-node-label"
                    >
                      {receiver.location.label.split(" community")[0]}
                    </text>
                    <text
                      x={p.x + (i === 2 ? -14 : 14)}
                      y={p.y + (i === 2 ? -16 : 3)}
                      textAnchor={i === 2 ? "end" : "start"}
                      className="map-node-detail"
                    >
                      {receiver.isOpen
                        ? `${incoming} incoming · open`
                        : "Temporarily closed"}
                    </text>
                    <title>{receiver.name}</title>
                  </g>
                );
              })}
              {state.donors.map((donor, i) => {
                const p = mapPoint(donor.location);
                return (
                  <g key={donor.id}>
                    <rect
                      x={p.x - 10}
                      y={p.y - 10}
                      width="20"
                      height="20"
                      rx="5"
                      fill="#d4ef91"
                      stroke="#173f38"
                      strokeWidth="2"
                    />
                    <path
                      d={`M${p.x - 4} ${p.y}h8 M${p.x} ${p.y - 4}v8`}
                      stroke="#173f38"
                      strokeWidth="1.5"
                    />
                    <text
                      x={p.x + (i ? -16 : 15)}
                      y={p.y + (i ? 37 : -28)}
                      textAnchor={i ? "end" : "start"}
                      className="map-node-label"
                    >
                      {shortName(donor.name)}
                    </text>
                    <text
                      x={p.x + (i ? -16 : 15)}
                      y={p.y + (i ? 50 : -15)}
                      textAnchor={i ? "end" : "start"}
                      className="map-node-detail"
                    >
                      Donor station {String(i + 1).padStart(2, "0")}
                    </text>
                  </g>
                );
              })}
              {state.riders.map((rider, i) => {
                const p = mapPoint(rider.location);
                return (
                  <g key={rider.id}>
                    <circle
                      cx={p.x}
                      cy={p.y + (i === 5 ? 15 : 0)}
                      r="5"
                      fill={rider.online ? "#7a9c51" : "#b7bcb0"}
                      stroke="#f7f8ef"
                      strokeWidth="2"
                    />
                    <title>{`${rider.name}: ${rider.online ? "online" : "offline"} · ${rider.capacity} unit capacity`}</title>
                  </g>
                );
              })}
              <g transform="translate(660 28)">
                <path
                  d="M0 25V0m0 0-4 7m4-7 4 7"
                  stroke="#667362"
                  fill="none"
                />
                <text x="0" y="-7" textAnchor="middle" className="map-compass">
                  N
                </text>
              </g>
            </svg>
            <div className="network-live-panel">
              <div className="network-live-top">
                <span className="live-dot" /> THE NETWORK IS LIVE{" "}
                <Radio size={15} />
              </div>
              <div className="network-live-numbers">
                <div>
                  <strong>{state.donors.length}</strong>
                  <span>donors</span>
                </div>
                <div>
                  <strong>
                    {onlineRiders.length}
                    <small>/{state.riders.length}</small>
                  </strong>
                  <span>riders online</span>
                </div>
                <div>
                  <strong>{openReceivers.length}</strong>
                  <span>receiving points</span>
                </div>
              </div>
              <div className="network-live-bottom">
                <span>Simulated local time</span>
                <strong>
                  {formatTime(state.now)} <span>IST</span>
                </strong>
              </div>
            </div>
            <div className="map-legend">
              <span>
                <i className="legend-donor" /> Donor
              </span>
              <span>
                <i className="legend-receiver" /> Receiver
              </span>
              <span>
                <i className="legend-route" /> Relay
              </span>
            </div>
          </div>
          <div className="map-caption">
            <span>
              <CircleHelp size={12} /> Simulated network · not GPS
            </span>
            <span>Designed around safe arrival, not just distance.</span>
          </div>
        </div>

        <aside className="dispatch-queue" aria-label="Batch dispatch queue">
          <div className="section-heading">
            <div>
              <span className="eyebrow">EVERY MINUTE MATTERS</span>
              <h2>
                Dispatch queue{" "}
                <span className="count-pill">{queue.length}</span>
              </h2>
            </div>
            <Clock3 size={18} />
          </div>
          <div className="queue-list">
            {queue.length ? (
              queue.map((batch, i) => {
                const totals = batchTotals(state, batch.id),
                  donor = state.donors.find((d) => d.id === batch.donorId);
                const expired =
                  batch.unavailable || batch.safeUntil <= state.now;
                return (
                  <article
                    className={`queue-item ${expired ? "queue-item-expired" : ""}`}
                    key={batch.id}
                  >
                    <div className="queue-item-top">
                      <span className="queue-index">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span
                        className={`badge ${expired ? "danger" : batch.safeUntil - state.now <= 20 ? "warning" : "neutral"}`}
                      >
                        <Clock3 size={11} />
                        {expired
                          ? "Unavailable / expired"
                          : `${batch.safeUntil - state.now} min to expiry`}
                      </span>
                    </div>
                    <h3>{AID_LABELS[batch.aidType]}</h3>
                    <p className="queue-donor">
                      {donor?.name ?? batch.donorId}
                    </p>
                    <div className="stock-line">
                      <strong>
                        {count(batch.quantity)} <span>units donated</span>
                      </strong>
                      <span>{formatTime(batch.safeUntil)} cutoff</span>
                    </div>
                    <div
                      className="stock-bar"
                      aria-label={`${totals.available} available, ${totals.reserved} reserved, ${totals.pickedUp} picked up`}
                    >
                      <span
                        className="stock-picked"
                        style={{
                          width: `${batch.quantity ? (totals.pickedUp / batch.quantity) * 100 : 0}%`,
                        }}
                      />
                      <span
                        className="stock-reserved"
                        style={{
                          width: `${batch.quantity ? (totals.reserved / batch.quantity) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <div className="stock-breakdown">
                      <span>
                        <i className="stock-key available" />
                        {totals.available} available
                      </span>
                      <span>
                        <i className="stock-key reserved" />
                        {totals.reserved} reserved
                      </span>
                      <span>
                        <i className="stock-key picked" />
                        {totals.pickedUp} picked up
                      </span>
                    </div>
                    <button
                      className="queue-action"
                      disabled={busy || expired || totals.available <= 0}
                      onClick={() =>
                        void send({ type: "AUTO_DISPATCH", batchId: batch.id })
                      }
                    >
                      {expired
                        ? "Safety window closed"
                        : totals.available <= 0
                          ? "All units committed"
                          : "Find safe routes & split dispatch"}
                      <ArrowRight size={15} />
                    </button>
                  </article>
                );
              })
            ) : (
              <div className="empty-state">
                No batches yet. Add an urgent batch in the workbench.
              </div>
            )}
          </div>
          <div className="safety-note">
            <ShieldCheck size={21} />
            <div>
              <strong>Safety is the shortest route.</strong>
              <p>
                Every allocation checks capacity, receiving facilities and a
                3-minute arrival buffer.
              </p>
            </div>
          </div>
        </aside>
      </section>

      <section className="ledger-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">FROM PROMISE TO PROOF</span>
            <h2>
              The relay ledger{" "}
              <span className="count-pill">
                {activeReservations.length +
                  state.shipments.filter(
                    (s) => s.status !== "DELIVERED" && s.status !== "EXPIRED",
                  ).length}{" "}
                active
              </span>
            </h2>
          </div>
          <div className="section-heading-actions">
            <span className="section-note">
              <span className="live-dot" /> State-backed custody trail
            </span>
            <button
              className="button small secondary"
              disabled={!exportTimeline}
              onClick={exportTimeline}
            >
              <ArrowDownToLine size={13} /> Export log
            </button>
          </div>
        </div>
        <div className="flow-guide">
          <Route size={17} />
          <span>
            <strong>
              Reservation → acceptance → travel → arrival → pickup → delivery.
            </strong>{" "}
            Advance simulation time for travel. A heartbeat renews the lease; it
            never moves or picks up aid.
          </span>
        </div>
        {!state.reservations.length && !state.shipments.length ? (
          <div className="ledger-empty">
            <div className="ledger-empty-icon">
              <ArrowDownLeft size={25} />
            </div>
            <div>
              <h3>The next good thing starts here.</h3>
              <p>
                Auto-dispatch to create safe, capacity-aware allocations. Follow
                each rider’s progress here.
              </p>
            </div>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void send({ type: "AUTO_DISPATCH" })}
            >
              Start the first relay <ArrowRight size={15} />
            </button>
          </div>
        ) : (
          <div className="relay-ledger">
            {state.shipments.map((shipment) => {
              const batch = state.batches.find(
                  (b) => b.id === shipment.batchId,
                ),
                rider = state.riders.find((r) => r.id === shipment.riderId),
                receiver = state.receivers.find(
                  (r) => r.id === shipment.receiverId,
                );
              const remaining = shipment.quantity - shipment.deliveredQuantity;
              const recoveryRider =
                recoveryRiders[shipment.id] ??
                onlineRiders.find(
                  (r) => r.available && r.id !== shipment.riderId,
                )?.id ??
                "";
              return (
                <article className="ledger-row shipment-row" key={shipment.id}>
                  <div className="ledger-row-icon">
                    <Truck size={19} />
                  </div>
                  <div className="ledger-identity">
                    <div className="ledger-title">
                      {shortName(rider?.name ?? shipment.riderId)}{" "}
                      <ArrowRight size={12} />{" "}
                      {shortName(receiver?.name ?? shipment.receiverId)}
                    </div>
                    <div className="ledger-meta">
                      {shipment.id} ·{" "}
                      {batch ? AID_LABELS[batch.aidType] : shipment.batchId} ·{" "}
                      {shipment.quantity} picked up
                    </div>
                    <p className="ledger-hint">
                      {shipment.reason ??
                        (shipment.status === "DELIVERED"
                          ? `Receipt confirmed at ${formatTime(shipment.deliveredAt ?? state.now)}`
                          : `Arrival ${formatTime(shipment.eta)} · ${Math.max(0, shipment.eta - state.now)} min remaining`)}
                      {shipment.deliveredQuantity > 0 &&
                      shipment.status !== "DELIVERED"
                        ? ` · ${shipment.deliveredQuantity} already delivered`
                        : ""}
                    </p>
                  </div>
                  <span
                    className={`badge status-${shipment.status.toLowerCase()}`}
                  >
                    {statusLabel(shipment.status)}
                  </span>
                  <div className="ledger-actions">
                    {shipment.status === "IN_TRANSIT" && (
                      <>
                        <button
                          className="button small secondary"
                          disabled={busy}
                          onClick={() =>
                            void send({
                              type: "HEARTBEAT",
                              reservationId: shipment.reservationId,
                            })
                          }
                        >
                          <Radio size={12} />
                          Progress heartbeat
                        </button>
                        <button
                          className="button small secondary"
                          disabled={busy}
                          onClick={() =>
                            void send({
                              type: "REPORT_DELAY",
                              shipmentId: shipment.id,
                              minutes: 5,
                            })
                          }
                        >
                          Delay +5m
                        </button>
                        <label className="inline-quantity">
                          Units{" "}
                          {quantityInput(
                            shipment.id,
                            remaining,
                            `Delivery quantity for ${shipment.id}`,
                          )}
                        </label>
                        <button
                          className="button small primary"
                          disabled={busy || state.now < shipment.eta}
                          onClick={() =>
                            void send({
                              type: "DELIVER",
                              shipmentId: shipment.id,
                              quantity: quantityFor(shipment.id, remaining),
                            })
                          }
                        >
                          Confirm delivery
                        </button>
                      </>
                    )}
                    {shipment.status === "REROUTE_REQUIRED" && (
                      <button
                        className="button small primary"
                        disabled={busy}
                        onClick={() =>
                          void send({
                            type: "REROUTE",
                            shipmentId: shipment.id,
                          })
                        }
                      >
                        Find safe reroute
                      </button>
                    )}
                    {shipment.status === "RECOVERY_REQUIRED" &&
                      (shipment.recovery ? (
                        <>
                          <span className="ledger-hint">
                            Rendezvous{" "}
                            {formatTime(shipment.recovery.rendezvousAt)} ·
                            custody still with {rider?.name}
                          </span>
                          <button
                            className="button small primary"
                            disabled={
                              busy || state.now < shipment.recovery.rendezvousAt
                            }
                            onClick={() =>
                              void send({
                                type: "CONFIRM_RECOVERY",
                                shipmentId: shipment.id,
                              })
                            }
                          >
                            Verify physical recovery handoff
                          </button>
                        </>
                      ) : (
                        <>
                          <select
                            className="select recovery-select"
                            aria-label={`Recovery rider for ${shipment.id}`}
                            value={recoveryRider}
                            disabled={busy}
                            onChange={(e) =>
                              setRecoveryRiders((r) => ({
                                ...r,
                                [shipment.id]: e.target.value,
                              }))
                            }
                          >
                            <option value="">Select recovery rider</option>
                            {state.riders
                              .filter((r) => r.id !== shipment.riderId)
                              .map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.name} · {r.online ? "online" : "offline"}
                                </option>
                              ))}
                          </select>
                          <button
                            className="button small primary"
                            disabled={busy || !recoveryRider}
                            onClick={() =>
                              void send({
                                type: "RECOVER",
                                shipmentId: shipment.id,
                                riderId: recoveryRider,
                              })
                            }
                          >
                            Dispatch recovery
                          </button>
                        </>
                      ))}
                    {(shipment.status === "DELIVERED" ||
                      shipment.status === "EXPIRED") && (
                      <span className="ledger-complete">
                        {shipment.status === "DELIVERED" ? (
                          <>
                            <Check size={14} /> {shipment.deliveredQuantity}{" "}
                            units received
                          </>
                        ) : (
                          `${remaining} units retained in custody`
                        )}
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
            {[...state.reservations].reverse().map((reservation) => {
              const rider = state.riders.find(
                  (r) => r.id === reservation.riderId,
                ),
                receiver = state.receivers.find(
                  (r) => r.id === reservation.receiverId,
                );
              const active = ACTIVE_RESERVATIONS.includes(reservation.status);
              return (
                <article
                  className={`ledger-row ${active ? "" : "ledger-row-archived"}`}
                  key={reservation.id}
                >
                  <div className="ledger-row-icon">
                    <Package size={18} />
                  </div>
                  <div className="ledger-identity">
                    <div className="ledger-title">
                      {shortName(rider?.name ?? reservation.riderId)}{" "}
                      <ArrowRight size={12} />{" "}
                      {shortName(receiver?.name ?? reservation.receiverId)}
                    </div>
                    <div className="ledger-meta">
                      {reservation.id} · {reservation.quantity} units ·{" "}
                      {active
                        ? `lease until ${formatTime(reservation.leaseExpiresAt)}`
                        : "reservation record"}
                    </div>
                    {active && (
                      <p className="ledger-hint">{phaseHint(reservation)}</p>
                    )}
                  </div>
                  <span
                    className={`badge status-${reservation.status.toLowerCase()}`}
                  >
                    {statusLabel(reservation.status)}
                  </span>
                  <div className="ledger-actions">
                    {reservation.status === "ASSIGNED" && (
                      <button
                        className="button small primary"
                        disabled={busy}
                        onClick={() =>
                          void send({
                            type: "ACCEPT",
                            reservationId: reservation.id,
                          })
                        }
                      >
                        Accept assignment
                      </button>
                    )}
                    {reservation.status === "ACKNOWLEDGED" && (
                      <button
                        className="button small primary"
                        disabled={busy}
                        onClick={() =>
                          void send({
                            type: "START_PICKUP",
                            reservationId: reservation.id,
                          })
                        }
                      >
                        Start pickup trip
                      </button>
                    )}
                    {reservation.status === "EN_ROUTE_TO_DONOR" && (
                      <button
                        className="button small primary"
                        disabled={busy}
                        onClick={() =>
                          void send({
                            type: "ARRIVE",
                            reservationId: reservation.id,
                          })
                        }
                      >
                        Confirm donor arrival
                      </button>
                    )}
                    {reservation.status === "ARRIVED_AT_DONOR" && (
                      <>
                        <label className="inline-quantity">
                          Pickup units{" "}
                          {quantityInput(
                            reservation.id,
                            reservation.quantity,
                            `Pickup quantity for ${reservation.id}`,
                          )}
                        </label>
                        <button
                          className="button small primary"
                          disabled={busy}
                          onClick={() =>
                            void send({
                              type: "PICKUP",
                              reservationId: reservation.id,
                              quantity: quantityFor(
                                reservation.id,
                                reservation.quantity,
                              ),
                            })
                          }
                        >
                          Confirm physical pickup
                        </button>
                      </>
                    )}
                    {active && (
                      <button
                        className="button small secondary"
                        disabled={busy}
                        onClick={() =>
                          void send({
                            type: "HEARTBEAT",
                            reservationId: reservation.id,
                          })
                        }
                      >
                        <Radio size={12} /> Heartbeat
                      </button>
                    )}
                    {active && (
                      <button
                        className="button small text-button"
                        disabled={busy}
                        onClick={() =>
                          void send({
                            type: "DECLINE",
                            reservationId: reservation.id,
                          })
                        }
                      >
                        Release
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section
        className="simulation-workbench"
        aria-labelledby="workbench-title"
      >
        <div className="section-heading">
          <div>
            <span className="eyebrow">
              <FlaskConical size={12} /> PRESSURE-TEST THE PLAN
            </span>
            <h2 id="workbench-title">The simulation workbench</h2>
          </div>
          <span className="badge neutral">
            Deterministic · {formatTime(state.now)} IST
          </span>
        </div>
        <p className="workbench-description">
          Choose the exact entity, introduce a real constraint, then follow the
          decision trail below.
        </p>
        <div className="simulation-targets">
          <label className="field">
            Target batch
            <select
              className="select"
              value={targetBatch?.id ?? ""}
              disabled={busy}
              onChange={(e) => setBatchId(e.target.value)}
            >
              {state.batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.id} · {AID_LABELS[b.aidType]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Target rider
            <select
              className="select"
              value={targetRider?.id ?? ""}
              disabled={busy}
              onChange={(e) => setRiderId(e.target.value)}
            >
              {state.riders.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.online ? "online" : "offline"}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Target receiver
            <select
              className="select"
              value={targetReceiver?.id ?? ""}
              disabled={busy}
              onChange={(e) => setReceiverId(e.target.value)}
            >
              {state.receivers.map((r) => (
                <option key={r.id} value={r.id}>
                  {shortName(r.name)} · {r.isOpen ? "open" : "closed"}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Target reservation
            <select
              className="select"
              value={targetReservation?.id ?? ""}
              disabled={busy || !activeReservations.length}
              onChange={(e) => setReservationId(e.target.value)}
            >
              {!activeReservations.length && (
                <option value="">Dispatch to create one</option>
              )}
              {activeReservations.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id} · {r.quantity} units
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="workbench-grid">
          <div className="workbench-group">
            <h3>
              <span>01</span> Supply & allocation
            </h3>
            <p>New urgent meals use the selected batch’s donor.</p>
            <button
              className="button secondary"
              disabled={busy || !state.donors.length}
              onClick={() =>
                void send({
                  type: "CREATE_BATCH",
                  aidType: "COOKED_MEALS",
                  quantity: 100,
                  donorId: targetBatch?.donorId ?? state.donors[0].id,
                  readyIn: 0,
                  expiresIn: 15,
                  notes:
                    "Urgent simulation batch: 100 meals, 15-minute safety window.",
                })
              }
            >
              <Sparkles size={14} /> Add 100 meals · expires in 15m
            </button>
            <button
              className="button secondary"
              disabled={busy || !targetBatch}
              onClick={() =>
                targetBatch &&
                void send({ type: "AUTO_DISPATCH", batchId: targetBatch.id })
              }
            >
              Split & dispatch selected batch <ArrowUpRight size={14} />
            </button>
            <div className="workbench-inline">
              <label className="field compact-field">
                Reserve units
                <input
                  className="input"
                  type="number"
                  min="1"
                  step="1"
                  value={allocationQuantity}
                  disabled={busy}
                  onChange={(e) => setAllocationQuantity(e.target.value)}
                />
              </label>
              <button
                className="button secondary"
                disabled={
                  busy || !targetBatch || !targetRider || !targetReceiver
                }
                onClick={() =>
                  targetBatch &&
                  targetRider &&
                  targetReceiver &&
                  void send({
                    type: "RESERVE",
                    batchId: targetBatch.id,
                    riderId: targetRider.id,
                    receiverId: targetReceiver.id,
                    quantity: Number(allocationQuantity),
                  })
                }
              >
                Reserve route
              </button>
            </div>
          </div>
          <div className="workbench-group">
            <h3>
              <span>02</span> Rider & lease
            </h3>
            <p>
              Before pickup, stock can be reassigned. After pickup, custody must
              be recovered.
            </p>
            <button
              className="button secondary"
              disabled={busy || !targetRider}
              onClick={() =>
                targetRider &&
                void send({ type: "RIDER_FAILURE", riderId: targetRider.id })
              }
            >
              Simulate selected rider failure
            </button>
            <button
              className="button secondary"
              disabled={busy || !targetRider}
              onClick={() =>
                targetRider &&
                void send({
                  type: "UPDATE_RIDER",
                  riderId: targetRider.id,
                  online: !targetRider.online,
                  available: !targetRider.online,
                })
              }
            >
              {targetRider?.online
                ? "Take selected rider offline"
                : "Bring selected rider online"}
            </button>
            <button
              className="button secondary"
              disabled={busy || !targetReservation}
              onClick={() =>
                targetReservation &&
                void send({
                  type: "HEARTBEAT",
                  reservationId: targetReservation.id,
                })
              }
            >
              <Radio size={14} /> Selected reservation heartbeat
            </button>
          </div>
          <div className="workbench-group">
            <h3>
              <span>03</span> Receiving constraints
            </h3>
            <p>Capability and demand changes trigger safety re-evaluation.</p>
            <button
              className="button secondary"
              disabled={busy || !targetReceiver}
              onClick={() =>
                targetReceiver &&
                void send({
                  type: "UPDATE_RECEIVER",
                  receiverId: targetReceiver.id,
                  isOpen: !targetReceiver.isOpen,
                })
              }
            >
              {targetReceiver?.isOpen
                ? "Close selected receiver"
                : "Reopen selected receiver"}
            </button>
            <button
              className="button secondary"
              disabled={busy || !targetReceiver}
              onClick={() =>
                targetReceiver &&
                void send({
                  type: "UPDATE_RECEIVER",
                  receiverId: targetReceiver.id,
                  capabilities: { cookingFuel: false },
                })
              }
            >
              Remove receiver’s cooking fuel
            </button>
            <div className="workbench-inline">
              <label className="field compact-field">
                {targetBatch ? AID_LABELS[targetBatch.aidType] : "Aid"} demand
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="1"
                  value={receiverDemand}
                  disabled={busy}
                  onChange={(e) => setReceiverDemand(e.target.value)}
                />
              </label>
              <button
                className="button secondary"
                disabled={busy || !targetReceiver || !targetBatch}
                onClick={() =>
                  targetReceiver &&
                  targetBatch &&
                  void send({
                    type: "UPDATE_RECEIVER",
                    receiverId: targetReceiver.id,
                    aidType: targetBatch.aidType,
                    demand: Number(receiverDemand),
                  })
                }
              >
                Set demand
              </button>
            </div>
          </div>
        </div>
        <div className="simulation-clock">
          <div className="clock-label">
            <Clock3 size={17} />
            <div>
              <strong>Move the clock</strong>
              <span>Travel, leases and freshness use simulated minutes.</span>
            </div>
          </div>
          <div className="clock-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void send({ type: "ADVANCE_TIME", minutes: 1 })}
            >
              +1 minute
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void send({ type: "ADVANCE_TIME", minutes: 5 })}
            >
              +5 minutes
            </button>
            <button
              className="button secondary"
              disabled={
                busy || !targetBatch || targetBatch.safeUntil <= state.now
              }
              onClick={() =>
                targetBatch &&
                void send({
                  type: "ADVANCE_TIME",
                  minutes: Math.max(1, targetBatch.safeUntil - state.now),
                })
              }
            >
              To selected batch expiry
            </button>
            <button
              className="button danger"
              disabled={busy || !targetBatch}
              onClick={() =>
                targetBatch &&
                void send({ type: "EXPIRE_BATCH", batchId: targetBatch.id })
              }
            >
              Expire selected batch
            </button>
          </div>
        </div>
      </section>

      <section className="event-section" aria-labelledby="event-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">NOTHING LOST IN THE HANDOFF</span>
            <h2 id="event-title">
              The decision trail{" "}
              <span className="count-pill">{state.events.length}</span>
            </h2>
          </div>
          <label className="event-filter">
            Show
            <select
              className="select"
              value={eventFilter}
              disabled={busy}
              onChange={(e) => setEventFilter(e.target.value)}
            >
              <option value="ALL">All events</option>
              <option value="danger">Critical</option>
              <option value="warning">Warnings</option>
              <option value="success">Successful</option>
              <option value="info">Information</option>
            </select>
          </label>
        </div>
        <div
          className="event-list"
          role="log"
          aria-label="Operations event timeline"
        >
          {events.length ? (
            events.slice(0, 60).map((event) => (
              <article
                className={`event-row event-${event.severity}`}
                key={event.id}
              >
                <time>{formatTime(event.timestamp)}</time>
                <span className="event-dot" />
                <div className="event-copy">
                  <div>
                    <span className={`event-code severity-${event.severity}`}>
                      {event.type}
                    </span>
                    <span className="event-entity">{event.entityId}</span>
                  </div>
                  <p>{event.message}</p>
                </div>
                <span className={`badge ${event.severity}`}>
                  {event.severity}
                </span>
              </article>
            ))
          ) : (
            <div className="empty-state">No events match this filter.</div>
          )}
        </div>
        {events.length > 60 && (
          <p className="muted timeline-limit">
            Showing the latest 60 matching events of {events.length}.
          </p>
        )}
      </section>
      <footer className="dashboard-footer">
        <span>
          <ShieldCheck size={14} /> Real constraints. Accountable handoffs.
        </span>
        <span>RelaySafe / Bengaluru demo network</span>
      </footer>
    </div>
  );
}
