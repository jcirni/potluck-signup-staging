import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PotluckEvent, Signup } from './types.ts'
import { DEFAULT_TARGETS, EMPTY_DIETARY_NEEDS } from './types.ts'

/**
 * Regression tests for the guest edit-token flow (mocked Supabase client
 * mirroring supabase.sql's hash checks). Guards the shipped bug where App
 * minted a second token after add() and clobbered the first.
 */

const db = vi.hoisted(() => ({
  events: new Map<string, Record<string, unknown>>(),
  signups: new Map<string, Record<string, unknown>>(),
}))

vi.mock('@supabase/supabase-js', () => {
  function selectBuilder(table: Map<string, Record<string, unknown>>) {
    const filters: [string, unknown][] = []
    const builder = {
      eq(col: string, val: unknown) {
        filters.push([col, val])
        return builder
      },
      order() {
        return builder
      },
      maybeSingle() {
        const rows = [...table.values()].filter((r) => filters.every(([c, v]) => r[c] === v))
        return Promise.resolve({ data: rows[0] ?? null, error: null })
      },
      then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
        const rows = [...table.values()]
          .filter((r) => filters.every(([c, v]) => r[c] === v))
          .map((r) => ({ ...r }))
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject)
      },
    }
    return builder
  }

  const client = {
    from(name: string) {
      const table = name === 'signups' ? db.signups : db.events
      return {
        insert: async (row: Record<string, unknown>) => {
          table.set(row.id as string, { ...row })
          return { error: null }
        },
        upsert: async (row: Record<string, unknown>, opts?: { ignoreDuplicates?: boolean }) => {
          if (opts?.ignoreDuplicates && table.has(row.id as string)) return { error: null }
          table.set(row.id as string, { ...row })
          return { error: null }
        },
        select: () => selectBuilder(table),
      }
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'update_signup') {
        const row = db.signups.get(args.p_signup_id as string)
        if (!row || row.edit_token_hash !== args.p_token_hash) {
          return { error: { message: 'Not authorized to edit this signup.' } }
        }
        const p = args.p_patch as Record<string, unknown>
        // Same whitelist + coalesce semantics as the SQL function.
        if (p.dishId != null) row.dish_id = p.dishId
        if (p.scale != null) row.scale = p.scale
        if (p.name != null) row.name = p.name
        if (p.dish != null) row.dish = p.dish
        if (p.course != null) row.course = p.course
        if (p.needOven != null) row.need_oven = p.needOven
        if (p.allergies != null) row.allergies = p.allergies
        if (p.servings != null) row.servings = p.servings
        return { error: null }
      }
      if (fn === 'update_event_as_admin') {
        const row = db.events.get(args.p_event_id as string)
        if (!row || row.admin_token_hash !== args.p_admin_token_hash) {
          return { error: { message: 'Not authorized for this event.' } }
        }
        const p = args.p_patch as Record<string, unknown>
        // Same whitelist + coalesce semantics as the SQL function.
        if (p.name != null) row.name = p.name
        if (p.date != null) row.date = p.date
        if (p.headcount != null) row.headcount = p.headcount
        if (p.targets != null) row.targets = p.targets
        if (p.dietaryNeeds != null) row.dietary_needs = p.dietaryNeeds
        if (p.accent != null) row.accent = p.accent
        if (p.location != null) row.location = p.location
        if (p.details != null) row.details = p.details
        return { error: null }
      }
      if (fn === 'delete_signup') {
        const row = db.signups.get(args.p_signup_id as string)
        if (!row || row.edit_token_hash !== args.p_token_hash) {
          return { error: { message: 'Not authorized to remove this signup.' } }
        }
        db.signups.delete(args.p_signup_id as string)
        return { error: null }
      }
      return { error: { message: `unknown rpc ${fn}` } }
    },
  }
  return { createClient: () => client }
})

import { SupabaseStore, mintToken, ownsSignup, sha256Hex } from './storage.ts'

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

