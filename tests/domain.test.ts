import { describe, expect, it } from 'vitest';
import { applyAction, feasibility } from '../src/domain/engine';
import { createSeed } from '../src/domain/seed';
import { ACTIVE_RESERVATIONS, CAPABILITY_LABELS, batchTotals, type Action, type Capability, type OperationsState } from '../src/domain/types';

function act(state: OperationsState, action: Action): OperationsState {
  const result = applyAction(state, action);
  expect(result.ok, `${action.type}: ${result.code}: ${result.message}`).toBe(true);
  return result.state;
}
function claim(state = createSeed(), quantity = 20, riderId = 'rider-1', receiverId = 'receiver-1', batchId = 'batch-1') {
  state = act(state, { type: 'RESERVE', batchId, riderId, receiverId, quantity });
  return { state, id: state.reservations.at(-1)!.id };
}
function arrive(state: OperationsState, id: string) {
  state = act(state, { type: 'ACCEPT', reservationId: id });
  state = act(state, { type: 'START_PICKUP', reservationId: id });
  state = act(state, { type: 'ADVANCE_TIME', minutes: state.reservations.find(r => r.id === id)!.pickupEta });
  return act(state, { type: 'ARRIVE', reservationId: id });
}
function pickup(quantity = 20, receiverId = 'receiver-1', state = createSeed(), riderId = 'rider-1') {
  const claimed = claim(state, quantity, riderId, receiverId);
  state = arrive(claimed.state, claimed.id);
  state = act(state, { type: 'PICKUP', reservationId: claimed.id, quantity });
  return { state, id: state.shipments.at(-1)!.id, reservationId: claimed.id };
}
function reach(state: OperationsState, id: string) {
  const s = state.shipments.find(s => s.id === id)!;
  // A receiver farther than seven minutes needs an actual rider progress update en route.
  if (s.eta - state.now > 6) {
    state = act(state, { type: 'ADVANCE_TIME', minutes: 4 });
    state = act(state, { type: 'HEARTBEAT', reservationId: s.reservationId });
  }
  const minutes = state.shipments.find(s => s.id === id)!.eta - state.now;
  return minutes > 0 ? act(state, { type: 'ADVANCE_TIME', minutes }) : state;
}
function invariant(state: OperationsState) {
  for (const b of state.batches) {
    const totals = batchTotals(state, b.id);
    expect(totals.available).toBeGreaterThanOrEqual(0);
    expect(totals.reserved + totals.pickedUp).toBeLessThanOrEqual(b.quantity);
  }
  for (const rider of state.riders) {
    const committed = state.reservations.filter(r => r.riderId === rider.id && ACTIVE_RESERVATIONS.includes(r.status)).reduce((n, r) => n + r.quantity, 0)
      + state.shipments.filter(s => s.riderId === rider.id || s.recovery?.riderId === rider.id).reduce((n, s) => n + s.quantity - s.deliveredQuantity, 0);
    expect(committed).toBeLessThanOrEqual(rider.capacity);
  }
  for (const s of state.shipments) {
    expect(s.deliveredQuantity).toBeGreaterThanOrEqual(0);
    expect(s.deliveredQuantity).toBeLessThanOrEqual(s.quantity);
  }
}

describe('01 · deterministic seed, immutable snapshots and audited commands', () => {
  it('starts with 180 meals, five 40-unit riders and an offline recovery rider', () => {
    const state = createSeed();
    expect(state).toEqual(createSeed());
    expect(state.now).toBe(1260);
    expect(state.batches[0].quantity).toBe(180);
    expect(state.batches[1].quantity).toBe(40);
    expect(state.reservations).toEqual([]);
    expect(state.riders.filter(r => r.online).map(r => r.capacity)).toEqual([40, 40, 40, 40, 40]);
    expect(state.riders[5].online).toBe(false);
    state.receivers[0].demand.COOKED_MEALS = 1;
    expect(createSeed().receivers[0].demand.COOKED_MEALS).toBe(50);
  });
  it('is deterministic, never mutates inputs, and increments versions on rejection too', () => {
    const state = createSeed(); const before = structuredClone(state);
    const action: Action = { type: 'AUTO_DISPATCH', batchId: 'batch-1' };
    const first = applyAction(state, action);
    expect(first).toEqual(applyAction(state, action));
    expect(state).toEqual(before);
    expect(first.state.version).toBe(1);
    const failure = applyAction(first.state, { type: 'RESERVE', batchId: 'missing', riderId: 'rider-1', receiverId: 'receiver-1', quantity: 5 });
    expect(failure.ok).toBe(false);
    expect(failure.state.version).toBe(2);
    expect(failure.state.events.at(-1)?.type).toBe('ACTION_REJECTED');
    expect(first.state.events).toEqual(first.state.events.slice());
  });
  it('resets operation data while preserving monotonic IDs and the prior audit trail', () => {
    const state = claim().state;
    const reset = act(state, { type: 'RESET' });
    expect(reset.reservations).toEqual([]);
    expect(reset.version).toBe(state.version + 1);
    expect(reset.events.slice(0, state.events.length)).toEqual(state.events);
    expect(reset.sequence).toBeGreaterThan(state.sequence);
    expect(new Set(reset.events.map(e => e.id)).size).toBe(reset.events.length);
  });
});

