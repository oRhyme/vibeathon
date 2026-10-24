/// <reference types="vite/client" />
import { useId, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clock3,
  MapPin,
  Package,
  Radio,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { feasibility } from "../domain/engine";
import {
  ACTIVE_RESERVATIONS,
  AID_LABELS,
  CAPABILITY_LABELS,
  batchTotals,
  formatTime,
  type Action,
  type AidType,
  type Batch,
  type Capability,
  type ConsoleProps,
  type Receiver,
  type Reservation,
  type Rider,
  type Shipment,
} from "../domain/types";
import "./roles.css";

export type { ConsoleProps } from "../domain/types";

const aidTypes = Object.keys(AID_LABELS) as AidType[];
const capabilities = Object.keys(CAPABILITY_LABELS) as Capability[];
const statusLabel = (status: string) =>
  status.toLowerCase().replaceAll("_", " ");
const units = (quantity: number) => quantity.toLocaleString();
// The app reports rejected actions in its shared toast. Keep form drafts on rejection.
const send = (act: ConsoleProps["act"], action: Action) => {
  void act(action).catch(() => {});
};
const formNumber = (data: FormData, name: string) => Number(data.get(name));
const formCapabilities = (data: FormData): Record<Capability, boolean> =>
  Object.fromEntries(
    capabilities.map((capability) => [capability, data.has(capability)]),
  ) as Record<Capability, boolean>;

function RoleHero({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <header className="role-heading role-hero">
      <div className="role-hero-copy">
        <div className="role-kicker">
          <span className="live-dot" /> {eyebrow}
        </div>
        <h1 className="page-heading">{title}</h1>
        <p className="role-description">{description}</p>
      </div>
      <div className="role-hero-control">{children}</div>
    </header>
  );
}

function RoleSignal({
  label,
  value,
  detail,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  accent?: boolean;
}) {
  return (
    <div className={`role-signal ${accent ? "role-signal-accent" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function RoleDetails({
  label,
  children,
  open = false,
  className = "",
}: {
  label: string;
  children: ReactNode;
  open?: boolean;
  className?: string;
}) {
  return (
    <details className={`role-details ${className}`} open={open}>
      <summary>
        <span>{label}</span>
        <ChevronDown size={15} />
      </summary>
      <div className="role-details-content">{children}</div>
    </details>
  );
}

function Clock({ state, act, busy }: ConsoleProps) {
  return (
    <aside className="role-clock" aria-label="Simulation clock">
      <span className="role-clock-icon">
        <Clock3 size={17} />
      </span>
      <div className="role-clock-readout">
        <span className="role-clock-label">SIMULATED TIME</span>
        <strong>{formatTime(state.now)}</strong>
        <span className="role-clock-zone">IST · local relay clock</span>
      </div>
      <p className="role-clock-note">Advance time to move the next handoff.</p>
      <div className="role-actions">
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => send(act, { type: "ADVANCE_TIME", minutes: 1 })}
        >
          +1 minute
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => send(act, { type: "ADVANCE_TIME", minutes: 5 })}
        >
          +5 minutes
        </button>
      </div>
    </aside>
  );
}

function Status({ value }: { value: string }) {
  const tone = [
    "EXPIRED",
    "RECOVERY_REQUIRED",
    "TIMED_OUT",
    "WARNING_INACTIVE",
    "REROUTE_REQUIRED",
  ].includes(value)
    ? "role-status-alert"
    : value === "DELIVERED"
      ? "role-status-complete"
      : "";
  return (
    <span className={`badge role-status ${tone}`}>{statusLabel(value)}</span>
  );
}

function NumberEdit({
  label,
  value,
  min = 0,
  busy,
  save,
  help,
}: {
  label: string;
  value: number;
  min?: number;
  busy: boolean;
  save: (value: number) => Promise<void>;
  help?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const id = useId();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await save(Number(draft ?? value));
      setDraft(null);
    } catch {
      /* Shared app toast preserves the failure reason. */
    }
  };
  return (
    <form className="role-number-edit" onSubmit={(event) => void submit(event)}>
      <div className="field">
        <label htmlFor={id}>{label}</label>
        <span className="role-number-controls">
          <input
            id={id}
            className="input"
            type="number"
            required
            min={min}
            max={1000000}
            step="1"
            value={draft ?? value}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button className="button secondary" type="submit" disabled={busy}>
            Save
          </button>
        </span>
      </div>
      {help && <p className="role-help">{help}</p>}
      {draft !== null && Number(draft) !== value && (
        <span className="role-draft">
          Unsaved · current value {units(value)}
        </span>
      )}
    </form>
  );
}

function CapabilityFields({
  legend,
  defaultChecked = false,
}: {
  legend: string;
  defaultChecked?: boolean;
}) {
  return (
    <fieldset className="role-capabilities">
      <legend>{legend}</legend>
      <div className="role-check-grid">
        {capabilities.map((capability) => (
          <label className="role-check" key={capability}>
            <input
              type="checkbox"
              name={capability}
              defaultChecked={defaultChecked}
            />
            <span>{CAPABILITY_LABELS[capability]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function CreateBatch({
  donorId,
  act,
  busy,
}: {
  donorId: string;
  act: ConsoleProps["act"];
  busy: boolean;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    send(act, {
      type: "CREATE_BATCH",
      donorId,
      aidType: data.get("aidType") as AidType,
      quantity: formNumber(data, "quantity"),
      readyIn: formNumber(data, "readyIn"),
      expiresIn: formNumber(data, "expiresIn"),
      notes: String(data.get("notes") ?? ""),
      requirements: capabilities.filter((capability) => data.has(capability)),
    });
  };
  return (
    <form className="role-paper role-create" onSubmit={submit}>
      <fieldset disabled={busy || !donorId} className="role-form-fields">
        <div className="role-section-title">
          <span className="eyebrow">MAKE IT AVAILABLE</span>
          <h2>Post a fresh batch.</h2>
          <p>Tell dispatch what is ready, and when its window closes.</p>
        </div>
        <label className="field">
          Aid type
          <select className="select" name="aidType" defaultValue="COOKED_MEALS">
            {aidTypes.map((aid) => (
              <option key={aid} value={aid}>
                {AID_LABELS[aid]}
              </option>
            ))}
          </select>
        </label>
        <label className="field role-primary-number">
          Quantity · units
          <input
            className="input"
            name="quantity"
            type="number"
            required
            min="1"
            max="1000000"
            step="1"
            defaultValue="40"
          />
        </label>
        <RoleDetails label="Timing, facilities & handoff notes">
          <div className="role-form-grid">
            <label className="field">
              Ready in · minutes
              <input
                className="input"
                name="readyIn"
                type="number"
                required
                min="0"
                max="10080"
                step="1"
                defaultValue="0"
              />
            </label>
            <label className="field">
              Expires in · minutes
              <input
                className="input"
                name="expiresIn"
                type="number"
                required
                min="1"
                max="10080"
                step="1"
                defaultValue="45"
              />
            </label>
          </div>
          <CapabilityFields legend="Additional receiving requirements" />
          <p className="role-help">
            Baseline aid requirements are always included. These facilities add
            constraints; they never remove them.
          </p>
          <label className="field">
            Handoff notes
            <textarea
              className="input role-textarea"
              name="notes"
              maxLength={2000}
              rows={3}
              placeholder="Packaging, collection point, handling instructions…"
            />
          </label>
        </RoleDetails>
        <button className="button primary role-submit" type="submit">
          <Package size={16} /> Post batch <ArrowRight size={16} />
        </button>
      </fieldset>
    </form>
  );
}

function BatchCard({
  batch,
  state,
  act,
  busy,
}: ConsoleProps & { batch: Batch }) {
  const totals = batchTotals(state, batch.id);
  const reservations = state.reservations.filter(
    (reservation) =>
      reservation.batchId === batch.id &&
      ACTIVE_RESERVATIONS.includes(reservation.status),
  );
  const shipments = state.shipments.filter(
    (shipment) => shipment.batchId === batch.id,
  );
  const expired = state.now >= batch.safeUntil;
  return (
    <article className="role-batch">
      <div className="role-item-heading">
        <div>
          <span className="role-reference">{batch.id}</span>
          <h3>{AID_LABELS[batch.aidType]}</h3>
        </div>
        <span
          className={`badge role-status ${expired || batch.unavailable ? "role-status-alert" : ""}`}
        >
          {expired
            ? "Expired"
            : batch.unavailable
              ? "Unavailable"
              : state.now < batch.readyAt
                ? "Preparing"
                : "Ready for pickup"}
        </span>
      </div>
      <div className="role-batch-primary">
        <div className="role-batch-availability">
          <span>AVAILABLE NOW</span>
          <strong>{units(totals.available)}</strong>
          <small>of {units(totals.total)} posted units</small>
        </div>
        <div className="role-batch-primary-copy">
          <div className="role-timing">
            <span>
              Ready <strong>{formatTime(batch.readyAt)}</strong>
            </span>
            <span>
              Expires <strong>{formatTime(batch.safeUntil)}</strong>
            </span>
            <span>
              {expired
                ? "Safety window closed"
                : `${batch.safeUntil - state.now} min remaining`}
            </span>
          </div>
          <button
            className="button secondary"
            disabled={
              busy || expired || batch.unavailable || totals.available < 1
            }
            onClick={() =>
              send(act, { type: "AUTO_DISPATCH", batchId: batch.id })
            }
          >
            Find safe routes <ArrowRight size={14} />
          </button>
        </div>
      </div>
      <RoleDetails label="Stock, constraints & handoff register">
        <dl className="role-stock-totals">
          <div>
            <dt>Total posted</dt>
            <dd>{units(totals.total)}</dd>
          </div>
          <div>
            <dt>Available</dt>
            <dd>{units(totals.available)}</dd>
          </div>
          <div>
            <dt>Assigned, uncollected</dt>
            <dd>{units(totals.reserved)}</dd>
          </div>
          <div>
            <dt>Physically collected</dt>
            <dd>{units(totals.pickedUp)}</dd>
          </div>
          <div>
            <dt>Delivered</dt>
            <dd>{units(totals.delivered)}</dd>
          </div>
        </dl>
        <p className="role-help">
          {units(totals.pickedUp - totals.delivered)} collected units remain in
          rider custody. An assignment alone does not confirm collection.
        </p>
        {batch.notes && <p className="role-note">{batch.notes}</p>}
        <p className="role-requirements">
          <ShieldCheck size={14} /> Receiving requirements:{" "}
          {batch.requirements.length
            ? batch.requirements
                .map((capability) => CAPABILITY_LABELS[capability])
                .join(", ")
            : "No additional facilities"}
        </p>
        <div className="role-batch-edit">
          <NumberEdit
            label="Quantity still at donor · includes assignments"
            value={batch.quantity - totals.pickedUp}
            min={totals.reserved}
            busy={busy}
            save={(quantity) =>
              act({
                type: "UPDATE_BATCH",
                batchId: batch.id,
                quantity: quantity + totals.pickedUp,
              })
            }
            help={`Saving updates the batch total; ${totals.pickedUp} already collected units stay accounted for.`}
          />
          <label className="role-check">
            <input
              type="checkbox"
              checked={batch.unavailable}
              disabled={busy || expired}
              onChange={(event) =>
                send(act, {
                  type: "UPDATE_BATCH",
                  batchId: batch.id,
                  unavailable: event.target.checked,
                })
              }
            />
            <span>Mark unavailable</span>
          </label>
        </div>
        {(reservations.length > 0 || shipments.length > 0) && (
          <div className="role-custody">
            <h4>Live handoff register</h4>
            {reservations.map((reservation) => (
              <div className="role-custody-row" key={reservation.id}>
                <Package size={15} />
                <div>
                  <strong>
                    {
                      state.riders.find(
                        (rider) => rider.id === reservation.riderId,
                      )?.name
                    }
                  </strong>
                  <span>
                    {reservation.quantity} assigned for{" "}
                    {
                      state.receivers.find(
                        (receiver) => receiver.id === reservation.receiverId,
                      )?.name
                    }{" "}
                    · not yet collected
                  </span>
                </div>
                <Status value={reservation.status} />
              </div>
            ))}
            {shipments.map((shipment) => (
              <div className="role-custody-row" key={shipment.id}>
                <Truck size={15} />
                <div>
                  <strong>
                    {
                      state.riders.find(
                        (rider) => rider.id === shipment.riderId,
                      )?.name
                    }
                  </strong>
                  <span>
                    {shipment.quantity} collected · {shipment.deliveredQuantity}{" "}
                    delivered ·{" "}
                    {
                      state.receivers.find(
                        (receiver) => receiver.id === shipment.receiverId,
                      )?.name
                    }
                  </span>
                </div>
                <Status value={shipment.status} />
              </div>
            ))}
          </div>
        )}
      </RoleDetails>
    </article>
  );
}

export function DonorConsole(props: ConsoleProps) {
  const { state, busy } = props;
  const [selected, setSelected] = useState("");
  const donor =
    state.donors.find((item) => item.id === selected) ?? state.donors[0];
  const batches = state.batches.filter((batch) => batch.donorId === donor?.id);
  const readyUnits = batches.reduce((total, batch) => {
    if (batch.unavailable || batch.safeUntil <= state.now) return total;
    return total + Math.max(0, batchTotals(state, batch.id).available);
  }, 0);
  const assignedUnits = state.reservations
    .filter(
      (reservation) =>
        batches.some((batch) => batch.id === reservation.batchId) &&
        ACTIVE_RESERVATIONS.includes(reservation.status),
    )
    .reduce((total, reservation) => total + reservation.quantity, 0);
  const inMotionUnits = state.shipments
    .filter((shipment) =>
      batches.some((batch) => batch.id === shipment.batchId),
    )
    .reduce(
      (total, shipment) =>
        total + shipment.quantity - shipment.deliveredQuantity,
      0,
    );
  return (
    <div className="role-console">
      <RoleHero
        eyebrow="DONOR / SUPPLY DESK"
        title="Good things, ready to go."
        description="Post ready aid and keep its pickup window visible."
      >
        <label className="field role-entity-select">
          Donor station
          <select
            className="select"
            disabled={busy || !state.donors.length}
            value={donor?.id ?? ""}
            onChange={(event) => setSelected(event.target.value)}
          >
            {state.donors.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </RoleHero>
      <Clock {...props} />
      {donor ? (
        <>
          <div className="role-location role-location-chip">
            <MapPin size={15} />
            {donor.location.label}
          </div>
          <div className="role-signal-grid" aria-label="Donor snapshot">
            <RoleSignal
              label="Ready now"
              value={units(readyUnits)}
              detail="units available to dispatch"
              accent
            />
            <RoleSignal
              label="In reservations"
              value={units(assignedUnits)}
              detail="assigned, not collected"
            />
            <RoleSignal
              label="In transit"
              value={units(inMotionUnits)}
              detail="collected and still moving"
            />
          </div>
          <div className="role-donor-layout role-focus-grid">
            <CreateBatch
              key={`${donor.id}-${batches.map((batch) => batch.id).join("-")}`}
              donorId={donor.id}
              act={props.act}
              busy={busy}
            />
            <section className="role-register">
              <div className="role-section-title role-section-heading">
                <span className="eyebrow">SUPPLY LEDGER</span>
                <h2>
                  Live batches{" "}
                  <span className="role-count">{batches.length}</span>
                </h2>
                <p>
                  One clear view of what is ready, reserved, or already moving.
                </p>
              </div>
              {batches.length ? (
                [...batches]
                  .reverse()
                  .map((batch) => (
                    <BatchCard key={batch.id} batch={batch} {...props} />
                  ))
              ) : (
                <div className="role-empty">
                  No batches posted at this station. Post your first batch to
                  make aid available.
                </div>
              )}
            </section>
          </div>
        </>
      ) : (
        <div className="role-empty">No donor stations are registered.</div>
      )}
    </div>
  );
}

function Progress({ stage }: { stage: number }) {
  return (
    <ol className="role-progress" aria-label="Relay progress">
      {["Assigned", "Accepted", "Pickup", "Arrival", "Collected", "Done"].map(
        (label, index) => (
          <li
            key={label}
            className={
              index < stage
                ? "role-step-complete"
                : index === stage
                  ? "role-step-current"
                  : ""
            }
            aria-current={index === stage ? "step" : undefined}
          >
            <span>{index < stage ? <Check size={12} /> : index + 1}</span>
            {label}
          </li>
        ),
      )}
    </ol>
  );
}

function ReservationCard({
  reservation,
  ...props
}: ConsoleProps & { reservation: Reservation }) {
  const { state, act, busy } = props;
  const batch = state.batches.find((item) => item.id === reservation.batchId);
  const donor = state.donors.find((item) => item.id === batch?.donorId);
  const receiver = state.receivers.find(
    (item) => item.id === reservation.receiverId,
  );
  const startedAt = [...state.events]
    .reverse()
    .find(
      (event) =>
        event.entityId === reservation.id && event.type === "PICKUP_STARTED",
    )?.timestamp;
  const arrivalAt =
    startedAt === undefined ? undefined : startedAt + reservation.pickupEta;
  const estimatedDelivery =
    Math.max(
      arrivalAt ?? state.now + reservation.pickupEta,
      state.now,
      batch?.readyAt ?? state.now,
    ) + reservation.travelEta;
  const stage = [
    "ASSIGNED",
    "ACKNOWLEDGED",
    "EN_ROUTE_TO_DONOR",
    "ARRIVED_AT_DONOR",
    "PICKUP_CONFIRMED",
  ].indexOf(reservation.status);
  const active = ACTIVE_RESERVATIONS.includes(reservation.status);
  const [quantity, setQuantity] = useState(String(reservation.quantity));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    send(act, {
      type: "PICKUP",
      reservationId: reservation.id,
      quantity: Number(quantity),
    });
  };
  return (
    <article className={`role-job ${!active ? "role-job-archived" : ""}`}>
      <div className="role-item-heading">
        <div>
          <span className="role-reference">
            {reservation.id} ·{" "}
            {batch ? AID_LABELS[batch.aidType] : reservation.batchId}
          </span>
          <h3>
            {donor?.name ?? "Donor"} <ArrowRight size={17} />{" "}
            {receiver?.name ?? "Receiver"}
          </h3>
        </div>
        <Status value={reservation.status} />
      </div>
      <div className="role-job-lead">
        <div>
          <span>ASSIGNED LOAD</span>
          <strong>{units(reservation.quantity)} units</strong>
          <small>Physical custody starts at pickup.</small>
        </div>
        <div className="role-job-next">
          <span>NEXT STEP</span>
          <strong>{statusLabel(reservation.status)}</strong>
        </div>
      </div>
      <RoleDetails label="Route, lease & arrival details">
        <div className="role-job-facts">
          <span>
            Pickup travel <strong>{reservation.pickupEta} min</strong>
          </span>
          <span>
            Delivery travel <strong>{reservation.travelEta} min</strong>
          </span>
          <span>
            Estimated delivery <strong>{formatTime(estimatedDelivery)}</strong>
          </span>
          <span>
            Lease <strong>{formatTime(reservation.leaseExpiresAt)}</strong>
          </span>
          <span>
            Pickup deadline{" "}
            <strong>{formatTime(reservation.pickupDeadline)}</strong>
          </span>
          <span>
            Batch expires{" "}
            <strong>{batch ? formatTime(batch.safeUntil) : "—"}</strong>
          </span>
        </div>
      </RoleDetails>
      {active && (
        <>
          <Progress stage={stage} />
          <div className="role-actions">
            {reservation.status === "ASSIGNED" && (
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  send(act, { type: "ACCEPT", reservationId: reservation.id })
                }
              >
                Accept job
              </button>
            )}
            {reservation.status === "ACKNOWLEDGED" && (
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  send(act, {
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
                className="button primary"
                disabled={
                  busy || arrivalAt === undefined || state.now < arrivalAt
                }
                onClick={() =>
                  send(act, { type: "ARRIVE", reservationId: reservation.id })
                }
              >
                Confirm donor arrival
                {arrivalAt !== undefined && state.now < arrivalAt
                  ? ` · ${arrivalAt - state.now} min`
                  : ""}
              </button>
            )}
            {reservation.status === "ARRIVED_AT_DONOR" && (
              <form className="role-inline-form" onSubmit={submit}>
                <label className="field">
                  Actual pickup · units
                  <input
                    className="input"
                    required
                    type="number"
                    min="1"
                    max={reservation.quantity}
                    step="1"
                    value={quantity}
                    disabled={busy}
                    onChange={(event) => setQuantity(event.target.value)}
                  />
                </label>
                <button
                  className="button primary"
                  type="submit"
                  disabled={busy || !batch || state.now < batch.readyAt}
                >
                  Confirm physical pickup
                </button>
              </form>
            )}
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                send(act, { type: "HEARTBEAT", reservationId: reservation.id })
              }
            >
              <Radio size={14} />
              {reservation.status === "WARNING_INACTIVE"
                ? "Restore phase / heartbeat"
                : "Heartbeat"}
            </button>
            <button
              className="button role-text-button"
              disabled={busy}
              onClick={() =>
                send(act, { type: "DECLINE", reservationId: reservation.id })
              }
            >
              Decline / release
            </button>
          </div>
          <p className="role-help">
            {reservation.status === "WARNING_INACTIVE"
              ? "Your lease needs attention. Send a heartbeat to restore the current step; the pickup deadline does not move."
              : reservation.status === "EN_ROUTE_TO_DONOR"
                ? `Advance time until ${arrivalAt === undefined ? "the pickup trip finishes" : formatTime(arrivalAt)} before confirming arrival. A heartbeat updates progress; it does not move the clock.`
                : reservation.status === "ARRIVED_AT_DONOR"
                  ? `Count what you physically collect. A smaller pickup releases the uncollected remainder.${batch && state.now < batch.readyAt ? ` Batch ready at ${formatTime(batch.readyAt)}.` : ""}`
                  : "Assignment reserves stock. Physical custody begins only after you confirm pickup."}
          </p>
        </>
      )}
    </article>
  );
}

function ShipmentCard({
  shipment,
  receiverView = false,
  ...props
}: ConsoleProps & { shipment: Shipment; receiverView?: boolean }) {
  const { state, act, busy } = props;
  const batch = state.batches.find((item) => item.id === shipment.batchId);
  const rider = state.riders.find((item) => item.id === shipment.riderId);
  const donor = state.donors.find((item) => item.id === batch?.donorId);
  const receiver = state.receivers.find(
    (item) => item.id === shipment.receiverId,
  );
  const remaining = shipment.quantity - shipment.deliveredQuantity;
  const [quantity, setQuantity] = useState<string | null>(null);
  const [delay, setDelay] = useState("5");
  const [recoveryId, setRecoveryId] = useState("");
  const eligible = state.riders.filter(
    (candidate) =>
      candidate.id !== shipment.riderId &&
      candidate.online &&
      candidate.available &&
      candidate.capacity >= remaining &&
      !state.reservations.some(
        (reservation) =>
          reservation.riderId === candidate.id &&
          ACTIVE_RESERVATIONS.includes(reservation.status),
      ) &&
      !state.shipments.some(
        (cargo) =>
          cargo.riderId === candidate.id &&
          cargo.quantity > cargo.deliveredQuantity,
      ),
  );
  const recovery =
    eligible.find((candidate) => candidate.id === recoveryId) ?? eligible[0];
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    send(act, {
      type: "DELIVER",
      shipmentId: shipment.id,
      quantity: Number(quantity ?? remaining),
    });
  };
  return (
    <article
      className={`role-job ${shipment.status === "DELIVERED" ? "role-job-archived" : ""}`}
    >
      <div className="role-item-heading">
        <div>
          <span className="role-reference">
            {shipment.id} ·{" "}
            {batch ? AID_LABELS[batch.aidType] : shipment.batchId}
          </span>
          <h3>
            {receiverView ? rider?.name : donor?.name} <ArrowRight size={17} />{" "}
            {receiver?.name}
          </h3>
        </div>
        <Status value={shipment.status} />
      </div>
      <div className="role-shipment-lead">
        <div>
          <span>{receiverView ? "AWAITING RECEIPT" : "IN CUSTODY"}</span>
          <strong>{units(remaining)} units</strong>
          <small>
            {receiverView
              ? "Confirm only what physically arrives."
              : "Keep the remainder visible until handoff."}
          </small>
        </div>
        <div className="role-job-next">
          <span>STATUS</span>
          <strong>{statusLabel(shipment.status)}</strong>
        </div>
      </div>
      <RoleDetails label="Arrival, custody & freshness">
        <div className="role-job-facts">
          <span>
            Collected <strong>{shipment.quantity}</strong>
          </span>
          <span>
            Confirmed received <strong>{shipment.deliveredQuantity}</strong>
          </span>
          <span>
            In custody <strong>{remaining} units</strong>
          </span>
          <span>
            Arrival <strong>{formatTime(shipment.eta)}</strong>
          </span>
          <span>
            Expiry <strong>{batch ? formatTime(batch.safeUntil) : "—"}</strong>
          </span>
          <span>
            Last update <strong>{formatTime(shipment.lastHeartbeatAt)}</strong>
          </span>
        </div>
      </RoleDetails>
      <Progress stage={shipment.status === "DELIVERED" ? 5 : 4} />
      {shipment.reason && <p className="role-exception">{shipment.reason}</p>}
      {shipment.status === "IN_TRANSIT" && (
        <>
          <form className="role-inline-form" onSubmit={submit}>
            <label className="field">
              {receiverView ? "Accepted delivery" : "Actual delivery"} · units
              <input
                className="input"
                type="number"
                required
                min="1"
                max={remaining}
                step="1"
                value={quantity ?? remaining}
                disabled={busy}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </label>
            <button
              className="button primary"
              disabled={busy || state.now < shipment.eta}
              type="submit"
            >
              {receiverView ? "Confirm receipt" : "Confirm delivery"}
            </button>
            <span className="role-arrival-note">
              {state.now < shipment.eta
                ? `Available at ${formatTime(shipment.eta)} · ${shipment.eta - state.now} min to arrival`
                : "Arrival time reached · verify physical handoff"}
            </span>
          </form>
          {!receiverView && (
            <>
              <div className="role-actions role-shipment-primary-tools">
                <button
                  className="button secondary"
                  disabled={busy || !rider?.online}
                  onClick={() =>
                    send(act, {
                      type: "HEARTBEAT",
                      reservationId: shipment.reservationId,
                    })
                  }
                >
                  <Radio size={14} /> Progress heartbeat
                </button>
              </div>
              <RoleDetails label="Reroute, failure & delay tools">
                <div className="role-shipment-tools">
                  <div className="role-actions">
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() =>
                        send(act, { type: "REROUTE", shipmentId: shipment.id })
                      }
                    >
                      Find safe reroute
                    </button>
                    <button
                      className="button role-danger-button"
                      disabled={busy}
                      onClick={() =>
                        send(act, {
                          type: "RIDER_FAILURE",
                          riderId: shipment.riderId,
                        })
                      }
                    >
                      Report rider failure
                    </button>
                  </div>
                  <form
                    className="role-inline-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      send(act, {
                        type: "REPORT_DELAY",
                        shipmentId: shipment.id,
                        minutes: Number(delay),
                      });
                    }}
                  >
                    <label className="field">
                      Delay · minutes
                      <input
                        className="input"
                        type="number"
                        required
                        min="1"
                        max="10080"
                        step="1"
                        value={delay}
                        disabled={busy}
                        onChange={(event) => setDelay(event.target.value)}
                      />
                    </label>
                    <button
                      className="button secondary"
                      disabled={busy}
                      type="submit"
                    >
                      Report delay
                    </button>
                  </form>
                </div>
              </RoleDetails>
            </>
          )}
          <p className="role-help">
            Partial receipt leaves the remainder in rider custody. Only
            confirmed units reduce demand and enter receiver storage.
          </p>
        </>
      )}
      {!receiverView && shipment.status === "REROUTE_REQUIRED" && (
        <button
          className="button primary"
          disabled={busy}
          onClick={() =>
            send(act, { type: "REROUTE", shipmentId: shipment.id })
          }
        >
          Find a safe alternative receiver
        </button>
      )}
      {!receiverView && shipment.status === "RECOVERY_REQUIRED" && (
        <div className="role-recovery">
          <p>
            Custody is frozen with {rider?.name}. The full {remaining}-unit
            remainder stays with this rider until a verified physical handoff.
          </p>
          {shipment.recovery ? (
            <div className="role-inline-form">
              <p>
                Recovery rider:{" "}
                <strong>
                  {
                    state.riders.find(
                      (r) => r.id === shipment.recovery?.riderId,
                    )?.name
                  }
                </strong>
                . Rendezvous at {formatTime(shipment.recovery.rendezvousAt)}.
              </p>
              <button
                className="button primary"
                disabled={busy || state.now < shipment.recovery.rendezvousAt}
                onClick={() =>
                  send(act, {
                    type: "CONFIRM_RECOVERY",
                    shipmentId: shipment.id,
                  })
                }
              >
                Verify physical recovery handoff
              </button>
            </div>
          ) : (
            <>
              <div className="role-inline-form">
                <label className="field">
                  Recovery rider
                  <select
                    className="select"
                    disabled={busy || !eligible.length}
                    value={recovery?.id ?? ""}
                    onChange={(event) => setRecoveryId(event.target.value)}
                  >
                    {!eligible.length && (
                      <option value="">No available recovery rider</option>
                    )}
                    {eligible.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name} · {candidate.capacity}-unit capacity
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button primary"
                  disabled={busy || !recovery}
                  onClick={() =>
                    recovery &&
                    send(act, {
                      type: "RECOVER",
                      shipmentId: shipment.id,
                      riderId: recovery.id,
                    })
                  }
                >
                  Dispatch recovery
                </button>
              </div>
              {!eligible.length && (
                <p className="role-help">
                  Bring a different unloaded rider online and available with
                  enough capacity. The engine validates the complete recovery
                  route.
                </p>
              )}
            </>
          )}
        </div>
      )}
      {shipment.status === "EXPIRED" && (
        <p className="role-exception">
          Expired aid is blocked from delivery. {remaining} undelivered units
          remain accounted for in physical custody.
        </p>
      )}
      {shipment.status === "DELIVERED" && (
        <p className="role-receipt">
          <Check size={15} /> {shipment.deliveredQuantity} units received
          {shipment.deliveredAt !== undefined
            ? ` at ${formatTime(shipment.deliveredAt)}`
            : ""}
          .
        </p>
      )}
    </article>
  );
}

function RiderSettings({
  rider,
  act,
  busy,
}: {
  rider: Rider;
  act: ConsoleProps["act"];
  busy: boolean;
}) {
  return (
    <section className="role-rider-settings role-settings-card">
      <div className="role-rider-identity">
        <span className="role-avatar">{rider.name.slice(0, 1)}</span>
        <div>
          <h2>{rider.name}</h2>
          <span>
            <MapPin size={12} />
            {rider.location.label}
          </span>
        </div>
      </div>
      <div className="role-toggle-pair">
        <label className="role-check">
          <input
            type="checkbox"
            checked={rider.online}
            disabled={busy}
            onChange={(event) =>
              send(act, {
                type: "UPDATE_RIDER",
                riderId: rider.id,
                online: event.target.checked,
              })
            }
          />
          <span>Online</span>
        </label>
        <label className="role-check">
          <input
            type="checkbox"
            checked={rider.available}
            disabled={busy || !rider.online}
            onChange={(event) =>
              send(act, {
                type: "UPDATE_RIDER",
                riderId: rider.id,
                available: event.target.checked,
              })
            }
          />
          <span>Available for assignments</span>
        </label>
      </div>
      <RoleDetails label={`Capacity · ${rider.capacity} units`}>
        <NumberEdit
          label="Carrying capacity · units"
          value={rider.capacity}
          min={1}
          busy={busy}
          save={(capacity) =>
            act({ type: "UPDATE_RIDER", riderId: rider.id, capacity })
          }
        />
      </RoleDetails>
    </section>
  );
}

export function RiderConsole(props: ConsoleProps) {
  const { state, busy } = props;
  const [selected, setSelected] = useState("");
  const rider =
    state.riders.find((item) => item.id === selected) ?? state.riders[0];
  const jobs = state.reservations.filter(
    (reservation) =>
      reservation.riderId === rider?.id &&
      reservation.status !== "PICKUP_CONFIRMED",
  );
  const shipments = state.shipments.filter(
    (shipment) =>
      shipment.riderId === rider?.id ||
      shipment.recovery?.riderId === rider?.id,
  );
  const activeJobs = jobs.filter((job) =>
    ACTIVE_RESERVATIONS.includes(job.status),
  ).length;
  const custodyUnits = shipments.reduce(
    (total, shipment) => total + shipment.quantity - shipment.deliveredQuantity,
    0,
  );
  return (
    <div className="role-console">
      <RoleHero
        eyebrow="RIDER / FIELD DESK"
        title="Carry the good forward."
        description="Accept a route and confirm each physical handoff."
      >
        <label className="field role-entity-select">
          Rider
          <select
            className="select"
            aria-label="Rider"
            value={rider?.id ?? ""}
            disabled={busy || !state.riders.length}
            onChange={(event) => setSelected(event.target.value)}
          >
            {state.riders.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.online ? "online" : "offline"}
              </option>
            ))}
          </select>
        </label>
      </RoleHero>
      <Clock {...props} />
      {rider ? (
        <>
          <RiderSettings
            key={rider.id}
            rider={rider}
            act={props.act}
            busy={busy}
          />
          <div className="role-signal-grid" aria-label="Rider snapshot">
            <RoleSignal
              label="Availability"
              value={rider.online && rider.available ? "Ready" : "Paused"}
              detail={
                rider.online ? "online in the relay" : "offline from dispatch"
              }
              accent={rider.online && rider.available}
            />
            <RoleSignal
              label="Next handoff"
              value={activeJobs}
              detail="active pickup jobs"
            />
            <RoleSignal
              label="In custody"
              value={`${units(custodyUnits)} units`}
              detail="physical units still moving"
            />
          </div>
          <p className="role-advisory">
            <ShieldCheck size={17} />
            Going offline or unavailable releases uncollected assignments.
            Collected aid stays in physical custody and needs recovery.
          </p>
          <section className="role-register role-primary-register">
            <div className="role-section-title role-section-heading">
              <span className="eyebrow">NEXT HANDOFF</span>
              <h2>
                Pickup jobs <span className="role-count">{activeJobs}</span>
              </h2>
              <p>
                The next action is here. Open details only when you need them.
              </p>
            </div>
            {jobs.length ? (
              [...jobs]
                .reverse()
                .map((shipment) => (
                  <ReservationCard
                    key={shipment.id}
                    reservation={shipment}
                    {...props}
                  />
                ))
            ) : (
              <div className="role-empty">
                <Package size={24} />
                <div>
                  <h3>No pickup jobs yet.</h3>
                  <p>
                    Go online and available, then wait for a pickup assignment.
                    Accept it, travel to the donor, and confirm what you
                    collect.
                  </p>
                </div>
              </div>
            )}
          </section>
          <section className="role-register">
            <div className="role-section-title role-section-heading">
              <span className="eyebrow">PHYSICAL CUSTODY</span>
              <h2>
                In transit{" "}
                <span className="role-count">
                  {
                    shipments.filter(
                      (shipment) =>
                        shipment.quantity > shipment.deliveredQuantity,
                    ).length
                  }
                </span>
              </h2>
              <p>
                Collected units stay with the rider until the receiving handoff
                is confirmed.
              </p>
            </div>
            {shipments.length ? (
              [...shipments]
                .reverse()
                .map((reservation) => (
                  <ShipmentCard
                    key={reservation.id}
                    shipment={reservation}
                    {...props}
                  />
                ))
            ) : (
              <div className="role-empty">
                <Truck size={24} />
                <div>
                  <h3>No aid in custody yet.</h3>
                  <p>Accept a job and confirm pickup to start a delivery.</p>
                </div>
              </div>
            )}
          </section>
        </>
      ) : (
        <div className="role-empty">No riders are registered.</div>
      )}
    </div>
  );
}

function ReceiverSettings({
  receiver,
  ...props
}: ConsoleProps & { receiver: Receiver }) {
  const { state, act, busy } = props;
  const committed =
    state.reservations
      .filter(
        (reservation) =>
          reservation.receiverId === receiver.id &&
          ACTIVE_RESERVATIONS.includes(reservation.status),
      )
      .reduce((sum, reservation) => sum + reservation.quantity, 0) +
    state.shipments
      .filter((shipment) => shipment.receiverId === receiver.id)
      .reduce(
        (sum, shipment) => sum + shipment.quantity - shipment.deliveredQuantity,
        0,
      );
  const outstandingDemand = Object.values(receiver.demand).reduce(
    (sum, value) => sum + value,
    0,
  );
  const freeStorage = Math.max(
    0,
    receiver.storageCapacity - receiver.currentStorage - committed,
  );
  return (
    <section className="role-receiver-settings role-settings-card">
      <div className="role-item-heading">
        <div>
          <span className="eyebrow">RECEIVING POINT</span>
          <h2>{receiver.name}</h2>
          <p className="role-location">
            <MapPin size={14} />
            {receiver.location.label} · latest arrival{" "}
            {formatTime(receiver.latestArrival)}
          </p>
        </div>
        <label className="role-check">
          <input
            type="checkbox"
            aria-label="Receiver open status"
            checked={receiver.isOpen}
            disabled={busy}
            onChange={(event) =>
              send(act, {
                type: "UPDATE_RECEIVER",
                receiverId: receiver.id,
                isOpen: event.target.checked,
              })
            }
          />
          <span>
            {receiver.isOpen ? "Open for receiving" : "Closed for receiving"}
          </span>
        </label>
      </div>
      <div className="role-signal-grid role-receiver-signals">
        <RoleSignal
          label="Open status"
          value={receiver.isOpen ? "Open" : "Closed"}
          detail="receiving window"
          accent={receiver.isOpen}
        />
        <RoleSignal
          label="Demand"
          value={`${units(outstandingDemand)} units`}
          detail="outstanding across aid types"
        />
        <RoleSignal
          label="Storage free"
          value={`${units(freeStorage)} units`}
          detail={`${units(committed)} units committed inbound`}
        />
      </div>
      <RoleDetails label="Edit demand, storage & facilities">
        <div className="role-receiver-grid">
          <div>
            <h3>Demand by aid type</h3>
            <p className="role-help">
              Current outstanding demand; confirmed deliveries reduce it. Save
              each change explicitly.
            </p>
            <div className="role-demand-list">
              {aidTypes.map((aidType) => (
                <NumberEdit
                  key={aidType}
                  label={AID_LABELS[aidType]}
                  value={receiver.demand[aidType]}
                  busy={busy}
                  save={(demand) =>
                    act({
                      type: "UPDATE_RECEIVER",
                      receiverId: receiver.id,
                      aidType,
                      demand,
                    })
                  }
                />
              ))}
            </div>
          </div>
          <div>
            <h3>Storage & facilities</h3>
            <div className="role-storage">
              <strong>
                {receiver.currentStorage}
                <span> / {receiver.storageCapacity} units stored</span>
              </strong>
              <p>
                {committed} incoming / committed · {freeStorage} free for new
                allocations
              </p>
            </div>
            <NumberEdit
              label="Total storage capacity · units"
              value={receiver.storageCapacity}
              min={receiver.currentStorage}
              busy={busy}
              save={(storageCapacity) =>
                act({
                  type: "UPDATE_RECEIVER",
                  receiverId: receiver.id,
                  storageCapacity,
                })
              }
            />
            <fieldset className="role-capabilities" disabled={busy}>
              <legend>Facilities currently available</legend>
              <div className="role-check-grid">
                {capabilities.map((capability) => (
                  <label className="role-check" key={capability}>
                    <input
                      type="checkbox"
                      checked={receiver.capabilities[capability]}
                      onChange={(event) =>
                        send(act, {
                          type: "UPDATE_RECEIVER",
                          receiverId: receiver.id,
                          capabilities: { [capability]: event.target.checked },
                        })
                      }
                    />
                    <span>{CAPABILITY_LABELS[capability]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="role-help">
              Facility changes recheck every active commitment through the
              central engine.
            </p>
          </div>
        </div>
      </RoleDetails>
    </section>
  );
}

function Compatibility({
  receiver,
  state,
}: {
  receiver: Receiver;
  state: ConsoleProps["state"];
}) {
  return (
    <section className="role-compatibility">
      <div className="role-section-title">
        <span className="eyebrow">THE RIGHT AID, THE RIGHT FACILITIES</span>
        <h2>Receiving compatibility</h2>
        <p>
          Live dispatch-engine decisions for existing donor batches. Fix missing
          facilities before asking dispatch to retry.
        </p>
      </div>
      {state.batches.length ? (
        state.batches.map((batch) => {
          const missing = batch.requirements.filter(
            (capability) => !receiver.capabilities[capability],
          );
          const decisions = state.riders.map((rider) =>
            feasibility(state, batch.id, rider.id, receiver.id),
          );
          const decision =
            decisions.find((item) => item.ok) ??
            decisions.find((item) => item.code.startsWith("MISSING_")) ??
            decisions[0];
          return (
            <article className="role-compatibility-row" key={batch.id}>
              <div>
                <h3>
                  {AID_LABELS[batch.aidType]} <span>{batch.id}</span>
                </h3>
                <p>
                  {missing.length
                    ? `Missing: ${missing.map((capability) => CAPABILITY_LABELS[capability]).join(", ")}`
                    : "Posted batch facility requirements are present."}
                </p>
                <p className="role-help">
                  {decision?.message ??
                    "No riders are registered; dispatch cannot evaluate a route."}
                  {decision && !decision.ok && <code> [{decision.code}]</code>}
                </p>
              </div>
              <span
                className={`badge role-status ${missing.length || !decision?.ok ? "role-status-alert" : "role-status-complete"}`}
              >
                {missing.length
                  ? "Facilities missing"
                  : decision?.ok
                    ? "Route available"
                    : "Route constrained"}
              </span>
            </article>
          );
        })
      ) : (
        <div className="role-empty">
          Post a donor batch to see its actual receiving requirements and
          dispatch decision.
        </div>
      )}
    </section>
  );
}

function CreateReceiver({ act, busy }: Pick<ConsoleProps, "act" | "busy">) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    send(act, {
      type: "CREATE_RECEIVER",
      name: String(data.get("name") ?? ""),
      quantity: formNumber(data, "quantity"),
      aidType: data.get("aidType") as AidType,
      storageCapacity: formNumber(data, "storageCapacity"),
      latestIn: formNumber(data, "latestIn"),
      capabilities: formCapabilities(data),
    });
  };
  return (
    <details className="role-new-receiver">
      <summary>
        Register a new receiving point <span>+ New demand</span>
      </summary>
      <form onSubmit={submit}>
        <fieldset className="role-form-fields" disabled={busy}>
          <p className="role-help">
            Register the point with its first aid request. You can edit demand
            for every aid type after registration.
          </p>
          <div className="role-form-grid role-form-grid-two">
            <label className="field">
              Receiving point name
              <input
                className="input"
                name="name"
                required
                maxLength={120}
                placeholder="Community centre or shelter"
              />
            </label>
            <label className="field">
              Aid needed
              <select
                className="select"
                name="aidType"
                defaultValue="COOKED_MEALS"
              >
                {aidTypes.map((aid) => (
                  <option key={aid} value={aid}>
                    {AID_LABELS[aid]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Requested quantity · units
              <input
                className="input"
                name="quantity"
                type="number"
                required
                min="1"
                max="1000000"
                step="1"
                defaultValue="40"
              />
            </label>
            <label className="field">
              Storage capacity · units
              <input
                className="input"
                name="storageCapacity"
                type="number"
                required
                min="0"
                max="1000000"
                step="1"
                defaultValue="60"
              />
            </label>
            <label className="field">
              Latest arrival in · minutes
              <input
                className="input"
                name="latestIn"
                type="number"
                required
                min="1"
                max="10080"
                step="1"
                defaultValue="60"
              />
            </label>
          </div>
          <CapabilityFields legend="Facilities available at this point" />
          <p className="role-help">
            Select only facilities actually available. The dispatch engine
            determines which aid can be accepted.
          </p>
          <button className="button primary role-submit" type="submit">
            Register point & demand <ArrowRight size={15} />
          </button>
        </fieldset>
      </form>
    </details>
  );
}

export function ReceiverConsole(props: ConsoleProps) {
  const { state, busy } = props;
  const [selected, setSelected] = useState("");
  const receiver =
    state.receivers.find((item) => item.id === selected) ?? state.receivers[0];
  const shipments = state.shipments.filter(
    (shipment) => shipment.receiverId === receiver?.id,
  );
  const assigned = state.reservations.filter(
    (reservation) =>
      reservation.receiverId === receiver?.id &&
      ACTIVE_RESERVATIONS.includes(reservation.status),
  );
  const incomingUnits =
    assigned.reduce((total, reservation) => total + reservation.quantity, 0) +
    shipments.reduce(
      (total, shipment) =>
        total + shipment.quantity - shipment.deliveredQuantity,
      0,
    );
  const receivedUnits = shipments.reduce(
    (total, shipment) => total + shipment.deliveredQuantity,
    0,
  );
  return (
    <div className="role-console">
      <RoleHero
        eyebrow="RECEIVER / INTAKE DESK"
        title="Ready for the right help."
        description="Keep demand current, then confirm what arrives."
      >
        <label className="field role-entity-select">
          Receiving point
          <select
            className="select"
            aria-label="Receiving point"
            value={receiver?.id ?? ""}
            disabled={busy || !state.receivers.length}
            onChange={(event) => setSelected(event.target.value)}
          >
            {state.receivers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </RoleHero>
      <Clock {...props} />
      {receiver ? (
        <>
          <ReceiverSettings key={receiver.id} receiver={receiver} {...props} />
          <div className="role-signal-grid" aria-label="Receiver snapshot">
            <RoleSignal
              label="Incoming"
              value={`${units(incomingUnits)} units`}
              detail="assigned or already collected"
              accent={incomingUnits > 0}
            />
            <RoleSignal
              label="Received"
              value={`${units(receivedUnits)} units`}
              detail="confirmed physical handoff"
            />
            <RoleSignal
              label="Latest arrival"
              value={formatTime(receiver.latestArrival)}
              detail="receiving deadline"
            />
          </div>
          <section className="role-register role-primary-register">
            <div className="role-section-title role-section-heading">
              <span className="eyebrow">AT YOUR DOOR</span>
              <h2>
                Incoming & received{" "}
                <span className="role-count">
                  {shipments.length + assigned.length}
                </span>
              </h2>
              <p>Confirm what arrives. Other changes can be reversed.</p>
            </div>
            {!shipments.length && !assigned.length && (
              <div className="role-empty">
                <Package size={24} />
                <div>
                  <h3>No incoming aid yet.</h3>
                  <p>
                    Update demand and facilities so dispatch can find a safe
                    route.
                  </p>
                </div>
              </div>
            )}
            {assigned.map((reservation) => (
              <article className="role-expected" key={reservation.id}>
                <Package size={19} />
                <div>
                  <strong>
                    {reservation.quantity}{" "}
                    {
                      AID_LABELS[
                        state.batches.find(
                          (batch) => batch.id === reservation.batchId,
                        )!.aidType
                      ]
                    }
                  </strong>
                  <p>
                    {
                      state.riders.find(
                        (rider) => rider.id === reservation.riderId,
                      )?.name
                    }{" "}
                    · assigned, not physically collected · pickup lease{" "}
                    {formatTime(reservation.leaseExpiresAt)}
                  </p>
                </div>
                <Status value={reservation.status} />
              </article>
            ))}
            {[...shipments].reverse().map((shipment) => (
              <ShipmentCard
                key={shipment.id}
                shipment={shipment}
                receiverView
                {...props}
              />
            ))}
          </section>
          <Compatibility receiver={receiver} state={state} />
        </>
      ) : (
        <div className="role-empty">
          No receiving points yet. Register one below.
        </div>
      )}
      <CreateReceiver
        key={state.receivers.map((item) => item.id).join("-")}
        act={props.act}
        busy={busy}
      />
    </div>
  );
}
