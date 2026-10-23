import { applyAction } from "./domain/engine";
import { createSeed } from "./domain/seed";
import type { Action, OperationsState } from "./domain/types";

export const BROWSER_DEMO_STORAGE_KEY = "relaysafe-static-demo-v1";
export const BROWSER_DEMO_SCHEMA_VERSION = 1;

export type BrowserDemoPersistence = "persisted" | "memory-only";
export interface BrowserDemoStatus {
  mode: BrowserDemoPersistence;
  persisted: boolean;
}

type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type PersistedSnapshot = {
  schemaVersion: number;
  state: unknown;
};

type StateDonor = OperationsState["donors"][number];
type StateBatch = OperationsState["batches"][number];
type StateRider = OperationsState["riders"][number];
type StateReceiver = OperationsState["receivers"][number];
type StateReservation = OperationsState["reservations"][number];
type StateShipment = OperationsState["shipments"][number];
type StateEvent = OperationsState["events"][number];

const AID_TYPES = [
  "COOKED_MEALS",
  "RAW_RATIONS",
  "SEALED_KITS",
  "MEDICINE",
  "INFANT_FORMULA",
] as const;
const CAPABILITIES = [
  "cleanWater",
  "potableWater",
  "cookingFuel",
  "kitchen",
  "servingArea",
  "coldStorage",
  "medicalRefrigeration",
  "cleanContainers",
  "medicalFacility",
] as const;
const RESERVATION_STATUSES = [
  "ASSIGNED",
  "ACKNOWLEDGED",
  "EN_ROUTE_TO_DONOR",
  "ARRIVED_AT_DONOR",
  "WARNING_INACTIVE",
  "TIMED_OUT",
  "PICKUP_CONFIRMED",
  "CANCELLED",
] as const;
const SHIPMENT_STATUSES = [
  "IN_TRANSIT",
  "REROUTE_REQUIRED",
  "RECOVERY_REQUIRED",
  "DELIVERED",
  "EXPIRED",
] as const;
const EVENT_SEVERITIES = ["info", "success", "warning", "danger"] as const;

let memoryState: OperationsState | undefined;
let persistence: BrowserDemoPersistence = "persisted";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isNonEmptyString = (value: unknown): value is string =>
  isString(value) && value.trim().length > 0;
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isNonNegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const isOneOf = <T extends readonly string[]>(
  value: unknown,
  choices: T,
): value is T[number] =>
  isString(value) && choices.includes(value as T[number]);

function isLocation(value: unknown): value is StateDonor["location"] {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isNonEmptyString(value.label)
  );
}

function isDonor(value: unknown): value is StateDonor {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    isLocation(value.location)
  );
}

function isBatch(value: unknown): value is StateBatch {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.donorId) &&
    isOneOf(value.aidType, AID_TYPES) &&
    isNonNegativeInteger(value.quantity) &&
    isNonNegativeInteger(value.readyAt) &&
    isNonNegativeInteger(value.safeUntil) &&
    Array.isArray(value.requirements) &&
    value.requirements.every((requirement) =>
      isOneOf(requirement, CAPABILITIES),
    ) &&
    isString(value.notes) &&
    typeof value.unavailable === "boolean"
  );
}

function isRider(value: unknown): value is StateRider {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    isNonNegativeInteger(value.capacity) &&
    typeof value.available === "boolean" &&
    typeof value.online === "boolean" &&
    isLocation(value.location) &&
    isNonNegativeInteger(value.lastHeartbeatAt)
  );
}

function isDemand(value: unknown): boolean {
  return (
    isRecord(value) &&
    AID_TYPES.every((aidType) => isNonNegativeInteger(value[aidType]))
  );
}

function isCapabilities(value: unknown): boolean {
  return (
    isRecord(value) &&
    CAPABILITIES.every((capability) => typeof value[capability] === "boolean")
  );
}

function isReceiver(value: unknown): value is StateReceiver {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    isLocation(value.location) &&
    typeof value.isOpen === "boolean" &&
    isDemand(value.demand) &&
    isNonNegativeInteger(value.latestArrival) &&
    isNonNegativeInteger(value.storageCapacity) &&
    isNonNegativeInteger(value.currentStorage) &&
    isCapabilities(value.capabilities)
  );
}

