import { ACTIVE_RESERVATIONS, type Action, type ActionResult, type AidType, type Batch, type Capability, type Location, type OperationsState, type Receiver, type Reservation, type Shipment } from './types';
import { createSeed } from './seed';

export const SAFETY_BUFFER = 3;
const LEASE_MINUTES = 5;
const ABSOLUTE_PROGRESS_LIMIT = 10;
const AID_TYPES: AidType[] = ['COOKED_MEALS', 'RAW_RATIONS', 'SEALED_KITS', 'MEDICINE', 'INFANT_FORMULA'];
const CAPABILITIES: Capability[] = ['cleanWater', 'potableWater', 'cookingFuel', 'kitchen', 'servingArea', 'coldStorage', 'medicalRefrigeration', 'cleanContainers', 'medicalFacility'];
const DEFAULT_REQUIREMENTS: Record<AidType, Capability[]> = {
  COOKED_MEALS: ['servingArea'], RAW_RATIONS: ['cleanWater', 'cookingFuel', 'kitchen'], SEALED_KITS: [],
  MEDICINE: ['medicalFacility'], INFANT_FORMULA: ['potableWater', 'servingArea', 'cleanContainers'],
};
export interface Feasibility { ok: boolean; code: string; message: string; pickupEta: number; travelEta: number; maxQuantity: number }
type Decision = { ok: boolean; code: string; message: string };
const good = (message: string, code = 'OK'): Decision => ({ ok: true, code, message });
const bad = (code: string, message: string): Decision => ({ ok: false, code, message });
const active = (r: Reservation) => ACTIVE_RESERVATIONS.includes(r.status);
const remainder = (s: Shipment) => Math.max(0, s.quantity - s.deliveredQuantity);
const integer = (n: unknown, min = 0, max = 1_000_000): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const distance = (a: Location, b: Location) => Math.hypot(a.x - b.x, a.y - b.y);
const pickupMinutes = (a: Location, b: Location) => Math.max(2, Math.ceil(distance(a, b) / 2));
const travelMinutes = (a: Location, b: Location) => Math.max(4, Math.ceil(distance(a, b) / 2));
const required = (batch: Batch) => [...new Set([...DEFAULT_REQUIREMENTS[batch.aidType], ...batch.requirements])];
const donorFor = (state: OperationsState, batch: Batch) => state.donors.find(d => d.id === batch.donorId)!;
const reserved = (state: OperationsState, batchId: string, except?: string) => state.reservations.filter(r => r.batchId === batchId && r.id !== except && active(r)).reduce((n, r) => n + r.quantity, 0);
const picked = (state: OperationsState, batchId: string) => state.shipments.filter(s => s.batchId === batchId).reduce((n, s) => n + s.quantity, 0);
function allocated(state: OperationsState, receiverId: string, aidType?: AidType, exceptReservation?: string, exceptShipment?: string): number {
  return state.reservations.filter(r => active(r) && r.receiverId === receiverId && r.id !== exceptReservation && (!aidType || state.batches.find(b => b.id === r.batchId)?.aidType === aidType)).reduce((n, r) => n + r.quantity, 0)
    + state.shipments.filter(s => s.receiverId === receiverId && s.id !== exceptShipment && (!aidType || state.batches.find(b => b.id === s.batchId)?.aidType === aidType)).reduce((n, s) => n + remainder(s), 0);
}
function riderLoad(state: OperationsState, riderId: string, exceptReservation?: string, exceptShipment?: string): number {
  return state.reservations.filter(r => r.riderId === riderId && r.id !== exceptReservation && active(r)).reduce((n, r) => n + r.quantity, 0)
    + state.shipments.filter(s => s.riderId === riderId && s.id !== exceptShipment).reduce((n, s) => n + remainder(s), 0);
}
function riderProgress(state: OperationsState, riderId: string) {
  state.riders.find(r => r.id === riderId)!.lastHeartbeatAt = state.now;
  for (const shipment of state.shipments.filter(s => s.riderId === riderId && s.status === 'IN_TRANSIT')) shipment.lastHeartbeatAt = state.now;
}
function receiverCheck(state: OperationsState, batch: Batch, receiver: Receiver, quantity: number, arrival: number, exceptReservation?: string, exceptShipment?: string): Decision {
  if (!receiver.isOpen) return bad('RECEIVER_CLOSED', `${receiver.name} is closed.`);
  const missing = required(batch).filter(c => !receiver.capabilities[c]);
  if (missing.length) return bad('INCOMPATIBLE_RECEIVER', `${receiver.name} needs ${missing.join(', ')} for this aid.`);
  if (arrival + SAFETY_BUFFER >= batch.safeUntil) return bad('UNSAFE_ARRIVAL', 'Arrival plus the three-minute safety buffer must be strictly before expiry.');
  if (arrival > receiver.latestArrival) return bad('RECEIVER_DEADLINE', `${receiver.name} cannot receive this late.`);
  if (quantity > receiver.demand[batch.aidType] - allocated(state, receiver.id, batch.aidType, exceptReservation, exceptShipment)) return bad('DEMAND_EXCEEDED', 'This quantity exceeds uncommitted receiver demand.');
  if (quantity > receiver.storageCapacity - receiver.currentStorage - allocated(state, receiver.id, undefined, exceptReservation, exceptShipment)) return bad('STORAGE_EXCEEDED', 'Receiver storage is already committed to delivered stock and incoming aid.');
  return good('Receiver can safely accept this aid.');
}

