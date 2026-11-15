import { saveAdminToken, sha256Hex, type SignupStore } from './storage.ts'
import { DEFAULT_ACCENT, DEFAULT_TARGETS, EMPTY_DIETARY_NEEDS, slugify, type PotluckEvent } from './types.ts'

/** 5-char suffix so two events with the same name rarely collide. */
export function randomSuffix(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(5))
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

/** Slug for a new event: slugified name plus a suffix, e.g. "friendsgiving-2026-x7k2p". */
export function uniqueSlug(name: string, suffix: string): string {
  return `${slugify(name)}-${suffix}`
}

/** Shape the create form into a full event record with the app defaults. */
export function buildNewEvent(input: { name: string; date: string; headcount: number }, slug: string): PotluckEvent {
  return {
    id: slug,
    name: input.name.trim().slice(0, 120),
    date: input.date,
    headcount: Number.isFinite(input.headcount) ? Math.max(0, Math.floor(input.headcount)) : 0,
    targets: { ...DEFAULT_TARGETS },
    dietaryNeeds: { ...EMPTY_DIETARY_NEEDS },
    accent: DEFAULT_ACCENT,
    createdAt: new Date().toISOString(),
  }
}

/** The two links a host gets after creating an event; the admin link carries the raw token. */
export function eventLinks(base: string, slug: string, adminToken: string): { guest: string; admin: string } {
  const guest = `${base}?event=${encodeURIComponent(slug)}`
  return { guest, admin: `${guest}&admin=${encodeURIComponent(adminToken)}` }
}

export interface CreatedEvent {
  event: PotluckEvent
  adminToken: string
}

/** Mint the admin token, keep the raw token in this browser, and insert the event with only its hash. */
export async function createUniqueEvent(
  store: SignupStore,
  input: { name: string; date: string; headcount: number },
): Promise<CreatedEvent> {
  const adminToken = crypto.randomUUID()
  const adminTokenHash = await sha256Hex(adminToken)
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = uniqueSlug(input.name, randomSuffix())
    // A slug already serving an event means the suffix collided; draw another.
    if (await store.getEvent(slug)) continue
    const event = buildNewEvent(input, slug)
    try {
      await store.createEvent(event, adminTokenHash)
    } catch (e) {
      // A concurrent create won the slug race; retry with a fresh suffix.
      if (attempt < 2 && /duplicate|unique|conflict/i.test(e instanceof Error ? e.message : '')) continue
      throw e
    }
    saveAdminToken(slug, adminToken)
    return { event, adminToken }
  }
  throw new Error('Could not find a free link for that name. Try again.')
}
