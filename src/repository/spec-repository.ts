import type { Spec } from "../types.js";

// upsertSpec merges partial fields onto the existing record (preserving untouched keys).
// readSpec storyId is optional — the single-active-session design uses one spec per server.
export interface SpecRepository {
  upsertSpec(fields: Partial<Spec>): Promise<Spec>;
  readSpec(storyId?: string): Promise<Spec | null>;
}
