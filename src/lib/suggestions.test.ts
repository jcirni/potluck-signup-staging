import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PENDING_SUGGESTIONS_KEY,
  buildSuggestionPayload,
  flushPendingSuggestions,
  submitSuggestion,
  type DishSuggestionInput,
} from './suggestions.ts'
import { DEFAULT_SUPABASE_URL } from './storage.ts'

const input: DishSuggestionInput = {
  dishName: 'Unicorn Stew',
  ingredients: '1 unicorn, diced\n2 cups broth',
  submitterName: 'Jo',
  eventId: 'friendsgiving',
}

function stubLocalStorage(): Map<string, string> {
  const map = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  })
  return map
}

function queuedPayloads(map: Map<string, string>): unknown[] {
  const raw = map.get(PENDING_SUGGESTIONS_KEY)
  return raw ? (JSON.parse(raw) as unknown[]) : []
}

const okFetch = vi.fn(async () => ({ ok: true })) as unknown as typeof fetch
const failFetch = vi.fn(async () => ({ ok: false })) as unknown as typeof fetch
const throwFetch = vi.fn(async () => {
  throw new Error('offline')
}) as unknown as typeof fetch

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('buildSuggestionPayload', () => {
  it('trims text and turns blank optionals into null', () => {
    const payload = buildSuggestionPayload({ ...input, dishName: '  Unicorn Stew  ', steps: '  ', cuisine: '' })
    expect(payload.dish_name).toBe('Unicorn Stew')
    expect(payload.steps).toBeNull()
    expect(payload.cuisine).toBeNull()
    expect(payload.servings).toBeNull()
    expect(payload.submitter_name).toBe('Jo')
    expect(payload.event_id).toBe('friendsgiving')
  })

  it('keeps provided optionals and clamps servings to the table range', () => {
    const payload = buildSuggestionPayload({ ...input, steps: 'Simmer.', cuisine: 'Fusion', servings: 999 })
    expect(payload.steps).toBe('Simmer.')
    expect(payload.cuisine).toBe('Fusion')
    expect(payload.servings).toBe(500)
    expect(buildSuggestionPayload({ ...input, servings: 0 }).servings).toBeNull()
  })
})

describe('submitSuggestion', () => {
  it('posts to the built-in project dish_suggestions endpoint and reports sent', async () => {
    const map = stubLocalStorage()
    await expect(submitSuggestion(input, okFetch)).resolves.toBe('sent')
    const [url, init] = (okFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${DEFAULT_SUPABASE_URL}/rest/v1/dish_suggestions`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string).dish_name).toBe('Unicorn Stew')
    expect(queuedPayloads(map)).toEqual([])
  })

  it('queues the payload when the POST is rejected (e.g. table not migrated yet)', async () => {
    const map = stubLocalStorage()
    await expect(submitSuggestion(input, failFetch)).resolves.toBe('queued')
    const queued = queuedPayloads(map) as { dish_name: string }[]
    expect(queued).toHaveLength(1)
    expect(queued[0].dish_name).toBe('Unicorn Stew')
  })

  it('queues the payload when the network throws', async () => {
    const map = stubLocalStorage()
    await expect(submitSuggestion(input, throwFetch)).resolves.toBe('queued')
    expect(queuedPayloads(map)).toHaveLength(1)
  })
})

describe('flushPendingSuggestions', () => {
  it('sends everything queued and clears the queue', async () => {
    const map = stubLocalStorage()
    await submitSuggestion(input, failFetch)
    await submitSuggestion({ ...input, dishName: 'Second Dish' }, failFetch)
    expect(queuedPayloads(map)).toHaveLength(2)
    await expect(flushPendingSuggestions(okFetch)).resolves.toBe(2)
    expect(queuedPayloads(map)).toEqual([])
  })

  it('keeps the queue intact when the backend is still unreachable', async () => {
    const map = stubLocalStorage()
    await submitSuggestion(input, failFetch)
    await expect(flushPendingSuggestions(failFetch)).resolves.toBe(0)
    expect(queuedPayloads(map)).toHaveLength(1)
  })
})