/** Pure preflight for a new allocation. Quantities are whole physical units. */
export function feasibility(state: OperationsState, batchId: string, riderId: string, receiverId: string, quantity?: number): Feasibility {
  const result = (decision: Decision, pickupEta = 0, travelEta = 0, maxQuantity = 0): Feasibility => ({ ...decision, pickupEta, travelEta, maxQuantity });
  if (typeof batchId !== 'string' || typeof riderId !== 'string' || typeof receiverId !== 'string' || (quantity !== undefined && !integer(quantity, 1))) return result(bad('INVALID_INPUT', 'Use valid IDs and a positive whole quantity.'));
  const batch = state.batches.find(b => b.id === batchId);
  const rider = state.riders.find(r => r.id === riderId);
  const receiver = state.receivers.find(r => r.id === receiverId);
  if (!batch || !rider || !receiver) return result(bad('NOT_FOUND', 'Batch, rider or receiver was not found.'));
  const donor = donorFor(state, batch);
  if (!donor) return result(bad('NOT_FOUND', 'Donor was not found.'));
  const pickupEta = pickupMinutes(rider.location, donor.location);
  const travelEta = travelMinutes(donor.location, receiver.location);
  const arrival = Math.max(state.now + pickupEta, batch.readyAt) + travelEta;
  const maxQuantity = Math.max(0, Math.min(batch.quantity - reserved(state, batch.id) - picked(state, batch.id), rider.capacity - riderLoad(state, rider.id), receiver.demand[batch.aidType] - allocated(state, receiver.id, batch.aidType), receiver.storageCapacity - receiver.currentStorage - allocated(state, receiver.id)));
  const answer = (decision: Decision) => result(decision, pickupEta, travelEta, maxQuantity);
  if (batch.unavailable || state.now >= batch.safeUntil) return answer(bad('BATCH_UNAVAILABLE', 'The donor batch is unavailable or expired.'));
  if (!rider.online) return answer(bad('RIDER_OFFLINE', 'The rider is offline.'));
  const existing = state.reservations.filter(r => active(r) && r.riderId === rider.id);
  // A rider may bundle fresh assignments from one donor; total units still share one capacity.
  const bundle = existing.length > 0 && existing.every(r => r.batchId === batch.id && r.status === 'ASSIGNED');
  if (state.shipments.some(s => s.riderId === rider.id && remainder(s) > 0) || (existing.length > 0 && !bundle)) return answer(bad('RIDER_BUSY', 'The rider is already carrying aid or progressing another pickup.'));
  if (!rider.available && !bundle) return answer(bad('RIDER_UNAVAILABLE', 'The rider is unavailable.'));
  if (existing.some(r => r.batchId === batch.id && r.receiverId === receiver.id)) return answer(bad('DUPLICATE_RESERVATION', 'This rider already has an allocation for this receiver and batch.'));
  const amount = quantity ?? maxQuantity;
  const compatible = receiverCheck(state, batch, receiver, amount || 1, arrival);
  if (!compatible.ok) return answer(compatible);
  if (amount > batch.quantity - reserved(state, batch.id) - picked(state, batch.id)) return answer(bad('STOCK_EXCEEDED', 'This quantity exceeds unclaimed donor stock.'));
  if (amount > rider.capacity - riderLoad(state, rider.id)) return answer(bad('CAPACITY_EXCEEDED', 'This quantity exceeds the rider’s remaining capacity.'));
  if (maxQuantity < 1) return answer(bad('NO_QUANTITY', 'There is no uncommitted quantity on this route.'));
  return answer(good(`Safe route: ${pickupEta} min pickup, ${travelEta} min delivery; up to ${maxQuantity} units.`));
}

function nextId(state: OperationsState, prefix: string): string {
  const entities = [...state.batches, ...state.riders, ...state.receivers, ...state.reservations, ...state.shipments, ...state.events];
  let id: string;
  do { id = `${prefix}-${++state.sequence}`; } while (entities.some(e => e.id === id));
  return id;
}
function event(state: OperationsState, type: string, entityId: string, message: string, severity: 'info' | 'success' | 'warning' | 'danger' = 'info') {
  state.events.push({ id: nextId(state, 'event'), timestamp: state.now, type, entityId, message, severity });
}
function phase(state: OperationsState, reservation: Reservation): Reservation['status'] {
  if (reservation.status !== 'WARNING_INACTIVE') return reservation.status;
  for (let i = state.events.length - 1; i >= 0; i--) {
    const e = state.events[i];
    if (e.entityId !== reservation.id) continue;
    if (e.type === 'DONOR_ARRIVED') return 'ARRIVED_AT_DONOR';
    if (e.type === 'PICKUP_STARTED') return 'EN_ROUTE_TO_DONOR';
    if (e.type === 'RESERVATION_ACCEPTED') return 'ACKNOWLEDGED';
    if (e.type === 'RESERVATION_ASSIGNED') return 'ASSIGNED';
  }
  return 'ASSIGNED';
}
function refreshAvailability(state: OperationsState, riderId: string) {
  const rider = state.riders.find(r => r.id === riderId)!;
  rider.available = rider.online && riderLoad(state, riderId) === 0;
}
function release(state: OperationsState, reservation: Reservation, reason: string, timeout = false) {
  reservation.status = timeout ? 'TIMED_OUT' : 'CANCELLED';
  event(state, 'RESERVATION_RELEASED', reservation.id, `${reservation.quantity} units released before pickup. ${reason}`, 'warning');
  if (timeout) {
    const rider = state.riders.find(r => r.id === reservation.riderId)!;
    rider.online = false;
    rider.available = false;
    event(state, 'RESERVATION_TIMED_OUT', reservation.id, 'Lease expired; rider marked offline to prevent immediate reissue.', 'warning');
  } else refreshAvailability(state, reservation.riderId);
}
function leaseCap(state: OperationsState, reservation: Reservation): number {
  const batch = state.batches.find(b => b.id === reservation.batchId)!;
  const receiver = state.receivers.find(r => r.id === reservation.receiverId)!;
  const latestReassignment = Math.min(batch.safeUntil - SAFETY_BUFFER - 1, receiver.latestArrival) - reservation.travelEta - reservation.pickupEta;
  return Math.min(reservation.pickupDeadline, latestReassignment);
}
function touch(state: OperationsState, reservation: Reservation) {
  reservation.lastHeartbeatAt = state.now;
  reservation.leaseExpiresAt = Math.min(state.now + LEASE_MINUTES, leaseCap(state, reservation));
  const rider = state.riders.find(r => r.id === reservation.riderId)!;
  rider.lastHeartbeatAt = state.now;
  if (reservation.status === 'WARNING_INACTIVE') reservation.status = phase(state, reservation);
}
function reserve(state: OperationsState, batchId: string, riderId: string, receiverId: string, quantity: number): Decision {
  const check = feasibility(state, batchId, riderId, receiverId, quantity);
  if (!check.ok) return check;
  const batch = state.batches.find(b => b.id === batchId)!;
  const receiver = state.receivers.find(r => r.id === receiverId)!;
  const deadline = Math.min(state.now + ABSOLUTE_PROGRESS_LIMIT, batch.safeUntil - SAFETY_BUFFER - 1 - check.travelEta, receiver.latestArrival - check.travelEta);
  const reservation: Reservation = { id: '', batchId, riderId, receiverId, quantity, status: 'ASSIGNED', createdAt: state.now, lastHeartbeatAt: state.now, leaseExpiresAt: 0, pickupDeadline: deadline, pickupEta: check.pickupEta, travelEta: check.travelEta };
  reservation.leaseExpiresAt = Math.min(state.now + LEASE_MINUTES, leaseCap(state, reservation));
  if (reservation.leaseExpiresAt <= state.now) return bad('NO_LEASE_WINDOW', 'No safe time remains for a bounded pickup lease and possible replacement.');
  reservation.id = nextId(state, 'reservation');
  state.reservations.push(reservation);
  state.riders.find(r => r.id === riderId)!.available = false;
  event(state, 'RESERVATION_ASSIGNED', reservation.id, `${quantity} ${batch.aidType.toLowerCase().replaceAll('_', ' ')} assigned to ${state.riders.find(r => r.id === riderId)!.name} for ${receiver.name}. Lease ends in ${reservation.leaseExpiresAt - state.now} min.`, 'success');
  return good(`${quantity} units reserved.`, 'RESERVED');
}

