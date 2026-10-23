import { afterEach, expect, it, vi } from "vitest";
import { browserAction, readBrowserState } from "../src/browserDemo";

afterEach(() => vi.unstubAllGlobals());
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
