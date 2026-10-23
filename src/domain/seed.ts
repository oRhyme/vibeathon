import type { AidType, Capability, OperationsState, Receiver } from "./types";

const demand = (meals = 0, rations = 0): Record<AidType, number> => ({
  COOKED_MEALS: meals,
  RAW_RATIONS: rations,
  SEALED_KITS: 0,
  MEDICINE: 0,
  INFANT_FORMULA: 0,
});
const capabilities = (
  overrides: Partial<Record<Capability, boolean>> = {},
): Record<Capability, boolean> => ({
  cleanWater: true,
  potableWater: true,
  cookingFuel: true,
  kitchen: true,
  servingArea: true,
  coldStorage: false,
  medicalRefrigeration: false,
  cleanContainers: true,
  medicalFacility: false,
  ...overrides,
});

/** A fresh, deterministic Bengaluru evening. Nothing has been assigned yet. */
export function createSeed(): OperationsState {
  const now = 21 * 60;
  const receivers: Receiver[] = [
    {
      id: "receiver-1",
      name: "Asha Night Shelter · Shivajinagar",
      location: { x: 8, y: 0, label: "Shivajinagar" },
      isOpen: true,
      demand: demand(50),
      latestArrival: now + 30,
      storageCapacity: 70,
      currentStorage: 0,
      capabilities: capabilities(),
    },
    {
      id: "receiver-2",
      name: "Sahaya Relief Centre · Ulsoor",
      location: { x: 12, y: 2, label: "Ulsoor" },
      isOpen: true,
      demand: demand(80),
      latestArrival: now + 30,
      storageCapacity: 100,
      currentStorage: 0,
      capabilities: capabilities(),
    },
    {
      id: "receiver-3",
      name: "Annapoorna Outreach · Indiranagar",
      location: { x: 16, y: 0, label: "Indiranagar" },
      isOpen: true,
      demand: demand(50),
      latestArrival: now + 30,
      storageCapacity: 70,
      currentStorage: 0,
      capabilities: capabilities(),
    },
    {
      id: "receiver-4",
      name: "Namma Community Kitchen · backup",
      location: { x: 10, y: 8, label: "Domlur community kitchen" },
      isOpen: true,
      demand: demand(100, 40),
      latestArrival: now + 100,
      storageCapacity: 220,
      currentStorage: 0,
      capabilities: capabilities({ coldStorage: true }),
    },
    {
      id: "receiver-5",
      name: "Jeevana Ration Point · gas unavailable",
      location: { x: 9, y: -6, label: "Richmond Town" },
      isOpen: true,
      demand: demand(0, 40),
      latestArrival: now + 60,
      storageCapacity: 60,
      currentStorage: 0,
      capabilities: capabilities({ cookingFuel: false }),
    },
  ];
  return {
    version: 0,
    now,
    sequence: 1,
    donors: [
      {
        id: "donor-1",
        name: "Utsav Banquet Hall",
        location: { x: 0, y: 0, label: "MG Road, Bengaluru" },
      },
      {
        id: "donor-2",
        name: "Seva Essentials Warehouse",
        location: { x: -1, y: 0, label: "Brigade Road, Bengaluru" },
      },
    ],
    batches: [
      {
        id: "batch-1",
        donorId: "donor-1",
        aidType: "COOKED_MEALS",
        quantity: 180,
        readyAt: now,
        safeUntil: now + 45,
        requirements: ["servingArea"],
        notes:
          "180 fresh vegetarian meals after an evening banquet. Keep covered; deliver with a three-minute safety buffer.",
        unavailable: false,
      },
      {
        id: "batch-2",
        donorId: "donor-2",
        aidType: "RAW_RATIONS",
        quantity: 40,
        readyAt: now,
        safeUntil: now + 120,
        requirements: ["cleanWater", "cookingFuel", "kitchen"],
        notes:
          "Dry rice and dal kits require clean water, cooking fuel and a kitchen. Jeevana currently has no gas.",
        unavailable: false,
      },
    ],
    riders: Array.from({ length: 6 }, (_, i) => ({
      id: `rider-${i + 1}`,
      name: [
        "Aarav",
        "Meera",
        "Imran",
        "Kavya",
        "Rohan",
        "Fatima · recovery reserve",
      ][i],
      capacity: 40,
      online: i < 5,
      available: i < 5,
      location: {
        x: -[4, 5, 6, 7, 8, 4][i],
        y: 0,
        label: i < 5 ? "MG Road rider staging" : "Recovery standby",
      },
      lastHeartbeatAt: now,
    })),
    receivers,
    reservations: [],
    shipments: [],
    events: [
      {
        id: "event-1",
        timestamp: now,
        type: "INITIALIZED",
        entityId: "operations",
        message:
          "Evening relay ready: 180 meals, five 40-unit riders, three priority receivers. Fatima is offline on recovery standby.",
        severity: "info",
      },
    ],
  };
}
