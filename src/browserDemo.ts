import { applyAction } from "./domain/engine";
import { createSeed } from "./domain/seed";
import type { Action, OperationsState } from "./domain/types";

const KEY = "relaysafe-static-demo-v1";
export function readBrowserState(): OperationsState {
  const saved = localStorage.getItem(KEY);
  if (saved) {
    const state = JSON.parse(saved) as OperationsState;
    if (!Array.isArray(state.batches) || !Array.isArray(state.events) || !Number.isSafeInteger(state.version)) throw new Error("Invalid browser demo snapshot. Clear this site's demo storage to reset it.");
    return state;
  }
  const state = createSeed();
  localStorage.setItem(KEY, JSON.stringify(state));
  return state;
}
export async function browserAction(action: Action) {
  const run = () => {
    const result = applyAction(readBrowserState(), action);
    localStorage.setItem(KEY, JSON.stringify(result.state));
    return result;
  };
  if (navigator.locks) return navigator.locks.request(KEY, run);
  return run();
}