describe('02 · runtime validation and malformed input', () => {
  it('audits malformed object-valued identifiers and action types without coercing them', () => {
    const action = { type: Object.create(null), reservationId: Object.create(null) } as Action;
    expect(applyAction(createSeed(), action)).toMatchObject({ ok: false, code: 'INVALID_ACTION' });
  });
  it.each([
    null, [], {}, { type: 'constructor' }, { type: 'UNKNOWN' },
    { type: 'ADVANCE_TIME', minutes: NaN }, { type: 'ADVANCE_TIME', minutes: 0 }, { type: 'ADVANCE_TIME', minutes: Infinity }, { type: 'ADVANCE_TIME', minutes: 0.5 },
    { type: 'RESERVE', batchId: 'batch-1', riderId: 'rider-1', receiverId: 'receiver-1', quantity: -2 },
    { type: 'PICKUP', reservationId: 'x', quantity: '2' }, { type: 'DELIVER', shipmentId: 'x', quantity: 0 },
    { type: 'UPDATE_RIDER', riderId: 'rider-1', online: 'false' },
    { type: 'UPDATE_BATCH', batchId: 'batch-1' }, { type: 'UPDATE_BATCH', batchId: 'batch-1', quantity: 1.1 },
    { type: 'UPDATE_RECEIVER', receiverId: 'receiver-1', demand: 5 },
    { type: 'UPDATE_RECEIVER', receiverId: 'receiver-1', capabilities: { nuclearKitchen: true } },
    { type: 'UPDATE_RECEIVER', receiverId: 'receiver-1', capabilities: { kitchen: 'yes' } },
    { type: 'CREATE_BATCH', donorId: 'donor-1', aidType: 'BAD', quantity: 1, readyIn: 0, expiresIn: 30 },
    { type: 'CREATE_BATCH', donorId: 'donor-1', aidType: 'MEDICINE', quantity: 1, readyIn: 10, expiresIn: 11 },
    { type: 'CREATE_BATCH', donorId: 'donor-1', aidType: 'MEDICINE', quantity: 1, readyIn: 0, expiresIn: 30, requirements: ['bogus'] },
    { type: 'RESET', unsafeExtra: 5 },
  ])('rejects malformed payload %# without throwing or altering business data', payload => {
    const state = createSeed(); const result = applyAction(state, payload as Action);
    expect(result.ok).toBe(false);
    expect(result.state.version).toBe(1);
    expect(result.state.batches).toEqual(state.batches);
    expect(result.state.reservations).toEqual([]);
    expect(result.state.events.at(-1)?.type).toBe('ACTION_REJECTED');
  });
  it.each([
    { type: 'ACCEPT', reservationId: 'missing' }, { type: 'DELIVER', shipmentId: 'missing', quantity: 1 },
    { type: 'UPDATE_BATCH', batchId: 'missing', quantity: 1 }, { type: 'UPDATE_RIDER', riderId: 'missing', capacity: 40 },
    { type: 'UPDATE_RECEIVER', receiverId: 'missing', isOpen: false }, { type: 'RECOVER', shipmentId: 'missing', riderId: 'missing' },
    { type: 'CREATE_BATCH', donorId: 'missing', aidType: 'SEALED_KITS', quantity: 1, readyIn: 0, expiresIn: 30 },
    { type: 'AUTO_DISPATCH', batchId: 'missing' }, { type: 'EXPIRE_BATCH', batchId: 'missing' },
  ] satisfies Action[])('returns NOT_FOUND for unknown identities %#', action => {
    expect(applyAction(createSeed(), action).code).toBe('NOT_FOUND');
  });
});

describe('03 · mandatory aid compatibility', () => {
  it.each(['cleanWater', 'cookingFuel', 'kitchen'] as Capability[])('raw rations always require %s, even with empty custom requirements', capability => {
    const state = createSeed(); const receiver = state.receivers[0];
    state.batches[1].requirements = []; receiver.demand.RAW_RATIONS = 40; receiver.capabilities[capability] = false;
    expect(feasibility(state, 'batch-2', 'rider-1', receiver.id, 10).code).toBe(({ cleanWater: 'MISSING_CLEAN_WATER', cookingFuel: 'MISSING_COOKING_FUEL', kitchen: 'MISSING_COOKING_FACILITY' } as Partial<Record<Capability, string>>)[capability]);
    expect(feasibility(state, 'batch-2', 'rider-1', receiver.id, 10).message).toContain(CAPABILITY_LABELS[capability]);
  });
  it('shows the seeded gas incompatibility but permits the community kitchen', () => {
    const state = createSeed();
    expect(feasibility(state, 'batch-2', 'rider-1', 'receiver-5', 10)).toMatchObject({ code: 'MISSING_COOKING_FUEL', message: expect.stringContaining('Cooking fuel') });
    expect(feasibility(state, 'batch-2', 'rider-1', 'receiver-4', 10).ok).toBe(true);
  });
  it.each(['potableWater', 'servingArea', 'cleanContainers'] as Capability[])('formula requires %s', capability => {
    const state = createSeed(); state.batches[0].aidType = 'INFANT_FORMULA'; state.batches[0].requirements = [];
    state.receivers[0].demand.INFANT_FORMULA = 40; state.receivers[0].capabilities[capability] = false;
    expect(feasibility(state, 'batch-1', 'rider-1', 'receiver-1', 10).code).toBe(({ potableWater: 'MISSING_POTABLE_WATER', servingArea: 'MISSING_SERVING_AREA', cleanContainers: 'MISSING_CLEAN_CONTAINERS' } as Partial<Record<Capability, string>>)[capability]);
  });
  it('medicine requires a medical facility and honors configured refrigeration', () => {
    const state = createSeed(); state.batches[0].aidType = 'MEDICINE'; state.batches[0].requirements = ['medicalRefrigeration']; state.receivers[0].demand.MEDICINE = 40;
    expect(feasibility(state, 'batch-1', 'rider-1', 'receiver-1', 10).ok).toBe(false);
    state.receivers[0].capabilities.medicalFacility = true;
    expect(feasibility(state, 'batch-1', 'rider-1', 'receiver-1', 10)).toMatchObject({ code: 'MISSING_MEDICAL_REFRIGERATION', message: expect.stringContaining('Medical refrigeration') });
    state.receivers[0].capabilities.medicalRefrigeration = true;
    expect(feasibility(state, 'batch-1', 'rider-1', 'receiver-1', 10).ok).toBe(true);
  });
  it('sealed kits do not inherit cooking or medical requirements', () => {
    const state = createSeed(); state.batches[0].aidType = 'SEALED_KITS'; state.batches[0].requirements = []; state.receivers[0].demand.SEALED_KITS = 30;
    for (const key of Object.keys(state.receivers[0].capabilities) as Capability[]) state.receivers[0].capabilities[key] = false;
    expect(feasibility(state, 'batch-1', 'rider-1', 'receiver-1', 10).ok).toBe(true);
  });
});

