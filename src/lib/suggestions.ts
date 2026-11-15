import { DEFAULT_SUPABASE_ANON_KEY, DEFAULT_SUPABASE_URL } from './storage.ts'

export const PENDING_SUGGESTIONS_KEY = 'potluck:pending-suggestions'

export interface DishSuggestionInput {
  dishName: string
  ingredients: string
  steps?: string
  cuisine?: string
  servings?: number
  submitterName: string
  eventId: string
}

export interface DishSuggestionPayload {
  dish_name: string
  ingredients: string
  steps: string | null
  cuisine: string | null
  servings: number | null
  submitter_name: string
  event_id: string
}

/** Shape a suggestion for the dish_suggestions table: trimmed text, blanks become null, lengths capped to the table checks. */
export function buildSuggestionPayload(input: DishSuggestionInput): DishSuggestionPayload {
  const servings =
    input.servings !== undefined && Number.isFinite(input.servings) && input.servings > 0
      ? Math.min(500, Math.round(input.servings))
      : null
  return {
    dish_name: input.dishName.trim().slice(0, 120),
    ingredients: input.ingredients.trim().slice(0, 4000),
    steps: input.steps?.trim() ? input.steps.trim().slice(0, 4000) : null,
    cuisine: input.cuisine?.trim() ? input.cuisine.trim().slice(0, 40) : null,
    servings,
    submitter_name: input.submitterName.trim().slice(0, 80),
    event_id: input.eventId,
  }
}

type FetchFn = typeof fetch

/** POST one suggestion to the configured Supabase project (same build-env config as the store); true when the row landed. */
async function postSuggestion(payload: DishSuggestionPayload, fetchFn: FetchFn): Promise<boolean> {
  try {
    const res = await fetchFn(`${DEFAULT_SUPABASE_URL}/rest/v1/dish_suggestions`, {
      method: 'POST',
      headers: {
        apikey: DEFAULT_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${DEFAULT_SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
    })
    return res.ok
  } catch {
    return false
  }
}

function readQueue(): DishSuggestionPayload[] {
  try {
    const raw = localStorage.getItem(PENDING_SUGGESTIONS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as DishSuggestionPayload[]) : []
  } catch {
    return []
  }
}

function writeQueue(queue: DishSuggestionPayload[]): void {
  try {
    localStorage.setItem(PENDING_SUGGESTIONS_KEY, JSON.stringify(queue))
  } catch {
    // Storage unavailable: the suggestion is lost, never an error for the guest.
  }
}

/** Send a suggestion now, or park it in the local queue when the backend is unreachable. */
export async function submitSuggestion(input: DishSuggestionInput, fetchFn: FetchFn = fetch): Promise<'sent' | 'queued'> {
  const payload = buildSuggestionPayload(input)
  if (await postSuggestion(payload, fetchFn)) return 'sent'
  writeQueue([...readQueue(), payload])
  return 'queued'
}

/** Retry everything parked in the local queue; returns how many landed. */
export async function flushPendingSuggestions(fetchFn: FetchFn = fetch): Promise<number> {
  const queue = readQueue()
  if (queue.length === 0) return 0
  const remaining: DishSuggestionPayload[] = []
  let sent = 0
  for (const payload of queue) {
    if (await postSuggestion(payload, fetchFn)) sent += 1
    else remaining.push(payload)
  }
  writeQueue(remaining)
  return sent
}