function isReservation(value: unknown): value is StateReservation {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.batchId) &&
    isNonEmptyString(value.riderId) &&
    isNonEmptyString(value.receiverId) &&
    isNonNegativeInteger(value.quantity) &&
    isOneOf(value.status, RESERVATION_STATUSES) &&
    isNonNegativeInteger(value.createdAt) &&
    isNonNegativeInteger(value.lastHeartbeatAt) &&
    isNonNegativeInteger(value.leaseExpiresAt) &&
    isNonNegativeInteger(value.pickupDeadline) &&
    isNonNegativeInteger(value.pickupEta) &&
    isNonNegativeInteger(value.travelEta)
  );
}

function isShipment(value: unknown): value is StateShipment {
  if (!isRecord(value)) return false;
  const recovery = value.recovery;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.batchId) &&
    isNonEmptyString(value.reservationId) &&
    isNonEmptyString(value.riderId) &&
    isNonEmptyString(value.receiverId) &&
    isNonNegativeInteger(value.quantity) &&
    isNonNegativeInteger(value.deliveredQuantity) &&
    isNonNegativeInteger(value.pickedUpAt) &&
    (value.deliveredAt === undefined ||
      isNonNegativeInteger(value.deliveredAt)) &&
    isNonNegativeInteger(value.lastHeartbeatAt) &&
    isNonNegativeInteger(value.eta) &&
    isOneOf(value.status, SHIPMENT_STATUSES) &&
    (value.reason === undefined || isString(value.reason)) &&
    (value.reroutedFrom === undefined ||
      isNonEmptyString(value.reroutedFrom)) &&
    (recovery === undefined ||
      (isRecord(recovery) &&
        isNonEmptyString(recovery.riderId) &&
        isNonNegativeInteger(recovery.rendezvousAt) &&
        isLocation(recovery.origin)))
  );
}

function isEvent(value: unknown): value is StateEvent {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonNegativeInteger(value.timestamp) &&
    isNonEmptyString(value.type) &&
    isNonEmptyString(value.entityId) &&
    isString(value.message) &&
    isOneOf(value.severity, EVENT_SEVERITIES)
  );
}

function hasUniqueIds(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const ids = value.map((item) => (isRecord(item) ? item.id : undefined));
  return ids.every(isNonEmptyString) && new Set(ids).size === ids.length;
}

function hasEntity(value: unknown, id: unknown): boolean {
  return (
    isNonEmptyString(id) &&
    Array.isArray(value) &&
    value.some((item) => isRecord(item) && item.id === id)
  );
}

function isOperationsState(value: unknown): value is OperationsState {
  if (!isRecord(value)) return false;
  return (
    isNonNegativeInteger(value.version) &&
    isNonNegativeInteger(value.now) &&
    isNonNegativeInteger(value.sequence) &&
    Array.isArray(value.donors) &&
    value.donors.length > 0 &&
    value.donors.every(isDonor) &&
    hasUniqueIds(value.donors) &&
    Array.isArray(value.batches) &&
    value.batches.length > 0 &&
    value.batches.every(isBatch) &&
    hasUniqueIds(value.batches) &&
    value.batches.every(
      (batch) => isRecord(batch) && hasEntity(value.donors, batch.donorId),
    ) &&
    Array.isArray(value.riders) &&
    value.riders.length > 0 &&
    value.riders.every(isRider) &&
    hasUniqueIds(value.riders) &&
    Array.isArray(value.receivers) &&
    value.receivers.length > 0 &&
    value.receivers.every(isReceiver) &&
    hasUniqueIds(value.receivers) &&
    Array.isArray(value.reservations) &&
    value.reservations.every(isReservation) &&
    hasUniqueIds(value.reservations) &&
    value.reservations.every(
      (reservation) =>
        isRecord(reservation) &&
        hasEntity(value.batches, reservation.batchId) &&
        hasEntity(value.riders, reservation.riderId) &&
        hasEntity(value.receivers, reservation.receiverId),
    ) &&
    Array.isArray(value.shipments) &&
    value.shipments.every(isShipment) &&
    hasUniqueIds(value.shipments) &&
    value.shipments.every(
      (shipment) =>
        isRecord(shipment) &&
        hasEntity(value.batches, shipment.batchId) &&
        hasEntity(value.reservations, shipment.reservationId) &&
        hasEntity(value.riders, shipment.riderId) &&
        hasEntity(value.receivers, shipment.receiverId) &&
        (shipment.recovery === undefined ||
          (isRecord(shipment.recovery) &&
            hasEntity(value.riders, shipment.recovery.riderId))),
    ) &&
    Array.isArray(value.events) &&
    value.events.length > 0 &&
    value.events.every(isEvent) &&
    hasUniqueIds(value.events)
  );
}

