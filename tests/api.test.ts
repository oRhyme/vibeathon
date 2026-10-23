import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplication, fileStore, type Store } from "../server/app";
import type {
  Action,
  ActionResult,
  OperationsState,
} from "../src/domain/types";

const servers: Server[] = [];
const directories: string[] = [];
async function start(store?: Store) {
  const server = createServer(createApplication(store));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    state: async () =>
      (await (await fetch(`${url}/api/state`)).json()) as OperationsState,
    act: async (action: Action, key?: string) =>
      (await (
        await fetch(`${url}/api/actions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(key ? { "Idempotency-Key": key } : {}),
          },
          body: JSON.stringify(action),
        })
      ).json()) as ActionResult,
  };
}
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("central operations API", () => {
  it("serves identical state to independent role clients and serializes competing claims", async () => {
    const api = await start();
    const create = await api.act({
      type: "CREATE_BATCH",
      donorId: "donor-1",
      aidType: "COOKED_MEALS",
      quantity: 40,
      readyIn: 0,
      expiresIn: 60,
    });
    const batchId = create.state.batches.at(-1)!.id;
    const results = await Promise.all(
      ["rider-1", "rider-2"].map((riderId) =>
        api.act({
          type: "RESERVE",
          batchId,
          riderId,
          receiverId: "receiver-1",
          quantity: 40,
        }),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      (await api.state()).reservations.filter((r) => r.batchId === batchId),
    ).toHaveLength(1);
    const receiverClient = await api.state();
    const donorClient = await api.state();
    expect(receiverClient).toEqual(donorClient);
    expect(
      receiverClient.events.some((e) => e.type === "ACTION_REJECTED"),
    ).toBe(true);
  });
  it("deduplicates a command after retries without repeating the physical mutation", async () => {
    const api = await start();
    const action: Action = {
      type: "CREATE_BATCH",
      donorId: "donor-1",
      aidType: "SEALED_KITS",
      quantity: 15,
      readyIn: 0,
      expiresIn: 60,
    };
    const first = await api.act(action, "test-command-123");
    const repeated = await api.act(action, "test-command-123");
    expect(repeated.state.version).toBe(first.state.version);
    expect((await api.state()).batches).toHaveLength(3);
    const different = await api.act(
      { ...action, quantity: 16 },
      "test-command-123",
    );
    expect(different.code).toBe("REQUEST_ID_REUSED");
    expect((await api.state()).version).toBe(first.state.version);
  });
  it("restores operations and command receipts after a server restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "relaysafe-"));
    directories.push(directory);
    const path = join(directory, "operations.json");
    const first = await start(fileStore(path));
    const action: Action = { type: "ADVANCE_TIME", minutes: 3 };
    const saved = await first.act(action, "persistent-command-123");
    const second = await start(fileStore(path));
    expect(await second.state()).toEqual(saved.state);
    const replay = await second.act(action, "persistent-command-123");
    expect(replay.state.now).toBe(1263);
    expect(replay.state.version).toBe(1);
  });
  it("does not publish a mutation if persistence fails", async () => {
    const base = await start();
    const seed = await base.state();
    const api = await start({
      read: () => ({ state: seed, receipts: [] }),
      write: () => {
        throw new Error("disk full");
      },
    });
    const result = await api.act({ type: "ADVANCE_TIME", minutes: 5 });
    expect(result).toMatchObject({ ok: false, code: "PERSISTENCE_FAILED" });
    expect(await api.state()).toEqual(seed);
  });
  it("rejects foreign browser origins, malformed JSON, large bodies and unknown endpoints", async () => {
    const api = await start();
    const origin = await fetch(`${api.url}/api/actions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://foreign.example",
      },
      body: '{"type":"RESET"}',
    });
    expect(origin.status).toBe(403);
    const invalid = await fetch(`${api.url}/api/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{broken",
    });
    expect(invalid.status).toBe(400);
    const large = await fetch(`${api.url}/api/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "UNKNOWN", text: "x".repeat(20000) }),
    });
    expect(large.status).toBe(413);
    expect((await fetch(`${api.url}/api/missing`)).status).toBe(404);
    expect((await api.state()).version).toBe(0);
  });
  it("completes real pickup, receiver closure reroute, safe delivery, and blocks duplicate delivery", async () => {
    const api = await start();
    let result = await api.act({
      type: "RESERVE",
      batchId: "batch-1",
      riderId: "rider-1",
      receiverId: "receiver-2",
      quantity: 40,
    });
    const id = result.state.reservations.at(-1)!.id;
    expect(result.ok).toBe(true);
    await api.act({ type: "ACCEPT", reservationId: id });
    await api.act({ type: "START_PICKUP", reservationId: id });
    await api.act({ type: "ADVANCE_TIME", minutes: 2 });
    await api.act({ type: "ARRIVE", reservationId: id });
    result = await api.act({ type: "PICKUP", reservationId: id, quantity: 40 });
    const shipmentId = result.state.shipments.at(-1)!.id;
    result = await api.act({
      type: "UPDATE_RECEIVER",
      receiverId: "receiver-2",
      isOpen: false,
    });
    const shipment = result.state.shipments.find((s) => s.id === shipmentId)!;
    expect(shipment.receiverId).not.toBe("receiver-2");
    expect(shipment.status).toBe("IN_TRANSIT");
    for (let minute = result.state.now; minute < shipment.eta; minute++) {
      await api.act({ type: "HEARTBEAT", reservationId: id });
      result = await api.act({ type: "ADVANCE_TIME", minutes: 1 });
    }
    result = await api.act({ type: "DELIVER", shipmentId, quantity: 40 });
    expect(result.ok).toBe(true);
    expect(result.state.shipments[0].status).toBe("DELIVERED");
    result = await api.act({ type: "DELIVER", shipmentId, quantity: 40 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("INVALID_TRANSITION");
    expect(result.state.shipments[0].deliveredQuantity).toBe(40);
  });
});
