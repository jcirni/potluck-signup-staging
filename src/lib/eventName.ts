import type { PotluckEvent } from './types.ts'

/** A loaded event record wins over the browser-local name, which is only the offline fallback. */
export function displayEventName(loaded: PotluckEvent | null, localName: string): string {
  return loaded?.name ? loaded.name : localName
}

/** Outcome of the shared event-record load: only 'missing' means the database has no row for the id. */
export type EventLoad = 'pending' | 'found' | 'missing' | 'failed'

/** Only a browser holding the host token needs the warning: its copy of the event may exist on this device only. */
export function showDeviceOnlyNotice(load: EventLoad, hasAdminToken: boolean): boolean {
  return load === 'missing' && hasAdminToken
}
