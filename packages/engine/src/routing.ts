import type { DataClass, RouteDecision, RouteRequest, TaskId } from "./types";
import type { SchemaId } from "./guardrails/validate";

/**
 * The only place where it is decided where a task runs (docs/05 §2). Class S3 never
 * returns a cloud mode, whatever the other inputs are (rule R3).
 */
export function route(req: RouteRequest): RouteDecision {
  const { dataClass, cloudConsent, onDeviceAvailable, online, prefersCloud, hasLiteVariant } = req;
  if (dataClass === "S3") {
    return onDeviceAvailable ? { run: "model", mode: "ONLY_ON_DEVICE", variant: "full" } : { run: "fallback", reason: "no_model" };
  }
  if (dataClass === "S2") {
    if (onDeviceAvailable) return { run: "model", mode: cloudConsent ? "PREFER_ON_DEVICE" : "ONLY_ON_DEVICE", variant: "full" };
    if (cloudConsent && online) return { run: "model", mode: "ONLY_IN_CLOUD", variant: "full" };
    return { run: "fallback", reason: cloudConsent ? "offline" : "no_model" };
  }
  // S1
  if (!cloudConsent) return { run: "fallback", reason: "no_consent" };
  if (online) {
    if (prefersCloud) return { run: "model", mode: hasLiteVariant ? "PREFER_IN_CLOUD" : "ONLY_IN_CLOUD", variant: "full" };
    return { run: "model", mode: onDeviceAvailable ? "PREFER_ON_DEVICE" : "ONLY_IN_CLOUD", variant: "full" };
  }
  if (onDeviceAvailable && (hasLiteVariant || !prefersCloud)) {
    return { run: "model", mode: "ONLY_ON_DEVICE", variant: hasLiteVariant ? "lite" : "full" };
  }
  return { run: "fallback", reason: "offline" };
}

export interface TaskDef {
  task: TaskId;
  dataClass: DataClass;
  priority: "P0" | "P1";
  prefersCloud: boolean;
  hasLiteVariant: boolean;
  /** Structured-output steps: schema id and prompt file id (shared/schemas, shared/prompts). */
  steps: SchemaId[];
}

/** The task list of docs/05 §3. */
export const TASKS: Record<TaskId, TaskDef> = {
  G: { task: "G", dataClass: "S3", priority: "P0", prefersCloud: false, hasLiteVariant: false, steps: ["G"] },
  G2: { task: "G2", dataClass: "S3", priority: "P1", prefersCloud: false, hasLiteVariant: false, steps: [] },
  H: { task: "H", dataClass: "S3", priority: "P0", prefersCloud: false, hasLiteVariant: false, steps: ["H"] },
  I: { task: "I", dataClass: "S3", priority: "P1", prefersCloud: false, hasLiteVariant: false, steps: ["I"] },
  A: { task: "A", dataClass: "S2", priority: "P0", prefersCloud: false, hasLiteVariant: false, steps: ["A"] },
  B: { task: "B", dataClass: "S3", priority: "P1", prefersCloud: false, hasLiteVariant: false, steps: ["B"] },
  C: { task: "C", dataClass: "S2", priority: "P0", prefersCloud: false, hasLiteVariant: false, steps: ["C"] },
  K: { task: "K", dataClass: "S3", priority: "P1", prefersCloud: false, hasLiteVariant: false, steps: ["K"] },
  Q: { task: "Q", dataClass: "S2", priority: "P1", prefersCloud: false, hasLiteVariant: false, steps: ["Q_classify", "Q_phrase"] },
  P: { task: "P", dataClass: "S3", priority: "P1", prefersCloud: false, hasLiteVariant: false, steps: ["P"] },
  D: { task: "D", dataClass: "S1", priority: "P0", prefersCloud: true, hasLiteVariant: true, steps: ["D"] },
  E: { task: "E", dataClass: "S1", priority: "P1", prefersCloud: true, hasLiteVariant: false, steps: ["E"] },
};
