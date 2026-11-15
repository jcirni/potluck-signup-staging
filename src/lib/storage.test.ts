import { describe, expect, it } from 'vitest'
import { cleanEvent, cleanSignup, mergeTargets, resolveMode, scanAdminEvents } from './storage.ts'
import { DEFAULT_TARGETS, EMPTY_DIETARY_NEEDS } from './types.ts'

function rawSignup(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 's1',
    eventId: 'friendsgiving',
    name: 'Joe',
    dish: 'Salmon',
    course: 'Mains',
    needOven: true,
    allergies: 'None',
    servings: 8,
    createdAt: '2026-11-14T00:00:00.000Z',
    ...partial,
  }
}

function rawEvent(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'friendsgiving',
    name: 'Friendsgiving',
    date: '2026-11-26',
    headcount: 12,
    targets: { ...DEFAULT_TARGETS },
    createdAt: '2026-11-14T00:00:00.000Z',
    ...partial,
  }
}

describe('cleanSignup', () => {
  it('accepts a valid signup and preserves dishId, scale, and the edit token hash', () => {
    const s = cleanSignup(rawSignup({ dishId: 'baked-salmon', scale: 2, editTokenHash: 'abc123' }))
    expect(s).toMatchObject({ id: 's1', dishId: 'baked-salmon', scale: 2, editTokenHash: 'abc123', needOven: true })
  })

  it('fills defaults for optional fields', () => {
    const s = cleanSignup({ id: 's2', eventId: 'e', name: 'A', dish: 'Pie', course: 'Desserts' })
    expect(s).toMatchObject({ allergies: '', servings: 0, needOven: false })
    expect(s?.dishId).toBeUndefined()
    expect(s?.scale).toBeUndefined()
  })

  it('rejects non-objects, missing fields, and unknown courses', () => {
    expect(cleanSignup(null)).toBeNull()
    expect(cleanSignup('nope')).toBeNull()
    expect(cleanSignup(rawSignup({ name: undefined }))).toBeNull()
    expect(cleanSignup(rawSignup({ course: 'Snacks' }))).toBeNull()
    expect(cleanSignup(rawSignup({ eventId: undefined }))).toBeNull()
  })

  it('rejects fields longer than the database limits', () => {
    expect(cleanSignup(rawSignup({ name: 'n'.repeat(81) }))).toBeNull()
    expect(cleanSignup(rawSignup({ name: '' }))).toBeNull()
    expect(cleanSignup(rawSignup({ dish: 'd'.repeat(121) }))).toBeNull()
    expect(cleanSignup(rawSignup({ allergies: 'a'.repeat(201) }))).toBeNull()
    expect(cleanSignup(rawSignup({ dishId: 'x'.repeat(81) }))).toBeNull()
    expect(cleanSignup(rawSignup({ name: 'n'.repeat(80) }))).not.toBeNull()
    expect(cleanSignup(rawSignup({ allergies: 'a'.repeat(200) }))).not.toBeNull()
  })

  it('folds a legacy Veggies signup into Sides instead of dropping it', () => {
    const s = cleanSignup(rawSignup({ course: 'Veggies', dish: 'Grilled Zucchini' }))
    expect(s).not.toBeNull()
    expect(s).toMatchObject({ dish: 'Grilled Zucchini', course: 'Sides' })
  })

  it('rejects out-of-range recipe scales but accepts the boundaries', () => {
    expect(cleanSignup(rawSignup({ scale: 0 }))).toBeNull()
    expect(cleanSignup(rawSignup({ scale: 11 }))).toBeNull()
    expect(cleanSignup(rawSignup({ scale: 10 }))).not.toBeNull()
    expect(cleanSignup(rawSignup({ scale: 0.5 }))).not.toBeNull()
  })
})