function dispatch(state: OperationsState, batchId?: string, replacement = false, budget = Infinity): number {
  let count = 0;
  const batches = state.batches.filter(b => !batchId || b.id === batchId).sort((a, b) => a.safeUntil - b.safeUntil || a.id.localeCompare(b.id));
  for (const batch of batches) {
    // A new rider gets the least-served receiver at the earliest deadline, then fills residual capacity.
    for (const rider of state.riders) {
      for (let attempt = 0; attempt < state.receivers.length; attempt++) {
        if (budget <= 0) return count;
        const options = state.receivers.map(receiver => ({ receiver, check: feasibility(state, batch.id, rider.id, receiver.id) })).filter(o => o.check.ok && o.check.maxQuantity > 0);
        options.sort((a, b) => a.receiver.latestArrival - b.receiver.latestArrival
          || allocated(state, a.receiver.id, batch.aidType) / Math.max(1, a.receiver.demand[batch.aidType]) - allocated(state, b.receiver.id, batch.aidType) / Math.max(1, b.receiver.demand[batch.aidType])
          || a.check.travelEta - b.check.travelEta || a.receiver.id.localeCompare(b.receiver.id));
        const option = options[0];
        if (!option) break;
        const quantity = Math.min(option.check.maxQuantity, budget);
        const result = reserve(state, batch.id, rider.id, option.receiver.id, quantity);
        if (!result.ok) break;
        count++;
        budget -= quantity;
        if (replacement) event(state, 'RESERVATION_REASSIGNED', state.reservations.at(-1)!.id, 'Central dispatch assigned released stock to an available replacement rider.', 'success');
      }
    }
  }
  return count;
}

