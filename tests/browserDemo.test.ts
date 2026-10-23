import { afterEach, expect, it, vi } from "vitest";
import {
  BROWSER_DEMO_SCHEMA_VERSION,
  BROWSER_DEMO_STORAGE_KEY,
  browserAction,
  getBrowserDemoStatus,
  readBrowserState,
  resetBrowserDemo,
} from "../src/browserDemo";

afterEach(() => {
  vi.unstubAllGlobals();
  resetBrowserDemo();
});

it("static hosting executes and persists the real rules without an API", async () => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  });
  vi.stubGlobal("navigator", {});
  expect(readBrowserState().batches[0].quantity).toBe(180);
  const first = await browserAction({
    type: "RESERVE",
    batchId: "batch-1",
    riderId: "rider-1",
    receiverId: "receiver-1",
    quantity: 40,
  });
  expect(first.ok).toBe(true);
  expect(readBrowserState()).toEqual(first.state);
  const second = await browserAction({
    type: "RESERVE",
    batchId: "batch-1",
    riderId: "rider-2",
    receiverId: "receiver-1",
    quantity: 40,
  });
  expect(second.ok).toBe(false);
  expect(readBrowserState().reservations).toHaveLength(1);
});

it("replaces corrupt, old, or invalid snapshots with a fresh versioned seed", () => {
  const data = new Map<string, string>([
    [BROWSER_DEMO_STORAGE_KEY, JSON.stringify({ version: 0, batches: [] })],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  });
  vi.stubGlobal("navigator", {});

  expect(readBrowserState().batches[0].quantity).toBe(180);
  expect(getBrowserDemoStatus()).toEqual({
    mode: "persisted",
    persisted: true,
  });
  expect(JSON.parse(data.get(BROWSER_DEMO_STORAGE_KEY)!)).toMatchObject({
    schemaVersion: BROWSER_DEMO_SCHEMA_VERSION,
    state: { version: 0 },
  });

  data.set(BROWSER_DEMO_STORAGE_KEY, "not-json");
  expect(readBrowserState().batches[0].quantity).toBe(180);
  expect(getBrowserDemoStatus().mode).toBe("persisted");
});

it("continues in memory-only mode when browser storage is blocked", async () => {
  const blocked = () => {
    throw new Error("Storage is blocked");
  };
  vi.stubGlobal("localStorage", {
    getItem: blocked,
    setItem: blocked,
  });
  vi.stubGlobal("navigator", {});

  expect(readBrowserState().batches[0].quantity).toBe(180);
  expect(getBrowserDemoStatus()).toEqual({
    mode: "memory-only",
    persisted: false,
  });

  const result = await browserAction({
    type: "RESERVE",
    batchId: "batch-1",
    riderId: "rider-1",
    receiverId: "receiver-1",
    quantity: 40,
  });
  expect(result.ok).toBe(true);
  expect(readBrowserState()).toEqual(result.state);
  expect(getBrowserDemoStatus().mode).toBe("memory-only");
});