describe('cleanEvent', () => {
  it('accepts a valid event and keeps its fields', () => {
    const e = cleanEvent(rawEvent({ dietaryNeeds: { vegetarian: 2, vegan: 1, glutenFree: 0, noPork: 3 } }))
    expect(e).toMatchObject({ id: 'friendsgiving', name: 'Friendsgiving', date: '2026-11-26', headcount: 12 })
    expect(e?.dietaryNeeds).toEqual({ vegetarian: 2, vegan: 1, glutenFree: 0, noPork: 3 })
  })

  it('defaults dietaryNeeds when missing and fills gaps when partial', () => {
    expect(cleanEvent(rawEvent())?.dietaryNeeds).toEqual(EMPTY_DIETARY_NEEDS)
    expect(cleanEvent(rawEvent({ dietaryNeeds: { vegan: 2 } }))?.dietaryNeeds).toEqual({
      vegetarian: 0,
      vegan: 2,
      glutenFree: 0,
      noPork: 0,
    })
  })

  it('keeps a valid accent and defaults anything else to brass', () => {
    expect(cleanEvent(rawEvent({ accent: 'forest' }))?.accent).toBe('forest')
    expect(cleanEvent(rawEvent({ accent: 'burgundy' }))?.accent).toBe('burgundy')
    expect(cleanEvent(rawEvent({ accent: 'neon' }))?.accent).toBe('brass')
    expect(cleanEvent(rawEvent({ accent: 42 }))?.accent).toBe('brass')
    expect(cleanEvent(rawEvent())?.accent).toBe('brass')
  })

  it('defaults date and headcount when absent', () => {
    const e = cleanEvent({ id: 'x', name: 'X', targets: { ...DEFAULT_TARGETS } })
    expect(e).toMatchObject({ date: '', headcount: 0 })
  })

  it('rejects non-objects, missing targets, and over-length names', () => {
    expect(cleanEvent(null)).toBeNull()
    expect(cleanEvent(rawEvent({ targets: undefined }))).toBeNull()
    expect(cleanEvent(rawEvent({ targets: { Mains: 3 } }))).toBeNull()
    expect(cleanEvent(rawEvent({ name: 'n'.repeat(121) }))).toBeNull()
    expect(cleanEvent(rawEvent({ name: 'n'.repeat(120) }))).not.toBeNull()
  })

  it('keeps location and details, and leaves them unset when absent or blank', () => {
    const e = cleanEvent(rawEvent({ location: '820 Lenora St', details: 'Buzz unit 402.\nBring a side!' }))
    expect(e?.location).toBe('820 Lenora St')
    expect(e?.details).toBe('Buzz unit 402.\nBring a side!')
    expect(cleanEvent(rawEvent())?.location).toBeUndefined()
    expect(cleanEvent(rawEvent())?.details).toBeUndefined()
    expect(cleanEvent(rawEvent({ location: '', details: '' }))?.location).toBeUndefined()
    expect(cleanEvent(rawEvent({ location: 42 }))?.details).toBeUndefined()
  })

  it('rejects location and details longer than the database limits', () => {
    expect(cleanEvent(rawEvent({ location: 'l'.repeat(201) }))).toBeNull()
    expect(cleanEvent(rawEvent({ location: 'l'.repeat(200) }))).not.toBeNull()
    expect(cleanEvent(rawEvent({ details: 'd'.repeat(2001) }))).toBeNull()
    expect(cleanEvent(rawEvent({ details: 'd'.repeat(2000) }))).not.toBeNull()
  })

  it('folds a stored Veggies target into Sides for events saved before the merge', () => {
    const legacy = { Appetizers: 2, Mains: 3, Veggies: 2, Sides: 3, Desserts: 2, Drinks: 3, Supplies: 4 }
    const e = cleanEvent(rawEvent({ targets: legacy }))
    expect(e?.targets.Sides).toBe(5)
    expect(e?.targets).not.toHaveProperty('Veggies')
    expect(e?.targets).toEqual({ ...DEFAULT_TARGETS })
  })
})

describe('mergeTargets', () => {
  it('adds a stored Veggies target onto Sides and keeps stored values', () => {
    const merged = mergeTargets({ Sides: 3, Veggies: 2 })
    expect(merged.Sides).toBe(5)
    expect(merged).not.toHaveProperty('Veggies')
    expect(mergeTargets({ Mains: 4 }).Mains).toBe(4)
    expect(mergeTargets(null)).toEqual({ ...DEFAULT_TARGETS })
  })
})

describe('scanAdminEvents', () => {
  // Minimal Storage stand-in backed by a plain record.
  function fakeStorage(entries: Record<string, string>): Storage {
    const keys = Object.keys(entries)
    return {
      length: keys.length,
      key: (i: number) => keys[i] ?? null,
      getItem: (k: string) => entries[k] ?? null,
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
    } as Storage
  }

  it('finds admin tokens by prefix, sorted by slug, ignoring everything else', () => {
    const found = scanAdminEvents(
      fakeStorage({
        'potluck:admin-token:zeta-party': 'tok-z',
        'potluck:tokens:v1': '{"s1":"x"}',
        'potluck:admin-token:alpha-bbq': 'tok-a',
        'potluck:store-mode': 'local',
      }),
    )
    expect(found).toEqual([
      { slug: 'alpha-bbq', token: 'tok-a' },
      { slug: 'zeta-party', token: 'tok-z' },
    ])
  })

  it('skips empty slugs and empty tokens', () => {
    const found = scanAdminEvents(fakeStorage({ 'potluck:admin-token:': 'tok', 'potluck:admin-token:blank': '' }))
    expect(found).toEqual([])
  })
})

describe('resolveMode', () => {
  it('defaults to supabase when nothing is saved', () => {
    expect(resolveMode(null)).toBe('supabase')
  })

  it('keeps a saved local mode only when dev stores are enabled', () => {
    expect(resolveMode('local', true)).toBe('local')
    expect(resolveMode('supabase', true)).toBe('supabase')
  })

  it('ignores any saved mode when dev stores are off, as in production', () => {
    expect(resolveMode('local', false)).toBe('supabase')
    expect(resolveMode(null, false)).toBe('supabase')
  })

  it('falls back to supabase on legacy or garbage values', () => {
    expect(resolveMode('url', true)).toBe('supabase')
    expect(resolveMode('apps-script', true)).toBe('supabase')
    expect(resolveMode('banana')).toBe('supabase')
    expect(resolveMode('')).toBe('supabase')
  })
})
