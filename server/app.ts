import express from "express";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { applyAction } from "../src/domain/engine";
import { createSeed } from "../src/domain/seed";
import type {
  Action,
  ActionResult,
  OperationsState,
} from "../src/domain/types";

interface Receipt {
  id: string;
  fingerprint: string;
  result: ActionResult;
}
interface Snapshot {
  state: OperationsState;
  receipts: Receipt[];
}
export interface Store {
  read(): Snapshot;
  write(snapshot: Snapshot): void;
}

/** One process owns this local store. Atomic rename keeps interrupted writes from truncating it. */
export function fileStore(path: string): Store {
  return {
    read() {
      if (!existsSync(path)) return { state: createSeed(), receipts: [] };
      const snapshot: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (
        !snapshot ||
        typeof snapshot !== "object" ||
        !("state" in snapshot) ||
        !("receipts" in snapshot)
      )
        throw new Error(
          "Invalid operations snapshot; preserve it and restore a known-good backup.",
        );
      const result = snapshot as Snapshot;
      if (
        !Array.isArray(result.receipts) ||
        !Number.isSafeInteger(result.state.version) ||
        !Array.isArray(result.state.batches) ||
        !Array.isArray(result.state.events)
      )
        throw new Error("Invalid operations snapshot.");
      return result;
    },
    write(snapshot) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(`${path}.tmp`, JSON.stringify(snapshot), { mode: 0o600 });
      renameSync(`${path}.tmp`, path);
    },
  };
}

export function createApplication(store?: Store) {
  let snapshot = store?.read() ?? { state: createSeed(), receipts: [] };
  const app = express();
  app.disable("x-powered-by");
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "16kb", strict: true }));
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, app: "RelaySafe" }),
  );
  app.get("/api/state", (_req, res) => res.json(snapshot.state));
  app.post("/api/actions", (req, res) => {
    // Same-origin browser mutations only. This is a local judge demo, not public authentication.
    const origin = req.get("Origin");
    if (origin && origin !== `${req.protocol}://${req.get("host")}`) {
      res.status(403).json({
        ok: false,
        code: "ORIGIN_REJECTED",
        message: "Use the same-origin RelaySafe interface.",
      });
      return;
    }
    if (!req.is("application/json")) {
      res.status(415).json({
        ok: false,
        code: "JSON_REQUIRED",
        message: "Send a JSON action.",
      });
      return;
    }
    const id = req.get("Idempotency-Key");
    if (id && !/^[a-zA-Z0-9-]{8,100}$/.test(id)) {
      res.status(400).json({
        ok: false,
        code: "INVALID_REQUEST_ID",
        message: "Invalid command identity.",
      });
      return;
    }
    const fingerprint = JSON.stringify(req.body);
    const previous = id
      ? snapshot.receipts.find((receipt) => receipt.id === id)
      : undefined;
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        res.status(409).json({
          ok: false,
          code: "REQUEST_ID_REUSED",
          message: "This command identity belongs to a different action.",
          state: snapshot.state,
        });
        return;
      }
      res.json({ ...previous.result, state: snapshot.state, replayed: true });
      return;
    }
    // No await between read, validate, mutation, persistence and publication: competing claims serialize.
    const result = applyAction(snapshot.state, req.body as Action);
    const next: Snapshot = {
      state: result.state,
      receipts: id
        ? [...snapshot.receipts, { id, fingerprint, result }].slice(-128)
        : snapshot.receipts,
    };
    try {
      store?.write(next);
    } catch {
      res.status(503).json({
        ok: false,
        code: "PERSISTENCE_FAILED",
        message:
          "The command was not published because it could not be saved. Check local disk access.",
        state: snapshot.state,
      });
      return;
    }
    snapshot = next;
    res.json(result);
  });
  app.use("/api", (_req, res) =>
    res
      .status(404)
      .json({ ok: false, code: "NOT_FOUND", message: "Unknown API endpoint." }),
  );
  app.use(
    (
      error: { status?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(error.status === 413 ? 413 : 400).json({
        ok: false,
        code: "INVALID_JSON",
        message: "Request must be a valid bounded JSON object.",
      });
    },
  );
  return app;
}