describe('04 · coordinate routes, readiness, strict expiry and receiver deadlines', () => {
  it('has short seeded routes and changes ETA when coordinates change', () => {
    const state = createSeed();
    for (const batch of state.batches) for (const rider of state.riders.slice(0, 5)) {
      const check = feasibility(state, batch.id, rider.id, 'receiver-4', 1);
      expect(check.pickupEta).toBeGreaterThanOrEqual(2); expect(check.pickupEta).toBeLessThanOrEqual(4);
      expect(check.travelEta).toBeGreaterThanOrEqual(4); expect(check.travelEta).toBeLessThanOrEqual(10);
    }
    state.receivers[0].location.x = 200;
    expect(feasibility(state, 'batch-1', 'rider-1', 'receiver-1', 10).code).toBe('UNSAFE_ARRIVAL');
  });
  it('requires arrival + 3 to be strictly earlier than safeUntil', () => {
    const state = createSeed(); const route = feasibility(state, 'batch-1', 'rider-1', 'receiver-1', 10);
    state.batches[0].safeUntil = state.now + route.pickupEta + route.travelEta + 3;
    expect(feasibility(state, 'batch-1', 'rider-1', 'receiver-1', 10).code).toBe('UNSAFE_ARRIVAL');
    state.batches[0].safeUntil++;
    expect(feasibility(state, 'batch-1', 'rider-1', 'receiver-1', 10).ok).toBe(true);
  });
  it('includes donor readiness waiting and receiver closing time', () => {
    const state = createSeed(); state.batches[0].readyAt = state.now + 20;
    state.receivers[0].latestArrival = state.now + 23;
    expect(feasibility(state, 'batch-1', 'rider-1', 'receiver-1', 10).code).toBe('RECEIVER_DEADLINE');
    state.receivers[0].latestArrival++;
    expect(feasibility(state, 'batch-1', 'rider-1', 'receiver-1', 10).ok).toBe(true);
  });
});

describe('05 · shared stock, rider capacity, demand and storage commitments', () => {
  it('rejects repeated claims, capacity overflow and donor over-allocation', () => {
    let state = claim(createSeed(), 30).state;
    expect(applyAction(state, { type: 'RESERVE', batchId: 'batch-1', riderId: 'rider-1', receiverId: 'receiver-1', quantity: 1 }).code).toBe('DUPLICATE_RESERVATION');
    expect(applyAction(state, { type: 'RESERVE', batchId: 'batch-1', riderId: 'rider-1', receiverId: 'receiver-2', quantity: 11 }).code).toBe('CAPACITY_EXCEEDED');
    state = act(state, { type: 'UPDATE_BATCH', batchId: 'batch-1', quantity: 35 });
    expect(applyAction(state, { type: 'RESERVE', batchId: 'batch-1', riderId: 'rider-2', receiverId: 'receiver-2', quantity: 6 }).code).toBe('STOCK_EXCEEDED');
    invariant(state);
  });
  it('physical shipments still reserve demand and storage after pickup', () => {
    let { state } = pickup(35);
    const check = feasibility(state, 'batch-1', 'rider-2', 'receiver-1', 16);
    expect(check.code).toBe('DEMAND_EXCEEDED'); expect(check.maxQuantity).toBe(15);
    state = act(state, { type: 'UPDATE_RECEIVER', receiverId: 'receiver-1', storageCapacity: 40 });
    expect(feasibility(state, 'batch-1', 'rider-2', 'receiver-1', 6).code).toBe('STORAGE_EXCEEDED');
    expect(feasibility(state, 'batch-1', 'rider-2', 'receiver-1', 5).ok).toBe(true);
  });
  it('storage is shared across aid types and includes already received stock', () => {
    const { state: original, id } = pickup(20);
    let state = act(reach(original, id), { type: 'DELIVER', shipmentId: id, quantity: 20 });
    state = act(state, { type: 'UPDATE_RECEIVER', receiverId: 'receiver-1', aidType: 'RAW_RATIONS', demand: 40, storageCapacity: 25 });
    expect(feasibility(state, 'batch-2', 'rider-2', 'receiver-1', 6).code).toBe('STORAGE_EXCEEDED');
    expect(feasibility(state, 'batch-2', 'rider-2', 'receiver-1', 5).maxQuantity).toBe(5);
  });
});

describe('06 · central greedy dispatch, fair distribution and urgency', () => {
  it('splits all 180 meals across 50/80/50 demand using five riders without the fallback', () => {
    const state = act(createSeed(), { type: 'AUTO_DISPATCH', batchId: 'batch-1' });
    expect(batchTotals(state, 'batch-1')).toMatchObject({ reserved: 180, available: 0, pickedUp: 0 });
    expect(['receiver-1', 'receiver-2', 'receiver-3'].map(id => state.reservations.filter(r => r.receiverId === id).reduce((n, r) => n + r.quantity, 0))).toEqual([50, 80, 50]);
    expect(state.reservations.some(r => r.receiverId === 'receiver-4')).toBe(false);
    expect(new Set(state.reservations.map(r => r.riderId)).size).toBe(5);
    invariant(state);
    expect(applyAction(state, { type: 'AUTO_DISPATCH', batchId: 'batch-1' }).ok).toBe(false);
  });
  it('serves equal-deadline receivers fairly and processes earliest expiring batches first', () => {
    const state = createSeed(); state.batches[0].quantity = 120;
    const dispatched = act(state, { type: 'AUTO_DISPATCH' });
    expect(dispatched.reservations[0].batchId).toBe('batch-1');
    expect(['receiver-1', 'receiver-2', 'receiver-3'].map(id => dispatched.reservations.filter(r => r.batchId === 'batch-1' && r.receiverId === id).reduce((n, r) => n + r.quantity, 0))).toEqual([40, 40, 40]);
    invariant(dispatched);
  });
  it('completes the entire 180-meal relay, including the split-load rider’s sequential stops', () => {
    let state = act(createSeed(), { type: 'AUTO_DISPATCH', batchId: 'batch-1' });
    const reservations = state.reservations.map(r => ({ ...r }));
    for (const r of reservations) {
      state = act(state, { type: 'ACCEPT', reservationId: r.id });
      state = act(state, { type: 'START_PICKUP', reservationId: r.id });
    }
    state = act(state, { type: 'ADVANCE_TIME', minutes: 4 });
    for (const r of reservations) state = act(state, { type: 'ARRIVE', reservationId: r.id });
    for (const r of reservations) state = act(state, { type: 'PICKUP', reservationId: r.id, quantity: r.quantity });
    const splitLoad = state.shipments.filter(s => s.riderId === 'rider-5').sort((a, b) => a.eta - b.eta);
    const beforeDelay = splitLoad.map(s => s.eta);
    state = act(state, { type: 'REPORT_DELAY', shipmentId: splitLoad[0].id, minutes: 1 });
    expect(splitLoad.map(s => state.shipments.find(cargo => cargo.id === s.id)!.eta)).toEqual(beforeDelay.map(eta => eta + 1));
    for (let minute = 0; minute < 12 && state.shipments.some(s => s.status !== 'DELIVERED'); minute++) {
      for (const s of state.shipments.filter(s => s.status === 'IN_TRANSIT' && state.now - s.lastHeartbeatAt >= 3)) state = act(state, { type: 'HEARTBEAT', reservationId: s.reservationId });
      state = act(state, { type: 'ADVANCE_TIME', minutes: 1 });
      for (const s of state.shipments.filter(s => s.status === 'IN_TRANSIT' && s.eta <= state.now)) state = act(state, { type: 'DELIVER', shipmentId: s.id, quantity: s.quantity - s.deliveredQuantity });
      invariant(state);
    }
    expect(batchTotals(state, 'batch-1')).toMatchObject({ delivered: 180, available: 0, reserved: 0 });
    expect(state.shipments.every(s => s.status === 'DELIVERED')).toBe(true);
    expect(state.receivers.slice(0, 3).map(r => r.demand.COOKED_MEALS)).toEqual([0, 0, 0]);
    expect(state.receivers[3].demand.COOKED_MEALS).toBe(100);
    expect(state.riders.slice(0, 5).every(r => r.available)).toBe(true);
  });
});