function physicalLocation(state: OperationsState, shipment: Shipment): Location {
  return state.riders.find(r => r.id === shipment.riderId)!.location;
}
function freeze(state: OperationsState, shipment: Shipment, reason: string) {
  shipment.status = 'RECOVERY_REQUIRED';
  shipment.reason = reason;
  event(state, 'RECOVERY_REQUIRED', shipment.id, `${reason} ${remainder(shipment)} units remain in rider custody; donor stock is not restored.`, 'danger');
}
function manifestPlan(state: OperationsState, shipment: Shipment, receiver: Receiver, delay = 0): { shipment: Shipment; eta: number }[] | undefined {
  const stops = [...state.shipments.filter(s => s.id !== shipment.id && s.riderId === shipment.riderId && s.status === 'IN_TRANSIT' && remainder(s) > 0), shipment];
  const destination = (s: Shipment) => s.id === shipment.id ? receiver : state.receivers.find(r => r.id === s.receiverId)!;
  stops.sort((a, b) => destination(a).latestArrival - destination(b).latestArrival || a.eta - b.eta || a.id.localeCompare(b.id));
  let origin = physicalLocation(state, shipment); let eta = state.now + delay;
  const plan: { shipment: Shipment; eta: number }[] = [];
  for (const stop of stops) {
    const target = destination(stop);
    eta += travelMinutes(origin, target.location);
    const batch = state.batches.find(b => b.id === stop.batchId)!;
    if (eta + SAFETY_BUFFER >= batch.safeUntil || eta > target.latestArrival) return undefined;
    plan.push({ shipment: stop, eta }); origin = target.location;
  }
  return plan;
}
function fallback(state: OperationsState, shipment: Shipment, origin: Location, extra = 0, includeManifest = false): { receiver: Receiver; eta: number; plan?: { shipment: Shipment; eta: number }[] } | undefined {
  const batch = state.batches.find(b => b.id === shipment.batchId)!;
  return state.receivers.filter(r => r.id !== shipment.receiverId).map(receiver => {
    const plan = includeManifest ? manifestPlan(state, shipment, receiver, extra) : undefined;
    return { receiver, eta: includeManifest ? plan?.find(p => p.shipment.id === shipment.id)?.eta ?? Infinity : state.now + extra + travelMinutes(origin, receiver.location), plan };
  })
    .filter(o => receiverCheck(state, batch, o.receiver, remainder(shipment), o.eta, undefined, shipment.id).ok)
    .sort((a, b) => a.eta - b.eta || a.receiver.latestArrival - b.receiver.latestArrival || a.receiver.id.localeCompare(b.receiver.id))[0];
}
function reroute(state: OperationsState, shipment: Shipment, delay = 0): Decision {
  const route = fallback(state, shipment, physicalLocation(state, shipment), delay, true);
  if (!route) { freeze(state, shipment, 'No safe compatible fallback can accept the full physical remainder.'); return bad('NO_SAFE_FALLBACK', 'No safe fallback; physical aid is frozen for recovery.'); }
  const old = shipment.receiverId;
  shipment.reroutedFrom = old;
  shipment.receiverId = route.receiver.id;
  shipment.eta = route.eta;
  for (const stop of route.plan ?? []) stop.shipment.eta = stop.eta;
  shipment.status = 'IN_TRANSIT';
  shipment.reason = `Rerouted from ${state.receivers.find(r => r.id === old)!.name}.`;
  event(state, 'SHIPMENT_REROUTED', shipment.id, `${remainder(shipment)} undelivered units rerouted in full to ${route.receiver.name}; ETA in ${route.eta - state.now} min.`, 'warning');
  return good(`Rerouted to ${route.receiver.name}.`, 'REROUTED');
}
function expireBatch(state: OperationsState, batch: Batch) {
  batch.unavailable = true;
  for (const r of state.reservations.filter(r => r.batchId === batch.id && active(r))) release(state, r, 'Batch expired.');
  for (const s of state.shipments.filter(s => s.batchId === batch.id && remainder(s) > 0 && s.status !== 'EXPIRED')) {
    s.status = 'EXPIRED'; s.reason = 'Batch expired while in physical custody.';
    event(state, 'SHIPMENT_EXPIRED', s.id, `${remainder(s)} expired units remain in custody; neither demand nor donor stock is restored.`, 'danger');
  }
  if (!state.events.some(e => e.type === 'BATCH_EXPIRED' && e.entityId === batch.id)) event(state, 'BATCH_EXPIRED', batch.id, 'Batch expired. Pickup is blocked and all physical custody is retained.', 'danger');
}
function reevaluate(state: OperationsState) {
  const released = new Map<string, number>();
  for (const r of state.reservations.filter(active)) {
    const batch = state.batches.find(b => b.id === r.batchId)!;
    const receiver = state.receivers.find(x => x.id === r.receiverId)!;
    const stage = phase(state, r);
    const started = [...state.events].reverse().find(e => e.entityId === r.id && e.type === 'PICKUP_STARTED')?.timestamp ?? state.now;
    const remainingPickup = stage === 'ARRIVED_AT_DONOR' ? 0 : stage === 'EN_ROUTE_TO_DONOR' ? Math.max(0, started + r.pickupEta - state.now) : r.pickupEta;
    const arrival = Math.max(state.now + remainingPickup, batch.readyAt) + r.travelEta;
    const check = receiverCheck(state, batch, receiver, r.quantity, arrival, r.id);
    if (!check.ok || batch.unavailable) {
      release(state, r, check.ok ? 'Donor unavailable.' : check.message);
      released.set(batch.id, (released.get(batch.id) ?? 0) + r.quantity);
    }
  }
  for (const s of state.shipments.filter(s => remainder(s) > 0 && (s.status === 'IN_TRANSIT' || s.status === 'REROUTE_REQUIRED'))) {
    const batch = state.batches.find(b => b.id === s.batchId)!;
    const receiver = state.receivers.find(r => r.id === s.receiverId)!;
    const check = receiverCheck(state, batch, receiver, remainder(s), Math.max(state.now, s.eta), undefined, s.id);
    if (!check.ok) {
      s.status = 'REROUTE_REQUIRED'; s.reason = check.message;
      event(state, 'REROUTE_REQUIRED', s.id, check.message, 'warning');
      reroute(state, s);
    }
  }
  for (const [batchId, quantity] of released) dispatch(state, batchId, true, quantity);
}
function advance(state: OperationsState, minutes: number) {
  for (let tick = 0; tick < minutes; tick++) {
    state.now++;
    // Move once per rider toward the next simulated stop. Frozen custody never moves itself.
    for (const rider of state.riders) {
      const next = state.shipments.filter(s => s.riderId === rider.id && s.status === 'IN_TRANSIT' && remainder(s) > 0 && s.eta >= state.now).sort((a, b) => a.eta - b.eta)[0];
      if (next) {
        const target = state.receivers.find(r => r.id === next.receiverId)!.location;
        const fraction = 1 / Math.max(1, next.eta - state.now + 1);
        rider.location = { x: rider.location.x + (target.x - rider.location.x) * fraction, y: rider.location.y + (target.y - rider.location.y) * fraction, label: next.eta === state.now ? target.label : `En route to ${target.label}` };
      }
    }
    for (const batch of state.batches.filter(b => state.now >= b.safeUntil)) expireBatch(state, batch);
    const released = new Map<string, number>();
    for (const r of state.reservations.filter(active)) {
      if (state.now >= r.leaseExpiresAt || state.now >= r.pickupDeadline || !state.riders.find(x => x.id === r.riderId)!.online) {
        release(state, r, 'Pickup lease or absolute progress deadline elapsed.', true); released.set(r.batchId, (released.get(r.batchId) ?? 0) + r.quantity);
      } else if (state.now - r.lastHeartbeatAt >= 3 && r.status !== 'WARNING_INACTIVE') {
        r.status = 'WARNING_INACTIVE';
        event(state, 'RESERVATION_INACTIVE_WARNING', r.id, 'No progress for three minutes; pickup lease will expire without an update.', 'warning');
      }
    }
    for (const s of state.shipments.filter(s => (s.status === 'IN_TRANSIT' || s.status === 'REROUTE_REQUIRED') && remainder(s) > 0)) {
      if (state.now - s.lastHeartbeatAt > 7) {
        const rider = state.riders.find(r => r.id === s.riderId)!;
        rider.online = false; rider.available = false;
        freeze(state, s, 'Rider inactive for more than seven minutes after pickup.');
      } else if (state.now - s.lastHeartbeatAt === 3) {
        event(state, 'SHIPMENT_INACTIVE_WARNING', s.id, 'No rider update for three minutes after pickup; physical custody remains committed.', 'warning');
      }
    }
    for (const [batchId, quantity] of released) dispatch(state, batchId, true, quantity);
  }
}

