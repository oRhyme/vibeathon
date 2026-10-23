export type AidType = 'COOKED_MEALS' | 'RAW_RATIONS' | 'SEALED_KITS' | 'MEDICINE' | 'INFANT_FORMULA';
export type Capability = 'cleanWater' | 'potableWater' | 'cookingFuel' | 'kitchen' | 'servingArea' | 'coldStorage' | 'medicalRefrigeration' | 'cleanContainers' | 'medicalFacility';
export const AID_LABELS: Record<AidType, string> = { COOKED_MEALS: 'Cooked meals', RAW_RATIONS: 'Raw ration kits', SEALED_KITS: 'Sealed aid kits', MEDICINE: 'Medical supplies', INFANT_FORMULA: 'Infant formula' };
export const CAPABILITY_LABELS: Record<Capability, string> = { cleanWater:'Clean water',potableWater:'Potable water',cookingFuel:'Cooking fuel',kitchen:'Cooking facility',servingArea:'Safe serving area',coldStorage:'Cold storage',medicalRefrigeration:'Medical refrigeration',cleanContainers:'Clean containers',medicalFacility:'Medical facility' };
export interface Location { x: number; y: number; label: string }
export interface Donor { id: string; name: string; location: Location }
export interface Batch { id: string; donorId: string; aidType: AidType; quantity: number; readyAt: number; safeUntil: number; requirements: Capability[]; notes: string; unavailable: boolean }
export interface Rider { id: string; name: string; capacity: number; available: boolean; online: boolean; location: Location; lastHeartbeatAt: number }
export interface Receiver { id: string; name: string; location: Location; isOpen: boolean; demand: Record<AidType, number>; latestArrival: number; storageCapacity: number; currentStorage: number; capabilities: Record<Capability, boolean> }
export type ReservationStatus = 'ASSIGNED' | 'ACKNOWLEDGED' | 'EN_ROUTE_TO_DONOR' | 'ARRIVED_AT_DONOR' | 'WARNING_INACTIVE' | 'TIMED_OUT' | 'PICKUP_CONFIRMED' | 'CANCELLED';
export interface Reservation { id: string; batchId: string; riderId: string; receiverId: string; quantity: number; status: ReservationStatus; createdAt: number; lastHeartbeatAt: number; leaseExpiresAt: number; pickupDeadline: number; pickupEta: number; travelEta: number }
export type ShipmentStatus = 'IN_TRANSIT' | 'REROUTE_REQUIRED' | 'RECOVERY_REQUIRED' | 'DELIVERED' | 'EXPIRED';
export interface Shipment { id: string; batchId: string; reservationId: string; riderId: string; receiverId: string; quantity: number; deliveredQuantity: number; pickedUpAt: number; deliveredAt?: number; lastHeartbeatAt: number; eta: number; status: ShipmentStatus; reason?: string; reroutedFrom?: string; recovery?: { riderId: string; rendezvousAt: number; origin: Location } }
export interface OperationEvent { id: string; timestamp: number; type: string; entityId: string; message: string; severity: 'info' | 'success' | 'warning' | 'danger' }
export interface OperationsState { version: number; now: number; donors: Donor[]; batches: Batch[]; riders: Rider[]; receivers: Receiver[]; reservations: Reservation[]; shipments: Shipment[]; events: OperationEvent[]; sequence: number }
export type Action =
 | { type: 'RESET' }
 | { type: 'ADVANCE_TIME'; minutes: number }
 | { type: 'CREATE_BATCH'; aidType: AidType; quantity: number; donorId: string; readyIn: number; expiresIn: number; requirements?: Capability[]; notes?: string }
 | { type: 'UPDATE_BATCH'; batchId: string; quantity?: number; unavailable?: boolean }
 | { type: 'AUTO_DISPATCH'; batchId?: string }
 | { type: 'RESERVE'; batchId: string; riderId: string; receiverId: string; quantity: number }
 | { type: 'ACCEPT' | 'START_PICKUP' | 'ARRIVE' | 'HEARTBEAT' | 'DECLINE'; reservationId: string }
 | { type: 'PICKUP'; reservationId: string; quantity: number }
 | { type: 'DELIVER'; shipmentId: string; quantity: number }
 | { type: 'UPDATE_RIDER'; riderId: string; capacity?: number; available?: boolean; online?: boolean }
 | { type: 'RIDER_FAILURE'; riderId: string }
 | { type: 'REPORT_DELAY'; shipmentId: string; minutes: number }
  | { type: 'RECOVER'; shipmentId: string; riderId: string }
  | { type: 'CONFIRM_RECOVERY'; shipmentId: string }
 | { type: 'REROUTE'; shipmentId: string }
 | { type: 'UPDATE_RECEIVER'; receiverId: string; isOpen?: boolean; aidType?: AidType; demand?: number; capabilities?: Partial<Record<Capability, boolean>>; storageCapacity?: number }
 | { type: 'CREATE_RECEIVER'; name: string; quantity: number; aidType: AidType; storageCapacity: number; capabilities: Record<Capability, boolean>; latestIn: number }
 | { type: 'EXPIRE_BATCH'; batchId: string };
export interface ActionResult { state: OperationsState; ok: boolean; code: string; message: string }
export interface ConsoleProps { state: OperationsState; act: (action: Action) => Promise<void>; busy: boolean }
export const ACTIVE_RESERVATIONS: ReservationStatus[] = ['ASSIGNED','ACKNOWLEDGED','EN_ROUTE_TO_DONOR','ARRIVED_AT_DONOR','WARNING_INACTIVE'];
export function formatTime(minutes: number): string { return `${String(Math.floor(minutes / 60) % 24).padStart(2,'0')}:${String(minutes % 60).padStart(2,'0')}`; }
export function batchTotals(state: OperationsState, batchId: string) {
 const batch = state.batches.find(b => b.id === batchId)!;
 const reserved = state.reservations.filter(r => r.batchId === batchId && ACTIVE_RESERVATIONS.includes(r.status)).reduce((a,r)=>a+r.quantity,0);
 const pickedUp = state.shipments.filter(s=>s.batchId===batchId).reduce((a,s)=>a+s.quantity,0);
 const delivered = state.shipments.filter(s=>s.batchId===batchId).reduce((a,s)=>a+s.deliveredQuantity,0);
 return { reserved, pickedUp, delivered, available: batch.quantity-reserved-pickedUp, total:batch.quantity };
}