describe('07 · warning, bounded leases, timeout release and central replacement', () => {
  it('warns at three minutes, releases at five, and never reissues to the timed-out rider', () => {
    const claimed = claim(); const id = claimed.id;
    let state = act(claimed.state, { type: 'ADVANCE_TIME', minutes: 3 });
    expect(state.reservations.find(r => r.id === id)!.status).toBe('WARNING_INACTIVE');
    expect(state.events.some(e => e.type === 'RESERVATION_INACTIVE_WARNING')).toBe(true);
    state = act(state, { type: 'ADVANCE_TIME', minutes: 2 });
    expect(state.reservations.find(r => r.id === id)!.status).toBe('TIMED_OUT');
    expect(state.riders[0]).toMatchObject({ online: false, available: false });
    expect(state.events.some(e => e.type === 'RESERVATION_RELEASED')).toBe(true);
    expect(state.events.some(e => e.type === 'RESERVATION_REASSIGNED')).toBe(true);
    expect(state.reservations.filter(r => ACTIVE_RESERVATIONS.includes(r.status)).every(r => r.riderId !== 'rider-1')).toBe(true);
    expect(applyAction(state, { type: 'HEARTBEAT', reservationId: id }).ok).toBe(false);
    invariant(state);
  });
  it('heartbeats renew at most five minutes and cannot exceed the absolute progress cap', () => {
    const claimed = claim(); let state = claimed.state; const id = claimed.id;
    for (let i = 0; i < 9; i++) {
      state = act(state, { type: 'ADVANCE_TIME', minutes: 1 });
      state = act(state, { type: 'HEARTBEAT', reservationId: id });
      const r = state.reservations.find(r => r.id === id)!;
      expect(r.leaseExpiresAt - state.now).toBeLessThanOrEqual(5);
      expect(r.pickupDeadline).toBe(r.createdAt + 10);
    }
    state = act(state, { type: 'ADVANCE_TIME', minutes: 1 });
    expect(state.reservations.find(r => r.id === id)!.status).toBe('TIMED_OUT');
  });
  it('bounds an initial lease by the latest safe replacement route start', () => {
    const state = createSeed(); state.batches[0].safeUntil = state.now + 12;
    const claimed = claim(state, 10).state; const r = claimed.reservations[0];
    expect(r.leaseExpiresAt).toBeLessThanOrEqual(state.batches[0].safeUntil - 4 - r.pickupEta - r.travelEta);
    expect(r.leaseExpiresAt - r.createdAt).toBeLessThanOrEqual(5);
  });
});

describe('08 · strict pickup transitions, real travel time, readiness and partial pickup', () => {
  it('requires accept, departure, elapsed pickup ETA, donor arrival and readyAt', () => {
    const seed = createSeed(); seed.batches[0].readyAt += 4;
    const claimed = claim(seed); let state = claimed.state; const id = claimed.id;
    expect(applyAction(state, { type: 'PICKUP', reservationId: id, quantity: 20 }).code).toBe('INVALID_TRANSITION');
    expect(applyAction(state, { type: 'START_PICKUP', reservationId: id }).code).toBe('INVALID_TRANSITION');
    state = act(state, { type: 'ACCEPT', reservationId: id });
    expect(applyAction(state, { type: 'ACCEPT', reservationId: id }).code).toBe('INVALID_TRANSITION');
    state = act(state, { type: 'START_PICKUP', reservationId: id });
    expect(applyAction(state, { type: 'ARRIVE', reservationId: id }).code).toBe('PICKUP_NOT_REACHED');
    state = act(state, { type: 'ADVANCE_TIME', minutes: 2 });
    state = act(state, { type: 'ARRIVE', reservationId: id });
    expect(applyAction(state, { type: 'PICKUP', reservationId: id, quantity: 20 }).code).toBe('BATCH_NOT_READY');
    state = act(state, { type: 'ADVANCE_TIME', minutes: 2 });
    state = act(state, { type: 'PICKUP', reservationId: id, quantity: 20 });
    expect(applyAction(state, { type: 'PICKUP', reservationId: id, quantity: 20 }).code).toBe('INVALID_TRANSITION');
    expect(state.shipments).toHaveLength(1);
  });
  it('partial pickup releases the uncollected balance, not physical custody', () => {
    const claimed = claim(createSeed(), 40); let state = arrive(claimed.state, claimed.id);
    state = act(state, { type: 'PICKUP', reservationId: claimed.id, quantity: 25 });
    expect(batchTotals(state, 'batch-1')).toMatchObject({ reserved: 0, pickedUp: 25, available: 155 });
    expect(state.events.some(e => e.type === 'PARTIAL_PICKUP_RELEASED')).toBe(true);
    invariant(state);
  });
  it('decline releases stock, pauses the rider and explicitly reassigns', () => {
    const claimed = claim(); const state = act(claimed.state, { type: 'DECLINE', reservationId: claimed.id });
    expect(state.reservations[0].status).toBe('CANCELLED');
    expect(state.riders[0].available).toBe(false);
    expect(state.events.some(e => e.type === 'RESERVATION_REASSIGNED')).toBe(true);
  });
});