function makeSignup(partial: Partial<Signup> = {}): Signup {
  return {
    id: 'signup-1',
    eventId: 'friendsgiving',
    name: 'E2E Tester',
    dish: 'Test Pie',
    course: 'Desserts',
    needOven: false,
    allergies: '',
    servings: 8,
    createdAt: '2026-11-14T00:00:00.000Z',
    ...partial,
  }
}

beforeEach(() => {
  db.events.clear()
  db.signups.clear()
  Object.defineProperty(globalThis, 'localStorage', {
    value: new LocalStorageStub(),
    configurable: true,
    writable: true,
  })
})

describe('SupabaseStore guest edit token across reloads', () => {
  it('stores the hash of the token this browser holds at insert time', async () => {
    const store = new SupabaseStore()
    await store.add(makeSignup())
    const tokens = JSON.parse(localStorage.getItem('potluck:tokens:v1') ?? '{}') as Record<string, string>
    expect(tokens['signup-1']).toBeTruthy()
    expect(db.signups.get('signup-1')?.edit_token_hash).toBe(await sha256Hex(tokens['signup-1']))
    expect(ownsSignup('signup-1')).toBe(true)
  })

  it('edit and remove still work after a reload (new store, same browser storage)', async () => {
    await new SupabaseStore().add(makeSignup())

    const reloaded = new SupabaseStore()
    await reloaded.update('signup-1', { dish: 'Updated Pie', servings: 12 })
    expect(db.signups.get('signup-1')).toMatchObject({ dish: 'Updated Pie', servings: 12 })

    await reloaded.remove('signup-1')
    expect(db.signups.has('signup-1')).toBe(false)
  })

  it('minting again after add() returns the same token instead of overwriting it', async () => {
    // The buggy App's exact sequence: a second mint must not replace the token behind the stored hash.
    await new SupabaseStore().add(makeSignup())
    const again = mintToken('signup-1')
    const tokens = JSON.parse(localStorage.getItem('potluck:tokens:v1') ?? '{}') as Record<string, string>
    expect(again).toBe(tokens['signup-1'])
    expect(db.signups.get('signup-1')?.edit_token_hash).toBe(await sha256Hex(again))

    await new SupabaseStore().update('signup-1', { dish: 'Still Editable Pie' })
    expect(db.signups.get('signup-1')?.dish).toBe('Still Editable Pie')
  })

  it('mintToken is idempotent on its own', () => {
    expect(mintToken('abc')).toBe(mintToken('abc'))
    expect(mintToken('abc')).not.toBe(mintToken('xyz'))
  })

  it('a different browser (no token) cannot edit or remove the signup', async () => {
    await new SupabaseStore().add(makeSignup())

    // Fresh browser profile: same database, empty localStorage.
    Object.defineProperty(globalThis, 'localStorage', {
      value: new LocalStorageStub(),
      configurable: true,
      writable: true,
    })
    const stranger = new SupabaseStore()
    await expect(stranger.update('signup-1', { dish: 'Hijacked Pie' })).rejects.toThrow(
      'Only the browser that signed up can edit this dish.',
    )
    await expect(stranger.remove('signup-1')).rejects.toThrow(
      'Only the browser that signed up can remove this dish.',
    )
    expect(db.signups.get('signup-1')?.dish).toBe('Test Pie')
  })

  it('a mismatched token is rejected the way the SQL function rejects it', async () => {
    await new SupabaseStore().add(makeSignup())
    localStorage.setItem('potluck:tokens:v1', JSON.stringify({ 'signup-1': crypto.randomUUID() }))
    await expect(new SupabaseStore().update('signup-1', { dish: 'Nope' })).rejects.toThrow(
      'Supabase request failed: Not authorized to edit this signup.',
    )
    await expect(new SupabaseStore().remove('signup-1')).rejects.toThrow(
      'Supabase request failed: Not authorized to remove this signup.',
    )
  })

  it('round-trips the event accent and updates it only with the admin hash', async () => {
    const store = new SupabaseStore()
    const event: PotluckEvent = {
      id: 'friendsgiving',
      name: 'Friendsgiving',
      date: '2026-11-26',
      headcount: 12,
      targets: { ...DEFAULT_TARGETS },
      dietaryNeeds: { ...EMPTY_DIETARY_NEEDS },
      accent: 'forest',
      createdAt: '2026-11-14T00:00:00.000Z',
    }
    await store.createEvent(event, 'admin-hash')
    expect(db.events.get('friendsgiving')?.accent).toBe('forest')
    expect((await store.getEvent('friendsgiving'))?.accent).toBe('forest')

    await expect(store.updateEvent('friendsgiving', { accent: 'slate' }, 'wrong-hash')).rejects.toThrow(
      'Not authorized for this event.',
    )
    await store.updateEvent('friendsgiving', { accent: 'slate' }, 'admin-hash')
    expect((await store.getEvent('friendsgiving'))?.accent).toBe('slate')
  })

  it('round-trips event location and details and updates them with the admin hash', async () => {
    const store = new SupabaseStore()
    const event: PotluckEvent = {
      id: 'friendsgiving',
      name: 'Friendsgiving',
      date: '2026-11-26',
      headcount: 12,
      location: 'Stratus Apartments, 820 Lenora St',
      details: 'Buzz unit 402 when you arrive.\nParking is in the garage.',
      targets: { ...DEFAULT_TARGETS },
      dietaryNeeds: { ...EMPTY_DIETARY_NEEDS },
      accent: 'brass',
      createdAt: '2026-11-14T00:00:00.000Z',
    }
    await store.createEvent(event, 'admin-hash')
    expect(db.events.get('friendsgiving')?.location).toBe('Stratus Apartments, 820 Lenora St')
    const loaded = await store.getEvent('friendsgiving')
    expect(loaded?.location).toBe('Stratus Apartments, 820 Lenora St')
    expect(loaded?.details).toBe('Buzz unit 402 when you arrive.\nParking is in the garage.')

    await store.updateEvent('friendsgiving', { location: 'A different hall', details: 'New details.' }, 'admin-hash')
    const updated = await store.getEvent('friendsgiving')
    expect(updated?.location).toBe('A different hall')
    expect(updated?.details).toBe('New details.')
  })

  it('round-trips a created event name other than the demo name', async () => {
    const store = new SupabaseStore()
    const event: PotluckEvent = {
      id: 'e2e-test-potluck-ylh5z',
      name: 'E2E Test Potluck',
      date: '2026-12-24',
      headcount: 10,
      targets: { ...DEFAULT_TARGETS },
      dietaryNeeds: { ...EMPTY_DIETARY_NEEDS },
      accent: 'brass',
      createdAt: '2026-11-14T00:00:00.000Z',
    }
    await store.createEvent(event, 'admin-hash')
    const loaded = await store.getEvent('e2e-test-potluck-ylh5z')
    expect(loaded?.name).toBe('E2E Test Potluck')
    expect(loaded?.date).toBe('2026-12-24')
    expect(loaded?.headcount).toBe(10)
  })

  it('the auto-created event starts with the brass accent', async () => {
    await new SupabaseStore().add(makeSignup())
    expect(db.events.get('friendsgiving')?.accent).toBe('brass')
  })

  it('the auto-created event admin token is stable across reloads', async () => {
    await new SupabaseStore().add(makeSignup())
    const tokenBefore = localStorage.getItem('potluck:admin-token:friendsgiving')
    const hashBefore = db.events.get('friendsgiving')?.admin_token_hash
    expect(tokenBefore).toBeTruthy()
    expect(hashBefore).toBe(await sha256Hex(tokenBefore as string))

    await new SupabaseStore().add(makeSignup({ id: 'signup-2', dish: 'Second Pie' }))
    expect(localStorage.getItem('potluck:admin-token:friendsgiving')).toBe(tokenBefore)
    expect(db.events.get('friendsgiving')?.admin_token_hash).toBe(hashBefore)
  })
})