const FIELDS: Record<Action['type'], string[]> = {
  RESET: [], ADVANCE_TIME: ['minutes'], CREATE_BATCH: ['aidType', 'quantity', 'donorId', 'readyIn', 'expiresIn', 'requirements', 'notes'], UPDATE_BATCH: ['batchId', 'quantity', 'unavailable'], AUTO_DISPATCH: ['batchId'], RESERVE: ['batchId', 'riderId', 'receiverId', 'quantity'],
  ACCEPT: ['reservationId'], START_PICKUP: ['reservationId'], ARRIVE: ['reservationId'], HEARTBEAT: ['reservationId'], DECLINE: ['reservationId'], PICKUP: ['reservationId', 'quantity'], DELIVER: ['shipmentId', 'quantity'], UPDATE_RIDER: ['riderId', 'capacity', 'available', 'online'], RIDER_FAILURE: ['riderId'], REPORT_DELAY: ['shipmentId', 'minutes'], RECOVER: ['shipmentId', 'riderId'], REROUTE: ['shipmentId'], UPDATE_RECEIVER: ['receiverId', 'isOpen', 'aidType', 'demand', 'capabilities', 'storageCapacity'], CREATE_RECEIVER: ['name', 'quantity', 'aidType', 'storageCapacity', 'capabilities', 'latestIn'], EXPIRE_BATCH: ['batchId'],
};
function validate(action: unknown): Decision {
  if (!record(action) || typeof action.type !== 'string' || !Object.hasOwn(FIELDS, action.type)) return bad('INVALID_ACTION', 'Unknown or malformed action.');
  const type = action.type as Action['type'];
  if (Object.keys(action).some(k => k !== 'type' && !FIELDS[type].includes(k))) return bad('INVALID_INPUT', 'Action contains an unsupported field.');
  const optional: Record<string, string[]> = { CREATE_BATCH: ['requirements', 'notes'], UPDATE_BATCH: ['quantity', 'unavailable'], AUTO_DISPATCH: ['batchId'], UPDATE_RIDER: ['capacity', 'available', 'online'], UPDATE_RECEIVER: ['isOpen', 'aidType', 'demand', 'capabilities', 'storageCapacity'] };
  for (const key of FIELDS[type]) {
    const value = action[key];
    if (value === undefined) { if (optional[type]?.includes(key)) continue; return bad('INVALID_INPUT', `${key} is required.`); }
    if (key.endsWith('Id') && (typeof value !== 'string' || !value.trim() || value.length > 120)) return bad('INVALID_INPUT', `${key} must be a valid ID.`);
    if (['quantity', 'capacity', 'minutes', 'expiresIn', 'latestIn'].includes(key) && !integer(value, key === 'quantity' && type === 'UPDATE_BATCH' ? 0 : 1, ['minutes', 'expiresIn', 'latestIn'].includes(key) ? 10080 : 1_000_000)) return bad('INVALID_INPUT', `${key} must be a bounded whole number in the permitted range.`);
    if (['readyIn', 'demand', 'storageCapacity'].includes(key) && !integer(value)) return bad('INVALID_INPUT', `${key} must be a nonnegative bounded whole number.`);
    if (['unavailable', 'available', 'online', 'isOpen'].includes(key) && typeof value !== 'boolean') return bad('INVALID_INPUT', `${key} must be a boolean.`);
    if (key === 'aidType' && !AID_TYPES.includes(value as AidType)) return bad('INVALID_INPUT', 'Unknown aid type.');
    if (key === 'requirements' && (!Array.isArray(value) || value.length > CAPABILITIES.length || value.some(c => !CAPABILITIES.includes(c)))) return bad('INVALID_INPUT', 'Unknown aid capability requirement.');
    if (key === 'capabilities' && (!record(value) || Object.entries(value).some(([k, v]) => !CAPABILITIES.includes(k as Capability) || typeof v !== 'boolean') || (type === 'CREATE_RECEIVER' && CAPABILITIES.some(k => typeof value[k] !== 'boolean')))) return bad('INVALID_INPUT', 'Capabilities must contain known boolean capability flags.');
    if (['notes', 'name'].includes(key) && (typeof value !== 'string' || value.length > (key === 'name' ? 120 : 2000) || (key === 'name' && !value.trim()))) return bad('INVALID_INPUT', `${key} must be valid text.`);
  }
  if (type === 'CREATE_BATCH' && (action.expiresIn as number) <= (action.readyIn as number) + SAFETY_BUFFER) return bad('INVALID_INPUT', 'Expiry must leave a safety window after readiness.');
  if (type === 'UPDATE_RECEIVER' && (action.demand !== undefined) !== (action.aidType !== undefined)) return bad('INVALID_INPUT', 'A demand update requires both aidType and demand.');
  if (['UPDATE_BATCH', 'UPDATE_RIDER', 'UPDATE_RECEIVER'].includes(type) && !FIELDS[type].some(k => !k.endsWith('Id') && action[k] !== undefined)) return bad('INVALID_INPUT', 'Provide at least one field to update.');
  return good('Validated.');
}