describe('09 · delivery arrival, partial custody and duplicate protection', () => {
  it('rejects early delivery, records partial delivery and never double delivers', () => {
    const pickedUp = pickup(30); let state = pickedUp.state; const id = pickedUp.id;
    expect(applyAction(state, { type: 'DELIVER', shipmentId: id, quantity: 30 }).code).toBe('DELIVERY_NOT_REACHED');
    state = reach(state, id);
    state = act(state, { type: 'DELIVER', shipmentId: id, quantity: 10 });
    expect(state.shipments[0]).toMatchObject({ quantity: 30, deliveredQuantity: 10, status: 'IN_TRANSIT' });
    expect(state.receivers[0].demand.COOKED_MEALS).toBe(40);
    expect(state.receivers[0].currentStorage).toBe(10);
    expect(state.riders[0].available).toBe(false);
    expect(applyAction(state, { type: 'DELIVER', shipmentId: id, quantity: 21 }).code).toBe('SHIPMENT_EXCEEDED');
    state = act(state, { type: 'DELIVER', shipmentId: id, quantity: 20 });
    expect(state.shipments[0]).toMatchObject({ status: 'DELIVERED', deliveredQuantity: 30, deliveredAt: state.now });
    expect(state.riders[0].available).toBe(true);
    expect(applyAction(state, { type: 'DELIVER', shipmentId: id, quantity: 1 }).code).toBe('INVALID_TRANSITION');
    expect(batchTotals(state, 'batch-1').available).toBe(150);
  });
  it('a partially delivered remainder continues to block new rider claims and stock reduction', () => {
    const p = pickup(30); let state = act(reach(p.state, p.id), { type: 'DELIVER', shipmentId: p.id, quantity: 10 });
    expect(feasibility(state, 'batch-1', 'rider-1', 'receiver-2', 1).code).toBe('RIDER_BUSY');
    expect(applyAction(state, { type: 'UPDATE_BATCH', batchId: 'batch-1', quantity: 29 }).code).toBe('COMMITTED_STOCK');
    expect(applyAction(state, { type: 'UPDATE_RIDER', riderId: 'rider-1', capacity: 19 }).code).toBe('COMMITTED_CAPACITY');
    invariant(state);
  });
});

describe('10 · receiver changes re-evaluate every commitment and full-remainder fallback', () => {
  it('cancels and reassigns all pre-pickup allocations when a receiver closes', () => {
    let state = claim(createSeed(), 20).state;
    state = claim(state, 20, 'rider-2').state;
    const old = state.reservations.map(r => r.id);
    state = act(state, { type: 'UPDATE_RECEIVER', receiverId: 'receiver-1', isOpen: false });
    expect(old.every(id => state.reservations.find(r => r.id === id)!.status === 'CANCELLED')).toBe(true);
    expect(state.reservations.filter(r => ACTIVE_RESERVATIONS.includes(r.status)).every(r => r.receiverId !== 'receiver-1')).toBe(true);
    expect(state.events.some(e => e.type === 'RESERVATION_REASSIGNED')).toBe(true);
    invariant(state);
  });
  it('routes all undelivered physical remainder, preserving the already delivered quantity', () => {
    const p = pickup(30); let state = act(reach(p.state, p.id), { type: 'DELIVER', shipmentId: p.id, quantity: 10 });
    state = act(state, { type: 'UPDATE_RECEIVER', receiverId: 'receiver-1', isOpen: false });
    const shipment = state.shipments[0];
    expect(shipment.receiverId).not.toBe('receiver-1');
    expect(shipment).toMatchObject({ quantity: 30, deliveredQuantity: 10, reroutedFrom: 'receiver-1', status: 'IN_TRANSIT' });
    expect(state.receivers[0].currentStorage).toBe(10);
    expect(batchTotals(state, 'batch-1').available).toBe(150);
  });
  it('does not overbook a fallback reserved by other riders, and freezes when none fits the whole remainder', () => {
    const p = pickup(30); let state = p.state;
    state = act(state, { type: 'UPDATE_RECEIVER', receiverId: 'receiver-2', isOpen: false });
    state = act(state, { type: 'UPDATE_RECEIVER', receiverId: 'receiver-3', isOpen: false });
    state = act(state, { type: 'UPDATE_RECEIVER', receiverId: 'receiver-4', aidType: 'COOKED_MEALS', demand: 40 });
    state = claim(state, 20, 'rider-2', 'receiver-4').state;
    state = act(state, { type: 'UPDATE_RECEIVER', receiverId: 'receiver-1', isOpen: false });
    expect(state.shipments[0].status).toBe('RECOVERY_REQUIRED');
    expect(state.shipments[0].receiverId).toBe('receiver-1');
    expect(state.shipments[0].quantity).toBe(30);
    expect(state.reservations.filter(r => r.receiverId === 'receiver-4' && ACTIVE_RESERVATIONS.includes(r.status)).reduce((n, r) => n + r.quantity, 0)).toBe(20);
  });
  it('a capability or storage reduction rechecks physical shipments as well as reservations', () => {
    const p = pickup(30);
    const state = act(p.state, { type: 'UPDATE_RECEIVER', receiverId: 'receiver-1', capabilities: { servingArea: false }, storageCapacity: 10 });
    expect(state.shipments[0].receiverId).not.toBe('receiver-1');
    expect(state.events.some(e => e.type === 'REROUTE_REQUIRED')).toBe(true);
  });
  it('rejects a reroute that would make another stop on the same physical manifest unsafe', () => {
    const first = claim(createSeed(), 10); const second = claim(first.state, 10, 'rider-1', 'receiver-3');
    let state = second.state;
    for (const id of [first.id, second.id]) {
      state = act(state, { type: 'ACCEPT', reservationId: id });
      state = act(state, { type: 'START_PICKUP', reservationId: id });
    }
    state = act(state, { type: 'ADVANCE_TIME', minutes: 2 });
    for (const id of [first.id, second.id]) state = act(state, { type: 'ARRIVE', reservationId: id });
    for (const id of [first.id, second.id]) state = act(state, { type: 'PICKUP', reservationId: id, quantity: 10 });
    state.batches[0].safeUntil = state.now + 13;
    state = act(state, { type: 'ADVANCE_TIME', minutes: 1 });
    state = act(state, { type: 'UPDATE_RECEIVER', receiverId: 'receiver-1', isOpen: false });
    expect(state.shipments[0].status).toBe('RECOVERY_REQUIRED');
    expect(state.shipments[1].eta + 3).toBeLessThan(state.batches[0].safeUntil);
  });
});

