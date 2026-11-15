import type { AdminEventRef } from './storage.ts'
import type { PotluckEvent } from './types.ts'

/** The slug a pasted event link or bare slug points at; null when it carries none. An admin param is never carried over. */
export function extractEventSlug(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  const match = /[?&]event=([^&#\s]+)/.exec(text)
  if (match) {
    try {
      return decodeURIComponent(match[1]) || null
    } catch {
      return match[1]
    }
  }
  // A bare slug is one token of slug characters; anything else is not an event reference.
  return /^[a-z0-9][a-z0-9-]*$/i.test(text) ? text : null
}

export interface YourEvent {
  slug: string
  token?: string
  name?: string
}

/** Merge the admin-token scan with locally stored events: deduped by slug, name filled where known, sorted by slug. */
export function mergeYourEvents(adminRefs: AdminEventRef[], localEvents: PotluckEvent[]): YourEvent[] {
  const bySlug = new Map<string, YourEvent>()
  for (const ref of adminRefs) bySlug.set(ref.slug, { slug: ref.slug, token: ref.token })
  for (const ev of localEvents) {
    const existing = bySlug.get(ev.id)
    if (existing) existing.name = ev.name
    else bySlug.set(ev.id, { slug: ev.id, name: ev.name })
  }
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug))
}
