/** Stable unique ids. crypto.randomUUID is available in all target browsers. */
export function newId(): string {
  return crypto.randomUUID();
}