function execute(state: OperationsState, action: Exclude<Action, { type: 'RESET' }>): Decision {
  switch (action.type) {
    case 'ADVANCE_TIME': advance(state, action.minutes); event(state, 'TIME_ADVANCED', 'operations', `Simulation advanced ${action.minutes} min.`); return good(`Advanced ${action.minutes} minutes.`);
    case 'CREATE_BATCH': {
      if (!state.donors.some(d => d.id === action.donorId)) return bad('NOT_FOUND', 'Donor not found.');
      const batch: Batch = { id: nextId(state, 'batch'), donorId: action.donorId, aidType: action.aidType, quantity: action.quantity, readyAt: state.now + action.readyIn, safeUntil: state.now + action.expiresIn, requirements: [...new Set([...DEFAULT_REQUIREMENTS[action.aidType], ...(action.requirements ?? [])])], notes: action.notes ?? '', unavailable: false };
      state.batches.push(batch); event(state, 'BATCH_CREATED', batch.id, `${batch.quantity} units of ${batch.aidType.toLowerCase().replaceAll('_', ' ')} posted.`, 'success'); return good('Batch posted.', 'BATCH_CREATED');
    }
    case 'UPDATE_BATCH': {
      const batch = state.batches.find(b => b.id === action.batchId); if (!batch) return bad('NOT_FOUND', 'Batch not found.');
      const committed = reserved(state, batch.id) + picked(state, batch.id);
      if (action.quantity !== undefined && action.quantity < committed) return bad('COMMITTED_STOCK', `Quantity cannot fall below ${committed} reserved or physically picked-up units.`);
      if (action.quantity !== undefined) batch.quantity = action.quantity;
      if (action.unavailable !== undefined) batch.unavailable = action.unavailable;
      event(state, 'BATCH_UPDATED', batch.id, 'Donor batch updated.'); reevaluate(state); return good('Batch updated.');
    }
    case 'AUTO_DISPATCH': {
      if (action.batchId && !state.batches.some(b => b.id === action.batchId)) return bad('NOT_FOUND', 'Batch not found.');
      const count = dispatch(state, action.batchId); event(state, 'AUTO_DISPATCH', action.batchId ?? 'operations', `${count} capacity-checked allocations created, earliest deadlines first.`, count ? 'success' : 'warning');
      return count ? good(`${count} allocations dispatched.`, 'DISPATCHED') : bad('NO_FEASIBLE_ASSIGNMENTS', 'No safe uncommitted route is currently available.');
    }
    case 'RESERVE': return reserve(state, action.batchId, action.riderId, action.receiverId, action.quantity);
    case 'ACCEPT': case 'START_PICKUP': case 'ARRIVE': case 'HEARTBEAT': case 'DECLINE': case 'PICKUP': {
      const r = state.reservations.find(r => r.id === action.reservationId); if (!r) return bad('NOT_FOUND', 'Reservation not found.');
      const rider = state.riders.find(x => x.id === r.riderId)!;
      if (action.type === 'HEARTBEAT' && r.status === 'PICKUP_CONFIRMED') {
        const shipment = state.shipments.find(s => s.reservationId === r.id);
        if (!shipment || shipment.status !== 'IN_TRANSIT') return bad('INVALID_TRANSITION', 'Only an active in-transit shipment can send a progress heartbeat.');
        const carrier = state.riders.find(r => r.id === shipment.riderId)!;
        if (!carrier.online) return bad('RIDER_OFFLINE', 'Offline rider cannot heartbeat.');
        riderProgress(state, carrier.id); event(state, 'SHIPMENT_HEARTBEAT', shipment.id, 'Current custody rider progress confirmed across the physical manifest.'); return good('Progress recorded.');
      }
      if (!active(r)) return bad('INVALID_TRANSITION', 'Reservation is no longer active.');
      const stage = phase(state, r);
      if (action.type === 'DECLINE') { release(state, r, 'Rider declined.'); rider.available = false; event(state, 'RESERVATION_DECLINED', r.id, 'Rider declined and is unavailable until explicitly enabled.', 'warning'); dispatch(state, r.batchId, true, r.quantity); return good('Reservation declined and stock offered to replacement riders.'); }
      if (!rider.online) return bad('RIDER_OFFLINE', 'Offline rider cannot progress a pickup.');
      if (action.type === 'HEARTBEAT') { touch(state, r); event(state, 'RESERVATION_HEARTBEAT', r.id, 'Progress heartbeat received; absolute pickup deadline remains fixed.'); return good('Progress recorded.'); }
      if (action.type === 'ACCEPT') {
        if (stage !== 'ASSIGNED') return bad('INVALID_TRANSITION', 'Only an assigned reservation can be accepted.');
        r.status = 'ACKNOWLEDGED'; touch(state, r); event(state, 'RESERVATION_ACCEPTED', r.id, 'Rider acknowledged the pickup.'); return good('Pickup accepted.');
      }
      if (action.type === 'START_PICKUP') {
        if (stage !== 'ACKNOWLEDGED') return bad('INVALID_TRANSITION', 'Accept the reservation before starting pickup.');
        r.status = 'EN_ROUTE_TO_DONOR'; touch(state, r); event(state, 'PICKUP_STARTED', r.id, `Rider departed; donor arrival takes ${r.pickupEta} min.`); return good('En route to donor.');
      }
      const batch = state.batches.find(b => b.id === r.batchId)!;
      if (action.type === 'ARRIVE') {
        if (stage !== 'EN_ROUTE_TO_DONOR') return bad('INVALID_TRANSITION', 'Start the pickup journey before arrival.');
        const started = [...state.events].reverse().find(e => e.entityId === r.id && e.type === 'PICKUP_STARTED')?.timestamp;
        if (started === undefined || state.now < started + r.pickupEta) return bad('PICKUP_NOT_REACHED', 'The simulated pickup travel time has not elapsed.');
        rider.location = { ...donorFor(state, batch).location }; r.status = 'ARRIVED_AT_DONOR'; touch(state, r); event(state, 'DONOR_ARRIVED', r.id, 'Rider arrived at donor; readiness and quantity will be verified at handoff.'); return good('Arrival recorded.');
      }
      if (action.type !== 'PICKUP') return bad('INVALID_TRANSITION', 'Unsupported pickup progress transition.');
      if (stage !== 'ARRIVED_AT_DONOR') return bad('INVALID_TRANSITION', 'Pickup requires confirmed arrival at the donor.');
      if (state.now < batch.readyAt) return bad('BATCH_NOT_READY', 'Donor has not reached the batch ready time.');
      if (batch.unavailable || state.now >= batch.safeUntil) return bad('BATCH_UNAVAILABLE', 'Batch is unavailable or expired.');
      if (action.quantity > r.quantity) return bad('RESERVATION_EXCEEDED', 'Pickup cannot exceed this reservation.');
      const receiver = state.receivers.find(x => x.id === r.receiverId)!;
      if (action.quantity + riderLoad(state, rider.id, r.id) > rider.capacity) return bad('CAPACITY_EXCEEDED', 'Pickup exceeds total rider capacity.');
      const check = receiverCheck(state, batch, receiver, action.quantity, state.now + r.travelEta, r.id); if (!check.ok) return check;
      const shipment: Shipment = { id: '', batchId: r.batchId, reservationId: r.id, riderId: r.riderId, receiverId: r.receiverId, quantity: action.quantity, deliveredQuantity: 0, pickedUpAt: state.now, lastHeartbeatAt: state.now, eta: state.now + r.travelEta, status: 'IN_TRANSIT' };
      // Bundled pickups use a sequential, deadline-first delivery route rather than teleporting between receivers.
      const route = [...state.shipments.filter(s => s.riderId === rider.id && s.status === 'IN_TRANSIT' && remainder(s) > 0), shipment].sort((a, b) => state.receivers.find(x => x.id === a.receiverId)!.latestArrival - state.receivers.find(x => x.id === b.receiverId)!.latestArrival || a.eta - b.eta);
      let origin = rider.location; let eta = state.now;
      const planned: { shipment: Shipment; eta: number }[] = [];
      for (const stop of route) {
        const target = state.receivers.find(x => x.id === stop.receiverId)!;
        eta += travelMinutes(origin, target.location);
        const stopBatch = state.batches.find(x => x.id === stop.batchId)!;
        if (eta + SAFETY_BUFFER >= stopBatch.safeUntil || eta > target.latestArrival) return bad('UNSAFE_BUNDLED_ROUTE', 'The complete physical rider manifest cannot reach all stops safely.');
        planned.push({ shipment: stop, eta }); origin = target.location;
      }
      shipment.id = nextId(state, 'shipment'); r.status = 'PICKUP_CONFIRMED'; r.lastHeartbeatAt = state.now;
      state.shipments.push(shipment); for (const stop of planned) stop.shipment.eta = stop.eta;
      riderProgress(state, rider.id); rider.available = false;
      event(state, 'PICKUP_CONFIRMED', shipment.id, `${shipment.quantity} units physically picked up. Custody has moved from donor to rider.`, 'success');
      if (action.quantity < r.quantity) event(state, 'PARTIAL_PICKUP_RELEASED', r.id, `${r.quantity - action.quantity} uncollected units released back to donor availability.`, 'warning');
      return good(`${shipment.quantity} units picked up.`, 'PICKED_UP');
    }
    case 'DELIVER': {
      const s = state.shipments.find(s => s.id === action.shipmentId); if (!s) return bad('NOT_FOUND', 'Shipment not found.');
      if (s.status !== 'IN_TRANSIT') return bad('INVALID_TRANSITION', 'Only active in-transit custody can be delivered; recovery and expired shipments are frozen.');
      if (state.now < s.eta) return bad('DELIVERY_NOT_REACHED', 'The simulated delivery arrival time has not elapsed.');
      if (action.quantity > remainder(s)) return bad('SHIPMENT_EXCEEDED', 'Delivery cannot exceed the physical undelivered remainder.');
      const batch = state.batches.find(b => b.id === s.batchId)!;
      const receiver = state.receivers.find(r => r.id === s.receiverId)!;
      const check = receiverCheck(state, batch, receiver, remainder(s), state.now, undefined, s.id); if (!check.ok) return check;
      s.deliveredQuantity += action.quantity; s.lastHeartbeatAt = state.now;
      receiver.demand[batch.aidType] -= action.quantity; receiver.currentStorage += action.quantity;
      const rider = state.riders.find(r => r.id === s.riderId)!; rider.location = { ...receiver.location }; riderProgress(state, rider.id);
      if (!remainder(s)) { s.status = 'DELIVERED'; s.deliveredAt = state.now; }
      refreshAvailability(state, rider.id);
      event(state, remainder(s) ? 'PARTIAL_DELIVERY' : 'DELIVERY_CONFIRMED', s.id, `${action.quantity} units received by ${receiver.name}; ${remainder(s)} remain in rider custody.`, 'success'); return good(`${action.quantity} units delivered.`, 'DELIVERED');
    }
    case 'UPDATE_RIDER': case 'RIDER_FAILURE': {
      const rider = state.riders.find(r => r.id === action.riderId); if (!rider) return bad('NOT_FOUND', 'Rider not found.');
      if (action.type === 'UPDATE_RIDER') {
        if (action.capacity !== undefined && action.capacity < riderLoad(state, rider.id)) return bad('COMMITTED_CAPACITY', 'Capacity cannot fall below reserved and physically carried units.');
        if (action.capacity !== undefined) rider.capacity = action.capacity;
        if (action.online !== undefined) rider.online = action.online;
        if (action.available !== undefined) rider.available = action.available;
        if (!rider.online) rider.available = false;
      } else { rider.online = false; rider.available = false; }
      const interruption = action.type === 'RIDER_FAILURE' || !rider.online || (action.type === 'UPDATE_RIDER' && action.available === false);
      if (interruption) {
        const released = new Map<string, number>();
        for (const r of state.reservations.filter(r => active(r) && r.riderId === rider.id)) { release(state, r, 'Rider became unavailable.'); released.set(r.batchId, (released.get(r.batchId) ?? 0) + r.quantity); }
        rider.available = false;
        for (const s of state.shipments.filter(s => s.riderId === rider.id && remainder(s) > 0 && s.status !== 'EXPIRED' && s.status !== 'RECOVERY_REQUIRED')) freeze(state, s, 'Rider reported unavailable after pickup.');
        for (const [batchId, quantity] of released) dispatch(state, batchId, true, quantity);
      }
      event(state, action.type === 'RIDER_FAILURE' ? 'RIDER_FAILURE' : 'RIDER_UPDATED', rider.id, interruption ? 'Rider unavailable; pre-pickup stock released and physical custody protected.' : 'Rider availability or capacity updated.', interruption ? 'warning' : 'info'); return good('Rider updated.');
    }
    case 'REPORT_DELAY': {
      const s = state.shipments.find(s => s.id === action.shipmentId); if (!s) return bad('NOT_FOUND', 'Shipment not found.');
      if (s.status !== 'IN_TRANSIT') return bad('INVALID_TRANSITION', 'Only an active shipment can report delay.');
      const previousEta = s.eta;
      const affected = state.shipments.filter(cargo => cargo.riderId === s.riderId && cargo.status === 'IN_TRANSIT' && cargo.eta >= previousEta);
      // A delay at an earlier stop also delays every later stop on the same physical rider.
      for (const cargo of affected) cargo.eta = Math.max(cargo.eta, state.now) + action.minutes;
      riderProgress(state, s.riderId);
      event(state, 'DELAY_REPORTED', s.id, `Rider reported ${action.minutes} min delay.`, 'warning');
      let failed: Decision | undefined;
      for (const cargo of affected) {
        const batch = state.batches.find(b => b.id === cargo.batchId)!; const receiver = state.receivers.find(r => r.id === cargo.receiverId)!;
        if (!receiverCheck(state, batch, receiver, remainder(cargo), cargo.eta, undefined, cargo.id).ok) {
          cargo.status = 'REROUTE_REQUIRED'; event(state, 'REROUTE_REQUIRED', cargo.id, 'Delay makes this physical manifest stop unsafe or too late.', 'warning');
          const result = reroute(state, cargo, action.minutes); if (!result.ok) failed = result;
        }
      }
      if (failed) return failed;
      return good('Delay recorded; route remains safe.');
    }
    case 'REROUTE': {
      const s = state.shipments.find(s => s.id === action.shipmentId); if (!s) return bad('NOT_FOUND', 'Shipment not found.');
      if (s.status !== 'IN_TRANSIT' && s.status !== 'REROUTE_REQUIRED') return bad('INVALID_TRANSITION', 'Only active physical shipments can reroute; frozen custody requires recovery.');
      return reroute(state, s);
    }
    case 'RECOVER': {
      const s = state.shipments.find(s => s.id === action.shipmentId); const rider = state.riders.find(r => r.id === action.riderId);
      if (!s || !rider) return bad('NOT_FOUND', 'Shipment or recovery rider not found.');
      if (s.status !== 'RECOVERY_REQUIRED') return bad('INVALID_TRANSITION', 'Only a recovery-required shipment can be transferred; expired custody stays frozen.');
      if (rider.id === s.riderId || !rider.online || !rider.available || riderLoad(state, rider.id) > 0) return bad('RECOVERY_RIDER_UNAVAILABLE', 'Recovery requires a different online, available, unloaded rider.');
      if (rider.capacity < remainder(s)) return bad('CAPACITY_EXCEEDED', 'Recovery rider cannot carry the full physical remainder.');
      const origin = physicalLocation(state, s);
      const approach = pickupMinutes(rider.location, origin);
      const batch = state.batches.find(b => b.id === s.batchId)!;
      let receiver = state.receivers.find(r => r.id === s.receiverId)!;
      let eta = state.now + approach + travelMinutes(origin, receiver.location);
      if (!receiverCheck(state, batch, receiver, remainder(s), eta, undefined, s.id).ok) {
        const alternative = fallback(state, s, origin, approach);
        if (!alternative) return bad('UNSAFE_RECOVERY', 'No receiver can safely accept the full remainder after the recovery rider reaches physical custody.');
        receiver = alternative.receiver; eta = alternative.eta;
      }
      const previousRider = s.riderId;
      if (receiver.id !== s.receiverId) { s.reroutedFrom = s.receiverId; s.receiverId = receiver.id; event(state, 'SHIPMENT_REROUTED', s.id, `Recovery route changes destination to ${receiver.name}.`, 'warning'); }
      s.riderId = rider.id; s.status = 'IN_TRANSIT'; s.eta = eta; s.lastHeartbeatAt = state.now; s.reason = `Recovery rendezvous takes ${approach} min; full physical remainder transferred from ${previousRider}.`;
      rider.available = false; rider.lastHeartbeatAt = state.now;
      event(state, 'RECOVERY_DISPATCHED', s.id, `${rider.name} reaches stranded custody in ${approach} min and delivers ${remainder(s)} units in ${eta - state.now} min. Donor inventory remains unchanged.`, 'success');
      refreshAvailability(state, previousRider); return good('Recovery rider dispatched with a physically feasible rendezvous and safe delivery ETA.', 'RECOVERED');
    }
    case 'UPDATE_RECEIVER': {
      const receiver = state.receivers.find(r => r.id === action.receiverId); if (!receiver) return bad('NOT_FOUND', 'Receiver not found.');
      if (action.storageCapacity !== undefined && action.storageCapacity < receiver.currentStorage) return bad('STORED_STOCK', 'Storage capacity cannot be below stock already received.');
      if (action.isOpen !== undefined) receiver.isOpen = action.isOpen;
      if (action.storageCapacity !== undefined) receiver.storageCapacity = action.storageCapacity;
      if (action.aidType !== undefined && action.demand !== undefined) receiver.demand[action.aidType] = action.demand;
      if (action.capabilities) Object.assign(receiver.capabilities, action.capabilities);
      event(state, 'RECEIVER_UPDATED', receiver.id, 'Receiver status, capacity, demand or facilities changed; every active commitment is re-evaluated.'); reevaluate(state); return good('Receiver updated; commitments re-evaluated.');
    }
    case 'CREATE_RECEIVER': {
      const demand = Object.fromEntries(AID_TYPES.map(aid => [aid, aid === action.aidType ? action.quantity : 0])) as Receiver['demand'];
      const receiver: Receiver = { id: nextId(state, 'receiver'), name: action.name.trim(), location: { x: 10, y: 4 + state.receivers.length, label: action.name.trim() }, isOpen: true, demand, latestArrival: state.now + action.latestIn, storageCapacity: action.storageCapacity, currentStorage: 0, capabilities: { ...action.capabilities } };
      state.receivers.push(receiver); event(state, 'RECEIVER_CREATED', receiver.id, `${receiver.name} registered with ${action.quantity} units of demand.`, 'success'); return good('Receiver registered.', 'RECEIVER_CREATED');
    }
    case 'EXPIRE_BATCH': {
      const batch = state.batches.find(b => b.id === action.batchId); if (!batch) return bad('NOT_FOUND', 'Batch not found.');
      if (batch.unavailable && batch.safeUntil <= state.now) return bad('ALREADY_EXPIRED', 'This batch has already expired; physical custody remains frozen.');
      batch.safeUntil = Math.min(batch.safeUntil, state.now); expireBatch(state, batch); return good('Batch expired; physical custody remains accounted for.');
    }
  }
}

