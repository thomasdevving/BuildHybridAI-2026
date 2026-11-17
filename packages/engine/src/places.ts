import type { Config, EngineState, Place } from "./types";
import { nearestPlace } from "./features/mobility";

/**
 * The user names a place for a rule ("gym") by picking it on a map or tapping "I'm here
 * now" (docs/03 §5). An existing place within the radius gets the label; otherwise a new
 * place is created at that coordinate. Returns the new state and the place id.
 */
export function pickPlace(state: EngineState, lat: number, lon: number, label: string, cfg: Config): { state: EngineState; placeId: string } {
  const places: Place[] = state.places.map((p) => ({ ...p }));
  const hit = nearestPlace(places, lat, lon, cfg.placeRadiusM);
  if (hit) {
    hit.label = label;
    return { state: { ...state, places }, placeId: hit.id };
  }
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "place";
  let id = `pu_${slug}`;
  let k = 2;
  while (places.some((p) => p.id === id)) id = `pu_${slug}_${k++}`;
  places.push({ id, lat, lon, minutes: 0, label });
  return { state: { ...state, places }, placeId: id };
}
