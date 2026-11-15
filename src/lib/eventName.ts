import type { PotluckEvent } from './types.ts'

/** A loaded event record wins over the browser-local name, which is only the offline fallback. */
export function displayEventName(loaded: PotluckEvent | null, localName: string): string {
  return loaded?.name ? loaded.name : localName
}