/** Every command returns a fresh snapshot and an audit receipt, including rejected commands. */
export function applyAction(state: OperationsState, action: Action): ActionResult {
  const next = structuredClone(state);
  const validation = validate(action);
  let decision: Decision;
  if (!validation.ok) decision = validation;
  else if (action.type === 'RESET') {
    const reset = createSeed();
    // Reset simulation data while retaining the immutable audit trail and monotonic identifiers.
    reset.events = next.events; reset.sequence = next.sequence; reset.version = next.version + 1;
    event(reset, 'RESET', 'operations', 'Simulation reset to the initial evening; prior audit history retained.', 'warning');
    return { state: reset, ...good('Simulation reset.', 'RESET') };
  } else decision = execute(next, action);
  next.version = state.version + 1;
  const raw: unknown = action;
  if (!decision.ok) {
    const entityId = record(raw) ? [raw.reservationId, raw.shipmentId, raw.batchId, raw.riderId, raw.receiverId].find(v => typeof v === 'string') as string | undefined : undefined;
    const type = record(raw) && typeof raw.type === 'string' ? raw.type : 'UNKNOWN';
    event(next, 'ACTION_REJECTED', entityId ?? 'operations', `${type} rejected [${decision.code}]: ${decision.message}`, 'warning');
  }
  return { state: next, ...decision };
}