describe('11 · post-pickup inactivity, failures and expired physical custody', () => {
  it('keeps cargo active through seven inactive minutes, then freezes beyond seven', () => {
    const p = pickup();
    let state = act(p.state, { type: 'ADVANCE_TIME', minutes: 7 });
    expect(state.shipments[0].status).toBe('IN_TRANSIT');
    state = act(state, { type: 'ADVANCE_TIME', minutes: 1 });
    expect(state.shipments[0].status).toBe('RECOVERY_REQUIRED');
    expect(batchTotals(state, 'batch-1').available).toBe(160);
    expect(applyAction(state, { type: 'DELIVER', shipmentId: p.id, quantity: 20 }).ok).toBe(false);
    expect(applyAction(state, { type: 'HEARTBEAT', reservationId: p.reservationId }).ok).toBe(false);
    state = act(state, { type: 'ADVANCE_TIME', minutes: 5 });
    expect(state.shipments[0].status).toBe('RECOVERY_REQUIRED');
    expect(state.reservations).toHaveLength(1);
  });
  it('rider failure before pickup releases stock, but failure after pickup requires recovery', () => {
    const c = claim(); const before = act(c.state, { type: 'RIDER_FAILURE', riderId: 'rider-1' });
    expect(before.reservations[0].status).toBe('CANCELLED');
    expect(before.events.some(e => e.type === 'RESERVATION_REASSIGNED')).toBe(true);
    const p = pickup(); const after = act(p.state, { type: 'RIDER_FAILURE', riderId: 'rider-1' });
    expect(after.shipments[0].status).toBe('RECOVERY_REQUIRED');
    expect(batchTotals(after, 'batch-1').available).toBe(160);
  });
  it('expired shipments still occupy rider capacity, batch stock and incoming receiver commitments', () => {
    const p = pickup(30); let state = act(p.state, { type: 'EXPIRE_BATCH', batchId: 'batch-1' });
    expect(state.shipments[0].status).toBe('EXPIRED');
    expect(batchTotals(state, 'batch-1')).toMatchObject({ pickedUp: 30, available: 150 });
    expect(applyAction(state, { type: 'UPDATE_RIDER', riderId: 'rider-1', capacity: 29 }).code).toBe('COMMITTED_CAPACITY');
    expect(applyAction(state, { type: 'UPDATE_BATCH', batchId: 'batch-1', quantity: 29 }).code).toBe('COMMITTED_STOCK');
    expect(applyAction(state, { type: 'DELIVER', shipmentId: p.id, quantity: 1 }).ok).toBe(false);
    expect(applyAction(state, { type: 'RECOVER', shipmentId: p.id, riderId: 'rider-2' }).ok).toBe(false);
    state = act(state, { type: 'CREATE_BATCH', donorId: 'donor-1', aidType: 'COOKED_MEALS', quantity: 100, readyIn: 0, expiresIn: 60 });
    expect(feasibility(state, state.batches.at(-1)!.id, 'rider-2', 'receiver-1', 21).code).toBe('DEMAND_EXCEEDED');
  });
});

