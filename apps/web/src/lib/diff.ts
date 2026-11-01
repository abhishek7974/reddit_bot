/** Returns only the keys whose (JSON-comparable) values differ — for PATCH bodies. */
export function changedFields<T extends object>(original: T, current: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(current) as (keyof T)[]) {
    if (JSON.stringify(original[key]) !== JSON.stringify(current[key])) out[key] = current[key];
  }
  return out;
}
