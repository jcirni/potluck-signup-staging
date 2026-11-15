import { beforeEach, describe, expect, it } from 'vitest'
import { buildNewEvent, createUniqueEvent, eventLinks, randomSuffix, uniqueSlug } from './eventCreate.ts'
import { eventAdminToken, sha256Hex, type SignupStore } from './storage.ts'
import { DEFAULT_TARGETS, type PotluckEvent } from './types.ts'

class LocalStorageStub {
  private map = new Map<string, string>()
  getItem(k: string): string | null {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v))
  }
  removeItem(k: string): void {
    this.map.delete(k)
  }
  clear(): void {
    this.map.clear()
  }
}

beforeEach(() => {
  globalThis.localStorage = new LocalStorageStub() as unknown as Storage
})

describe('uniqueSlug', () => {
  it('slugifies the name and appends the suffix', () => {
    expect(uniqueSlug('Friendsgiving 2026!', 'x7k2p')).toBe('friendsgiving-2026-x7k2p')
    expect(uniqueSlug("  Joe's BBQ  ", 'ab12c')).toBe('joe-s-bbq-ab12c')
  })
})

describe('randomSuffix', () => {
  it('is 5 lowercase base36 characters', () => {
    for (let i = 0; i < 20; i++) expect(randomSuffix()).toMatch(/^[a-z0-9]{5}$/)
  })
})

describe('buildNewEvent', () => {
  it('shapes the form input with app defaults', () => {
    const ev = buildNewEvent({ name: '  Taco Night  ', date: '2026-12-05', headcount: 14.8 }, 'taco-night-x7k2p')
    expect(ev.id).toBe('taco-night-x7k2p')
    expect(ev.name).toBe('Taco Night')
    expect(ev.date).toBe('2026-12-05')
    expect(ev.headcount).toBe(14)
    expect(ev.targets).toEqual(DEFAULT_TARGETS)
    expect(ev.accent).toBe('brass')
  })

  it('clamps a negative or non-finite headcount to 0', () => {
    expect(buildNewEvent({ name: 'X', date: '', headcount: -3 }, 'x-a1b2c').headcount).toBe(0)
    expect(buildNewEvent({ name: 'X', date: '', headcount: Number.NaN }, 'x-a1b2c').headcount).toBe(0)
  })
})

describe('eventLinks', () => {
  it('builds the guest link and the admin link carrying the token', () => {
    const links = eventLinks('https://example.com/potluck/', 'taco-night-x7k2p', 'tok-123')
    expect(links.guest).toBe('https://example.com/potluck/?event=taco-night-x7k2p')
    expect(links.admin).toBe('https://example.com/potluck/?event=taco-night-x7k2p&admin=tok-123')
  })
})

/** Minimal in-memory store: only the two methods createUniqueEvent touches. */
function fakeStore(opts: { takenSlugs?: Set<string>; failFirstInsert?: boolean } = {}) {
  const created: { event: PotluckEvent; hash: string }[] = []
  let inserts = 0
  const store = {
    getEvent: async (id: string) => (opts.takenSlugs?.has(id) ? ({ id } as PotluckEvent) : null),
    createEvent: async (event: PotluckEvent, hash: string) => {
      inserts++
      if (opts.failFirstInsert && inserts === 1) throw new Error('duplicate key value violates unique constraint')
      created.push({ event, hash })
    },
  } as unknown as SignupStore
  return { store, created, inserts: () => inserts }
}

describe('createUniqueEvent', () => {
  it('inserts the event with the token hash and keeps the raw token in this browser', async () => {
    const { store, created } = fakeStore()
    const { event, adminToken } = await createUniqueEvent(store, { name: 'Taco Night', date: '', headcount: 0 })
    expect(event.id).toMatch(/^taco-night-[a-z0-9]{5}$/)
    expect(created).toHaveLength(1)
    expect(created[0].hash).toBe(await sha256Hex(adminToken))
    expect(created[0].hash).not.toBe(adminToken)
    expect(eventAdminToken(event.id)).toBe(adminToken)
  })

  it('retries with a fresh suffix when the insert loses a slug race', async () => {
    const { store, created, inserts } = fakeStore({ failFirstInsert: true })
    const { event } = await createUniqueEvent(store, { name: 'Taco Night', date: '', headcount: 0 })
    expect(inserts()).toBe(2)
    expect(created[0].event.id).toBe(event.id)
  })
})