describe('12 · physically feasible alternate-rider recovery', () => {
  it('rejects the same rider, offline riders, undersized riders and distant recovery arrivals', () => {
    const p = pickup(30); let state = act(p.state, { type: 'RIDER_FAILURE', riderId: 'rider-1' });
    expect(applyAction(state, { type: 'RECOVER', shipmentId: p.id, riderId: 'rider-1' }).ok).toBe(false);
    expect(applyAction(state, { type: 'RECOVER', shipmentId: p.id, riderId: 'rider-6' }).ok).toBe(false);
    state = act(state, { type: 'UPDATE_RIDER', riderId: 'rider-2', capacity: 20 });
    expect(applyAction(state, { type: 'RECOVER', shipmentId: p.id, riderId: 'rider-2' }).code).toBe('CAPACITY_EXCEEDED');
    state.riders[2].location = { x: 1000, y: 1000, label: 'Too far away' };
    expect(applyAction(state, { type: 'RECOVER', shipmentId: p.id, riderId: 'rider-3' }).code).toBe('UNSAFE_RECOVERY');
  });
  it('transfers the same shipment and physical remainder, never returning donor stock', () => {
    const p = pickup(30); let state = act(p.state, { type: 'RIDER_FAILURE', riderId: 'rider-1' });
    const before = batchTotals(state, 'batch-1');
    state = act(state, { type: 'UPDATE_RIDER', riderId: 'rider-6', online: true, available: true });
    state = act(state, { type: 'RECOVER', shipmentId: p.id, riderId: 'rider-6' });
    expect(state.shipments).toHaveLength(1);
    expect(state.shipments[0]).toMatchObject({ id: p.id, riderId: 'rider-1', quantity: 30, status: 'RECOVERY_REQUIRED', recovery: { riderId: 'rider-6' } });
    expect(state.shipments[0].eta).toBeGreaterThanOrEqual(state.now + 6);
    expect(batchTotals(state, 'batch-1')).toEqual(before);
    expect(applyAction(state, { type: 'CONFIRM_RECOVERY', shipmentId: p.id }).code).toBe('RECOVERY_NOT_REACHED');
    expect(applyAction(state, { type: 'RECOVER', shipmentId: p.id, riderId: 'rider-2' }).code).toBe('RECOVERY_ALREADY_PLANNED');
    state = act(state, { type: 'ADVANCE_TIME', minutes: state.shipments[0].recovery!.rendezvousAt - state.now });
    expect(state.shipments[0].riderId).toBe('rider-1');
    state = act(state, { type: 'CONFIRM_RECOVERY', shipmentId: p.id });
    expect(state.shipments[0]).toMatchObject({ riderId: 'rider-6', status: 'IN_TRANSIT' });
    expect(state.shipments[0].recovery).toBeUndefined();
    expect(batchTotals(state, 'batch-1')).toEqual(before);
    expect(state.events.some(e => e.type === 'RECOVERY_CONFIRMED')).toBe(true);
    expect(applyAction(state, { type: 'CONFIRM_RECOVERY', shipmentId: p.id }).code).toBe('NO_RECOVERY_PLAN');
    state = reach(state, p.id);
    state = act(state, { type: 'DELIVER', shipmentId: p.id, quantity: 30 });
    invariant(state);
  });
  it('uses the replacement custody rider for heartbeats instead of the original offline rider', () => {
    const p = pickup(30); let state = act(p.state, { type: 'RIDER_FAILURE', riderId: 'rider-1' });
    state.riders[1].location = { x: -12, y: 0, label: 'Recovery approach' };
    state = act(state, { type: 'RECOVER', shipmentId: p.id, riderId: 'rider-2' });
    expect(state.shipments[0].eta - state.now).toBe(10);
    state = act(state, { type: 'ADVANCE_TIME', minutes: 6 });
    state = act(state, { type: 'CONFIRM_RECOVERY', shipmentId: p.id });
    state = act(state, { type: 'HEARTBEAT', reservationId: p.reservationId });
    state = reach(state, p.id);
    state = act(state, { type: 'DELIVER', shipmentId: p.id, quantity: 30 });
    expect(state.shipments[0].status).toBe('DELIVERED');
    expect(state.riders[0].online).toBe(false);
  });
  it.each(['RIDER_FAILURE', 'UPDATE_RIDER'] as const)('invalidates a pending plan on recovery rider %s without transferring stock', type => {
    const p = pickup(30); let state = act(p.state, { type: 'RIDER_FAILURE', riderId: 'rider-1' });
    const before = batchTotals(state, 'batch-1');
    state = act(state, { type: 'RECOVER', shipmentId: p.id, riderId: 'rider-2' });
    state = act(state, type === 'RIDER_FAILURE' ? { type, riderId: 'rider-2' } : { type, riderId: 'rider-2', online: false });
    expect(state.shipments[0]).toMatchObject({ riderId: 'rider-1', status: 'RECOVERY_REQUIRED' });
    expect(state.shipments[0].recovery).toBeUndefined();
    expect(batchTotals(state, 'batch-1')).toEqual(before);
    expect(applyAction(state, { type: 'CONFIRM_RECOVERY', shipmentId: p.id }).ok).toBe(false);
    state = act(state, { type: 'UPDATE_RIDER', riderId: 'rider-2', capacity: 1 });
    expect(state.events.some(e => e.type === 'RECOVERY_CANCELLED')).toBe(true);
  });
  it('reserves alternate capacity, prevents competing claims and survives an approach longer than seven minutes', () => {
    const p = pickup(30); let state = act(p.state, { type: 'RIDER_FAILURE', riderId: 'rider-1' });
    state.riders[1].location = { x: -18, y: 0, label: 'Nine-minute recovery approach' };
    state = act(state, { type: 'RECOVER', shipmentId: p.id, riderId: 'rider-2' });
    expect(state.riders[1].available).toBe(false);
    expect(applyAction(state, { type: 'UPDATE_RIDER', riderId: 'rider-2', capacity: 29 }).code).toBe('COMMITTED_CAPACITY');
    expect(feasibility(state, 'batch-1', 'rider-2', 'receiver-2', 1).code).toBe('RIDER_BUSY');
    state = act(state, { type: 'ADVANCE_TIME', minutes: 9 });
    expect(state.riders[1].online).toBe(true);
    expect(state.shipments[0]).toMatchObject({ riderId: 'rider-1', status: 'RECOVERY_REQUIRED' });
    state = act(state, { type: 'CONFIRM_RECOVERY', shipmentId: p.id });
    expect(state.shipments[0].riderId).toBe('rider-2'); invariant(state);
  });
  it('does not hand off when the original physical custody location has changed', () => {
    const p = pickup(30); let state = act(p.state, { type: 'RIDER_FAILURE', riderId: 'rider-1' });
    state = act(state, { type: 'RECOVER', shipmentId: p.id, riderId: 'rider-2' });
    state = act(state, { type: 'ADVANCE_TIME', minutes: state.shipments[0].recovery!.rendezvousAt - state.now });
    state.riders[0].location.x += 5;
    const result = applyAction(state, { type: 'CONFIRM_RECOVERY', shipmentId: p.id });
    expect(result.code).toBe('RECOVERY_LOCATION_CHANGED');
    expect(result.state.shipments[0]).toMatchObject({ riderId: 'rider-1', status: 'RECOVERY_REQUIRED' });
    expect(result.state.shipments[0].recovery).toBeUndefined();
    expect(result.state.riders[1].available).toBe(true);
  });
  it('counts all other recovery commitments at the verified handoff', () => {
    const p = pickup(30); let state = act(p.state, { type: 'RIDER_FAILURE', riderId: 'rider-1' });
    state = act(state, { type: 'RECOVER', shipmentId: p.id, riderId: 'rider-2' });
    state = act(state, { type: 'ADVANCE_TIME', minutes: state.shipments[0].recovery!.rendezvousAt - state.now });
    state.shipments.push({ ...structuredClone(state.shipments[0]), id: 'other-recovery', quantity: 20, riderId: 'rider-3' });
    const result = applyAction(state, { type: 'CONFIRM_RECOVERY', shipmentId: p.id });
    expect(result.code).toBe('CAPACITY_EXCEEDED');
    expect(result.state.shipments[0].riderId).toBe('rider-1');
    expect(result.state.shipments[0].recovery).toBeUndefined();
    expect(result.state.riders[1].available).toBe(false);
  });
  it('rechecks destination at handoff and uses a safe full-remainder fallback', () => {
    const p = pickup(30); let state = act(p.state, { type: 'RIDER_FAILURE', riderId: 'rider-1' });
    state = act(state, { type: 'RECOVER', shipmentId: p.id, riderId: 'rider-2' });
    state = act(state, { type: 'UPDATE_RECEIVER', receiverId: 'receiver-1', isOpen: false });
    state = act(state, { type: 'ADVANCE_TIME', minutes: state.shipments[0].recovery!.rendezvousAt - state.now });
    state = act(state, { type: 'CONFIRM_RECOVERY', shipmentId: p.id });
    expect(state.shipments[0]).toMatchObject({ riderId: 'rider-2', status: 'IN_TRANSIT', quantity: 30, reroutedFrom: 'receiver-1' });
    expect(state.shipments[0].receiverId).not.toBe('receiver-1');
  });
  it('refuses a handoff when every destination becomes unsafe while recovery is pending', () => {
    const p = pickup(30); let state = act(p.state, { type: 'RIDER_FAILURE', riderId: 'rider-1' });
    state = act(state, { type: 'RECOVER', shipmentId: p.id, riderId: 'rider-2' });
    state = act(state, { type: 'ADVANCE_TIME', minutes: state.shipments[0].recovery!.rendezvousAt - state.now });
    for (const receiver of state.receivers) receiver.isOpen = false;
    const result = applyAction(state, { type: 'CONFIRM_RECOVERY', shipmentId: p.id });
    expect(result.code).toBe('UNSAFE_RECOVERY');
    expect(result.state.shipments[0].riderId).toBe('rider-1');
    expect(batchTotals(result.state, 'batch-1').pickedUp).toBe(30);
  });
  it.each(['explicit', 'natural'])('%s expiry cancels pending recovery capacity but never returns physical inventory', mode => {
    const p = pickup(30); let state = act(p.state, { type: 'RIDER_FAILURE', riderId: 'rider-1' });
    state = act(state, { type: 'RECOVER', shipmentId: p.id, riderId: 'rider-2' });
    const before = batchTotals(state, 'batch-1');
    state = act(state, mode === 'explicit' ? { type: 'EXPIRE_BATCH', batchId: 'batch-1' } : { type: 'ADVANCE_TIME', minutes: state.batches[0].safeUntil - state.now });
    expect(state.shipments[0]).toMatchObject({ riderId: 'rider-1', status: 'EXPIRED', quantity: 30 });
    expect(state.shipments[0].recovery).toBeUndefined();
    expect(state.riders[1].available).toBe(true);
    expect(batchTotals(state, 'batch-1')).toEqual(before);
    expect(applyAction(state, { type: 'CONFIRM_RECOVERY', shipmentId: p.id }).ok).toBe(false);
  });
});