function getStorage(): BrowserStorage | null {
  try {
    const storage = globalThis.localStorage;
    if (
      !storage ||
      typeof storage.getItem !== "function" ||
      typeof storage.setItem !== "function"
    )
      return null;
    return storage;
  } catch {
    return null;
  }
}

function useMemoryState(): OperationsState {
  persistence = "memory-only";
  memoryState ??= createSeed();
  return memoryState;
}

function persistState(state: OperationsState): void {
  if (persistence === "memory-only") return;
  const storage = getStorage();
  if (!storage) {
    persistence = "memory-only";
    return;
  }
  try {
    const snapshot: PersistedSnapshot = {
      schemaVersion: BROWSER_DEMO_SCHEMA_VERSION,
      state,
    };
    storage.setItem(BROWSER_DEMO_STORAGE_KEY, JSON.stringify(snapshot));
    persistence = "persisted";
  } catch {
    persistence = "memory-only";
  }
}

function freshState(): OperationsState {
  const state = createSeed();
  memoryState = state;
  persistState(state);
  return state;
}

function parseSnapshot(saved: string): OperationsState | null {
  try {
    const parsed: unknown = JSON.parse(saved);
    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== BROWSER_DEMO_SCHEMA_VERSION ||
      !isOperationsState(parsed.state)
    )
      return null;
    return parsed.state;
  } catch {
    return null;
  }
}

export function readBrowserState(): OperationsState {
  if (persistence === "memory-only" && memoryState) return memoryState;

  const storage = getStorage();
  if (!storage) return useMemoryState();

  let saved: string | null;
  try {
    saved = storage.getItem(BROWSER_DEMO_STORAGE_KEY);
  } catch {
    return useMemoryState();
  }

  if (saved) {
    const state = parseSnapshot(saved);
    if (state) {
      memoryState = state;
      persistence = "persisted";
      return state;
    }
  }

  return freshState();
}

export function getBrowserDemoStatus(): BrowserDemoStatus {
  return { mode: persistence, persisted: persistence === "persisted" };
}

export function resetBrowserDemo(): void {
  const storage = getStorage();
  if (storage) {
    try {
      if (typeof storage.removeItem === "function")
        storage.removeItem(BROWSER_DEMO_STORAGE_KEY);
    } catch {
      // A blocked store is handled by the next read through the memory fallback.
    }
  }
  memoryState = undefined;
  persistence = "persisted";
}

function getLocks(): LockManager | undefined {
  try {
    return globalThis.navigator?.locks;
  } catch {
    return undefined;
  }
}

export async function browserAction(action: Action) {
  const run = () => {
    const result = applyAction(readBrowserState(), action);
    memoryState = result.state;
    persistState(result.state);
    return result;
  };
  let locks: LockManager | undefined;
  try {
    locks = getLocks();
    if (!locks || typeof locks.request !== "function") return run();
  } catch {
    return run();
  }

  let started = false;
  const guardedRun = () => {
    started = true;
    return run();
  };
  try {
    const requested = locks.request(BROWSER_DEMO_STORAGE_KEY, guardedRun);
    return Promise.resolve(requested).catch((error: unknown) => {
      if (started) throw error;
      return run();
    });
  } catch (error) {
    if (started) throw error;
    return run();
  }
}