describe('13 · delay, reroute, donor edits, registration and natural expiry', () => {
  it('accepts safe delays, but freezes unsafe delays when no full safe fallback exists', () => {
    const p = pickup(); let state = act(p.state, { type: 'REPORT_DELAY', shipmentId: p.id, minutes: 1 });
    expect(state.shipments[0].eta).toBe(p.state.shipments[0].eta + 1);
    const unsafe = applyAction(state, { type: 'REPORT_DELAY', shipmentId: p.id, minutes: 100 });
    expect(unsafe.ok).toBe(false);
    expect(unsafe.state.shipments[0].status).toBe('RECOVERY_REQUIRED');
    expect(unsafe.state.events.some(e => e.type === 'DELAY_REPORTED')).toBe(true);
    expect(unsafe.state.events.at(-1)?.type).toBe('ACTION_REJECTED');
  });
  it('manual reroute preserves physical quantity and audits the previous destination', () => {
    const p = pickup(); const state = act(p.state, { type: 'REROUTE', shipmentId: p.id });
    expect(state.shipments[0]).toMatchObject({ quantity: 20, deliveredQuantity: 0, reroutedFrom: 'receiver-1' });
    expect(state.shipments[0].receiverId).not.toBe('receiver-1');
  });
  it('cannot reduce below reservations plus all past physical pickups, including delivered aid', () => {
    const p = pickup(30); let state = act(reach(p.state, p.id), { type: 'DELIVER', shipmentId: p.id, quantity: 30 });
    state = claim(state, 20, 'rider-2', 'receiver-2').state;
    expect(applyAction(state, { type: 'UPDATE_BATCH', batchId: 'batch-1', quantity: 49 }).code).toBe('COMMITTED_STOCK');
    state = act(state, { type: 'UPDATE_BATCH', batchId: 'batch-1', quantity: 50 });
    expect(batchTotals(state, 'batch-1')).toMatchObject({ reserved: 20, pickedUp: 30, available: 0 });
    state = act(state, { type: 'UPDATE_BATCH', batchId: 'batch-1', unavailable: true });
    expect(state.reservations.filter(r => ACTIVE_RESERVATIONS.includes(r.status))).toHaveLength(0);
    expect(state.shipments[0].status).toBe('DELIVERED');
  });
  it('creates batches with mandatory defaults, receivers with complete flags, and unique monotonic IDs', () => {
    let state = createSeed();
    state = act(state, { type: 'CREATE_BATCH', donorId: 'donor-1', aidType: 'RAW_RATIONS', quantity: 10, readyIn: 0, expiresIn: 60, requirements: [] });
    expect(state.batches.at(-1)!.requirements).toEqual(['cleanWater', 'cookingFuel', 'kitchen']);
    state = act(state, { type: 'CREATE_RECEIVER', name: '  Seva Women’s Centre  ', quantity: 20, aidType: 'RAW_RATIONS', storageCapacity: 30, capabilities: { ...state.receivers[0].capabilities }, latestIn: 60 });
    expect(state.receivers.at(-1)!).toMatchObject({ name: 'Seva Women’s Centre', currentStorage: 0, demand: { RAW_RATIONS: 20, COOKED_MEALS: 0 } });
    const ids = [...state.batches, ...state.receivers, ...state.events].map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('allows a donor to reduce an entirely uncommitted batch to zero', () => {
    const state = act(createSeed(), { type: 'UPDATE_BATCH', batchId: 'batch-1', quantity: 0 });
    expect(batchTotals(state, 'batch-1').available).toBe(0);
    expect(applyAction(state, { type: 'AUTO_DISPATCH', batchId: 'batch-1' }).ok).toBe(false);
  });
  it('natural expiry prevents pickup and never resurrects recovery custody', () => {
    const p = pickup(); const state = act(p.state, { type: 'ADVANCE_TIME', minutes: 45 });
    expect(state.shipments[0].status).toBe('EXPIRED');
    expect(state.batches[0].unavailable).toBe(true);
    expect(state.events.filter(e => e.type === 'BATCH_EXPIRED' && e.entityId === 'batch-1')).toHaveLength(1);
    expect(batchTotals(state, 'batch-1').pickedUp).toBe(20);
    const repeated = applyAction(state, { type: 'EXPIRE_BATCH', batchId: 'batch-1' });
    expect(repeated.code).toBe('ALREADY_EXPIRED');
    expect(repeated.state.events.length).toBeGreaterThan(state.events.length);
  });
});
