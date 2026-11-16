import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { DietaryNeeds, PotluckEvent, Signup, Targets } from './types.ts'
import { COURSES, DEFAULT_ACCENT, DEFAULT_TARGETS, EMPTY_DIETARY_NEEDS, isAccent, isTimeOfDay, normalizeCourse } from './types.ts'

export type StoreMode = 'supabase' | 'local'

/** Dev stores (local browser storage, the mode switcher) exist only in dev builds or with VITE_ENABLE_DEV_STORES=1. */
export function devStoresEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEV_STORES === '1'
}

/** Production ignores any saved mode: Supabase is the only store. Dev builds honor a saved local mode. */
export function resolveMode(saved: string | null, devStores: boolean = devStoresEnabled()): StoreMode {
  if (!devStores) return 'supabase'
  return saved === 'local' || saved === 'supabase' ? saved : 'supabase'
}

/**
 * One store interface for every backend, so the frontend never talks to a
 * backend directly. Userless: identity is a token; only SHA-256 token
 * hashes are stored server-side (model: docs/BACKEND.md).
 */
export interface SignupStore {
  mode: StoreMode
  label: string
  /** Short human-readable note about what this mode does and does not do. */
  note: string
  /** Event this store is bound to; list/add/update/remove below target it. */
  readonly eventId: string
  createEvent(event: PotluckEvent, adminTokenHash: string): Promise<void>
  getEvent(id: string): Promise<PotluckEvent | null>
  /** Offline modes list events stored in this browser. Supabase returns [] by design: there is no public event directory. */
  listEvents(): Promise<PotluckEvent[]>
  updateEvent(id: string, patch: Partial<PotluckEvent>, adminTokenHash?: string): Promise<void>
  listSignups(eventId: string): Promise<Signup[]>
  addSignup(signup: Signup): Promise<void>
  updateSignup(id: string, patch: Partial<Signup>, editTokenHash?: string): Promise<void>
  removeSignup(id: string, opts?: { eventId: string; editTokenHash?: string; adminTokenHash?: string }): Promise<void>
  /** Signups for the bound event (eventId above). */
  list(): Promise<Signup[]>
  /** Add a signup to the bound event; mints this browser's edit token if it has none. */
  add(signup: Signup): Promise<void>
  /** Edit a signup, using the edit token this browser holds for it. */
  update(id: string, patch: Partial<Signup>): Promise<void>
  /** Remove a signup, using the edit token this browser holds for it. */
  remove(id: string): Promise<void>
}

const LOCAL_EVENTS_KEY = 'potluck:events:v1'
const LOCAL_SIGNUPS_KEY = 'potluck:signups:v1'
const TOKEN_KEY = 'potluck:tokens:v1'
const SUPABASE_URL_KEY = 'potluck:supabase-url'
const SUPABASE_KEY_KEY = 'potluck:supabase-anon-key'

/** Project config comes from the build env (repo variables in the deploy workflow); the production project is the fallback. Both values are public by design; RLS and token checks protect writes. */
export const DEFAULT_SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://qpzohrhtyhwcvukzjoep.supabase.co'
export const DEFAULT_SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwem9ocmh0eWh3Y3Z1a3pqb2VwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2ODUxNDQsImV4cCI6MjExMDI2MTE0NH0.7XhSSNR-KoKrFLQDsZYSNQMOCndbqMkmiRUffau8BiU'

/** The event the single-event UI is bound to (the demo event). */
export const DEFAULT_EVENT_ID = 'friendsgiving'

export function getStoredSetting(key: string): string {
  return localStorage.getItem(key) ?? ''
}

export function setStoredSetting(key: string, value: string): void {
  if (value) localStorage.setItem(key, value)
  else localStorage.removeItem(key)
}

export const SUPABASE_URL_STORAGE_KEY = SUPABASE_URL_KEY
export const SUPABASE_KEY_STORAGE_KEY = SUPABASE_KEY_KEY

/** SHA-256 hex of a token. Only the hash ever leaves the browser. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Edit tokens: one per signup id, kept only in this browser. Minting is
 * idempotent: the backend stored the first token's hash, so replacing a
 * token would orphan the signup (a bug that shipped once; see tests).
 */
export function mintToken(id: string): string {
  const tokens = readTokens()
  const existing = tokens[id]
  if (existing) return existing
  const token = crypto.randomUUID()
  tokens[id] = token
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens))
  return token
}

export function ownsSignup(id: string): boolean {
  return id in readTokens()
}

export function forgetToken(id: string): void {
  const tokens = readTokens()
  delete tokens[id]
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens))
}

function readTokens(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

const ADMIN_TOKEN_PREFIX = 'potluck:admin-token:'

/** Admin token this browser holds for an event (minted when it first ensures the event), if any. */
export function eventAdminToken(eventId: string): string | undefined {
  return localStorage.getItem(`${ADMIN_TOKEN_PREFIX}${eventId}`) ?? undefined
}

/** Keep this browser's raw admin token for an event; only its hash ever goes to the server. */
export function saveAdminToken(eventId: string, token: string): void {
  localStorage.setItem(`${ADMIN_TOKEN_PREFIX}${eventId}`, token)
}

export interface AdminEventRef {
  slug: string
  token: string
}

/** Every event this browser holds an admin token for, sorted by slug; storage is injectable for tests. */
export function scanAdminEvents(storage: Storage = localStorage): AdminEventRef[] {
  const out: AdminEventRef[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (!key || !key.startsWith(ADMIN_TOKEN_PREFIX)) continue
    const slug = key.slice(ADMIN_TOKEN_PREFIX.length)
    const token = storage.getItem(key)
    if (slug && token) out.push({ slug, token })
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug))
}

/** An admin link (?event=<id>&admin=<token>) teaches this browser the token, so host controls unlock here too. */
export function captureAdminTokenFromUrl(): void {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  const eventId = params.get('event')
  const token = params.get('admin')
  if (!eventId || !token) return
  saveAdminToken(eventId, token)
  // Strip the token from the address bar so a stale admin link in history cannot re-apply it on reload.
  params.delete('admin')
  const query = params.toString()
  const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
  window.history.replaceState(null, '', url)
}

/** Hash of the edit token this browser holds for a signup, if any. */
async function storedEditTokenHash(id: string): Promise<string | undefined> {
  const token = readTokens()[id]
  return token ? sha256Hex(token) : undefined
}

/** Ensure this browser holds an edit token for the signup and the signup carries its hash, so it stays editable here. */
async function withEditToken(signup: Signup): Promise<Signup> {
  if (signup.editTokenHash) return signup
  const token = readTokens()[signup.id] ?? mintToken(signup.id)
  return { ...signup, editTokenHash: await sha256Hex(token) }
}

function cleanTargets(raw: unknown): Targets | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const out = {} as Targets
  for (const c of COURSES) {
    if (typeof r[c] !== 'number') return null
    out[c] = r[c]
  }
  // Events stored before the course merge carry a Veggies target; it folds into Sides.
  if (typeof r.Veggies === 'number') out.Sides += r.Veggies
  return out
}

/** Merge stored targets over the defaults, folding any legacy Veggies target into Sides. */
export function mergeTargets(raw: unknown): Targets {
  const out: Targets = { ...DEFAULT_TARGETS }
  if (typeof raw !== 'object' || raw === null) return out
  const r = raw as Record<string, unknown>
  for (const c of COURSES) {
    if (typeof r[c] === 'number') out[c] = r[c]
  }
  if (typeof r.Veggies === 'number') out.Sides += r.Veggies
  return out
}

/** Lenient: older stored events predate dietary needs, so gaps fall back to zero counts. */
function cleanDietaryNeeds(raw: unknown): DietaryNeeds {
  const out: DietaryNeeds = { ...EMPTY_DIETARY_NEEDS }
  if (typeof raw !== 'object' || raw === null) return out
  const r = raw as Record<string, unknown>
  for (const k of Object.keys(out) as (keyof DietaryNeeds)[]) {
    if (typeof r[k] === 'number') out[k] = r[k] as number
  }
  return out
}

export function cleanEvent(raw: unknown): PotluckEvent | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const targets = cleanTargets(r.targets)
  // Length limits mirror the events table checks in backend/supabase.sql.
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || r.name.length < 1 || r.name.length > 120 || !targets) return null
  if (typeof r.location === 'string' && r.location.length > 200) return null
  if (typeof r.details === 'string' && r.details.length > 2000) return null
  return {
    id: r.id,
    name: r.name,
    date: typeof r.date === 'string' ? r.date : '',
    // A malformed stored time is dropped, not fatal: the date alone still renders.
    startTime: isTimeOfDay(r.startTime) ? r.startTime : undefined,
    headcount: typeof r.headcount === 'number' ? r.headcount : 0,
    location: typeof r.location === 'string' && r.location !== '' ? r.location : undefined,
    details: typeof r.details === 'string' && r.details !== '' ? r.details : undefined,
    targets,
    dietaryNeeds: cleanDietaryNeeds(r.dietaryNeeds),
    // Lenient like dietaryNeeds: events stored before accents existed fall back to brass.
    accent: isAccent(r.accent) ? r.accent : DEFAULT_ACCENT,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
  }
}

export function cleanSignup(raw: unknown): Signup | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.dish !== 'string') return null
  // Retired course names (Veggies) fold into their live course instead of dropping the signup.
  const course = typeof r.course === 'string' ? normalizeCourse(r.course) : null
  if (!course) return null
  if (typeof r.eventId !== 'string') return null
  // Length/range limits mirror the signups checks in backend/supabase.sql.
  if (r.name.length < 1 || r.name.length > 80) return null
  if (r.dish.length < 1 || r.dish.length > 120) return null
  if (typeof r.allergies === 'string' && r.allergies.length > 200) return null
  if (typeof r.dishId === 'string' && r.dishId.length > 80) return null
  if (typeof r.scale === 'number' && !(r.scale > 0 && r.scale <= 10)) return null
  return {
    id: r.id,
    eventId: r.eventId,
    dishId: typeof r.dishId === 'string' ? r.dishId : undefined,
    scale: typeof r.scale === 'number' ? r.scale : undefined,
    name: r.name,
    dish: r.dish,
    course,
    needOven: r.needOven === true,
    allergies: typeof r.allergies === 'string' ? r.allergies : '',
    servings: typeof r.servings === 'number' ? r.servings : 0,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
    editTokenHash: typeof r.editTokenHash === 'string' ? r.editTokenHash : undefined,
    sample: r.sample === true ? true : undefined,
  }
}

export function cleanEventList(raw: unknown): PotluckEvent[] {
  if (!Array.isArray(raw)) return []
  return raw.map(cleanEvent).filter((e): e is PotluckEvent => e !== null)
}

export function cleanSignupList(raw: unknown): Signup[] {
  if (!Array.isArray(raw)) return []
  return raw.map(cleanSignup).filter((s): s is Signup => s !== null)
}

/** Demo / single-browser mode, dev builds only. Events and signups live in this browser only. */
export class LocalStore implements SignupStore {
  mode: StoreMode = 'local'
  label = 'This browser only'
  note = 'Events and signups are stored in this browser (localStorage). Good for trying the app; other guests will not see them.'
  readonly eventId: string

  constructor() {
    // Bound event comes from the share link (?event=<id>), else the demo event.
    const fromUrl = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('event') : null
    this.eventId = fromUrl || DEFAULT_EVENT_ID
  }

  private readEvents(): PotluckEvent[] {
    return cleanEventList(JSON.parse(localStorage.getItem(LOCAL_EVENTS_KEY) ?? '[]'))
  }

  private writeEvents(events: PotluckEvent[]): void {
    localStorage.setItem(LOCAL_EVENTS_KEY, JSON.stringify(events))
  }

  private readSignups(): Signup[] {
    return cleanSignupList(JSON.parse(localStorage.getItem(LOCAL_SIGNUPS_KEY) ?? '[]'))
  }

  private writeSignups(signups: Signup[]): void {
    localStorage.setItem(LOCAL_SIGNUPS_KEY, JSON.stringify(signups))
  }

  async createEvent(event: PotluckEvent): Promise<void> {
    this.writeEvents([...this.readEvents(), event])
  }

  async getEvent(id: string): Promise<PotluckEvent | null> {
    return this.readEvents().find((e) => e.id === id) ?? null
  }

  async listEvents(): Promise<PotluckEvent[]> {
    return this.readEvents()
  }

  async updateEvent(id: string, patch: Partial<PotluckEvent>): Promise<void> {
    this.writeEvents(this.readEvents().map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }

  async listSignups(eventId: string): Promise<Signup[]> {
    return this.readSignups().filter((s) => s.eventId === eventId)
  }

  async addSignup(signup: Signup): Promise<void> {
    this.writeSignups([...this.readSignups(), signup])
  }

  async updateSignup(id: string, patch: Partial<Signup>): Promise<void> {
    this.writeSignups(this.readSignups().map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  async removeSignup(id: string): Promise<void> {
    this.writeSignups(this.readSignups().filter((s) => s.id !== id))
  }

  async list(): Promise<Signup[]> {
    return this.listSignups(this.eventId)
  }

  async add(signup: Signup): Promise<void> {
    await this.addSignup({ ...(await withEditToken(signup)), eventId: signup.eventId || this.eventId })
  }

  async update(id: string, patch: Partial<Signup>): Promise<void> {
    await this.updateSignup(id, patch)
  }

  async remove(id: string): Promise<void> {
    await this.removeSignup(id)
  }
}

/**
 * The public backend: Supabase (free Postgres), no accounts. The anon key
 * is publishable by design; RLS plus token-checked functions protect
 * writes (see backend/supabase.sql).
 */
export class SupabaseStore implements SignupStore {
  mode: StoreMode = 'supabase'
  label = 'Supabase (Postgres, public)'
  note = 'One central database for every event anyone creates. The project is configured at build time (docs/BACKEND.md). The tables come from backend/supabase.sql.'
  readonly eventId: string

  private cachedClient: SupabaseClient | null = null
  private cachedConfig = ''

  constructor() {
    // Bound event comes from the share link (?event=<id>), else the demo event.
    const fromUrl = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('event') : null
    this.eventId = fromUrl || DEFAULT_EVENT_ID
  }

  private config(): { url: string; key: string } {
    const url = (getStoredSetting(SUPABASE_URL_KEY) || DEFAULT_SUPABASE_URL).replace(/\/$/, '')
    const key = getStoredSetting(SUPABASE_KEY_KEY) || DEFAULT_SUPABASE_ANON_KEY
    return { url, key }
  }

  private client(): SupabaseClient {
    const { url, key } = this.config()
    const cacheKey = `${url}|${key}`
    if (!this.cachedClient || this.cachedConfig !== cacheKey) {
      this.cachedClient = createClient(url, key)
      this.cachedConfig = cacheKey
    }
    return this.cachedClient
  }

  private eventRow(event: PotluckEvent, adminTokenHash: string): Record<string, unknown> {
    return {
      id: event.id,
      name: event.name,
      date: event.date || null,
      start_time: event.startTime ?? null,
      headcount: event.headcount,
      location: event.location ?? null,
      details: event.details ?? null,
      targets: event.targets,
      dietary_needs: event.dietaryNeeds,
      accent: event.accent,
      admin_token_hash: adminTokenHash,
    }
  }

  private signupRow(signup: Signup): Record<string, unknown> {
    return {
      id: signup.id,
      event_id: signup.eventId,
      dish_id: signup.dishId ?? null,
      scale: signup.scale ?? null,
      name: signup.name,
      dish: signup.dish,
      course: signup.course,
      need_oven: signup.needOven,
      allergies: signup.allergies,
      servings: signup.servings,
      edit_token_hash: signup.editTokenHash ?? null,
    }
  }

  /** Translate a database row (snake_case) into the shape cleanEvent expects. */
  private eventFromRow(r: Record<string, unknown>): PotluckEvent | null {
    return cleanEvent({
      id: r.id,
      name: r.name,
      date: r.date,
      startTime: r.start_time,
      headcount: r.headcount,
      location: r.location,
      details: r.details,
      targets: r.targets,
      dietaryNeeds: r.dietary_needs,
      accent: r.accent,
      createdAt: r.created_at,
    })
  }

  /** Translate a database row (snake_case) into the shape cleanSignup expects. */
  private signupFromRow(r: Record<string, unknown>): unknown {
    return {
      id: r.id,
      eventId: r.event_id,
      dishId: r.dish_id ?? undefined,
      scale: typeof r.scale === 'number' ? r.scale : undefined,
      name: r.name,
      dish: r.dish,
      course: r.course,
      needOven: r.need_oven,
      allergies: r.allergies,
      servings: r.servings,
      createdAt: r.created_at,
      editTokenHash: r.edit_token_hash ?? undefined,
    }
  }

  async createEvent(event: PotluckEvent, adminTokenHash: string): Promise<void> {
    const row = this.eventRow(event, adminTokenHash)
    const { error } = await this.client().from('events').insert(row)
    if (!error) return
    // A database without the start_time migration yet rejects the row; retry without the column.
    if (/start_time/.test(error.message)) {
      const legacy = { ...row }
      delete legacy.start_time
      const retry = await this.client().from('events').insert(legacy)
      if (!retry.error) return
      throw new Error(`Supabase request failed: ${retry.error.message}`)
    }
    throw new Error(`Supabase request failed: ${error.message}`)
  }

  private async fetchEventRow(
    id: string,
    columns: string,
  ): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }> {
    const { data, error } = await this.client().from('events').select(columns).eq('id', id).maybeSingle()
    return { data: data as Record<string, unknown> | null, error }
  }

  async getEvent(id: string): Promise<PotluckEvent | null> {
    const withTime = 'id,name,date,start_time,headcount,location,details,targets,dietary_needs,accent,created_at'
    const withoutTime = 'id,name,date,headcount,location,details,targets,dietary_needs,accent,created_at'
    let { data, error } = await this.fetchEventRow(id, withTime)
    // Same pre-migration fallback as createEvent: read without the column instead of failing.
    if (error && /start_time/.test(error.message)) ({ data, error } = await this.fetchEventRow(id, withoutTime))
    if (error) throw new Error(`Supabase request failed: ${error.message}`)
    return data ? this.eventFromRow(data) : null
  }

  async listEvents(): Promise<PotluckEvent[]> {
    return []
  }

  async updateEvent(id: string, patch: Partial<PotluckEvent>, adminTokenHash?: string): Promise<void> {
    if (!adminTokenHash) throw new Error('The admin link is needed to edit an event. Open the event with its admin link.')
    const { error } = await this.client().rpc('update_event_as_admin', {
      p_event_id: id,
      p_admin_token_hash: adminTokenHash,
      p_patch: patch,
    })
    if (error) throw new Error(`Supabase request failed: ${error.message}`)
  }

  async listSignups(eventId: string): Promise<Signup[]> {
    const { data, error } = await this.client()
      .from('signups')
      .select('*')
      .eq('event_id', eventId)
      .order('created_at', { ascending: true })
    if (error) throw new Error(`Supabase request failed: ${error.message}`)
    return cleanSignupList((data ?? []).map((r) => this.signupFromRow(r as Record<string, unknown>)))
  }

  async addSignup(signup: Signup): Promise<void> {
    const { error } = await this.client().from('signups').insert(this.signupRow(signup))
    if (error) throw new Error(`Supabase request failed: ${error.message}`)
  }

  async updateSignup(id: string, patch: Partial<Signup>, editTokenHash?: string): Promise<void> {
    const hash = editTokenHash ?? (await storedEditTokenHash(id))
    if (!hash) throw new Error('Only the browser that signed up can edit this dish.')
    const { error } = await this.client().rpc('update_signup', {
      p_signup_id: id,
      p_token_hash: hash,
      p_patch: patch,
    })
    if (error) throw new Error(`Supabase request failed: ${error.message}`)
  }

  async removeSignup(
    id: string,
    opts: { eventId: string; editTokenHash?: string; adminTokenHash?: string } = { eventId: this.eventId },
  ): Promise<void> {
    if (opts.adminTokenHash) {
      const { error } = await this.client().rpc('delete_signup_as_admin', {
        p_event_id: opts.eventId,
        p_admin_token_hash: opts.adminTokenHash,
        p_signup_id: id,
      })
      if (error) throw new Error(`Supabase request failed: ${error.message}`)
      return
    }
    const hash = opts.editTokenHash ?? (await storedEditTokenHash(id))
    if (!hash) throw new Error('Only the browser that signed up can remove this dish.')
    const { error } = await this.client().rpc('delete_signup', { p_signup_id: id, p_token_hash: hash })
    if (error) throw new Error(`Supabase request failed: ${error.message}`)
  }

  /**
   * add() has no create-event step, so a missing bound event row is
   * auto-created here. An existing row is left fully alone: minting an
   * admin token for it would poison this browser, since the row carries
   * a different token's hash and every later host save would be rejected.
   */
  private async ensureEvent(): Promise<void> {
    if (await this.getEvent(this.eventId)) return
    const token = eventAdminToken(this.eventId) ?? crypto.randomUUID()
    const { error } = await this.client()
      .from('events')
      .insert({
        id: this.eventId,
        name: this.eventId === DEFAULT_EVENT_ID ? 'Friendsgiving' : this.eventId,
        date: null,
        headcount: 0,
        targets: DEFAULT_TARGETS,
        dietary_needs: EMPTY_DIETARY_NEEDS,
        accent: DEFAULT_ACCENT,
        admin_token_hash: await sha256Hex(token),
      })
    if (!error) {
      // The token is only worth keeping when this insert actually created the row.
      saveAdminToken(this.eventId, token)
      return
    }
    // An insert conflict means the row already existed; keep no token for it.
    if (await this.getEvent(this.eventId)) return
    throw new Error(`Supabase request failed: ${error.message}`)
  }

  async list(): Promise<Signup[]> {
    return this.listSignups(this.eventId)
  }

  async add(signup: Signup): Promise<void> {
    const prepared: Signup = { ...(await withEditToken(signup)), eventId: signup.eventId || this.eventId }
    if (prepared.eventId === this.eventId) await this.ensureEvent()
    await this.addSignup(prepared)
  }

  async update(id: string, patch: Partial<Signup>): Promise<void> {
    await this.updateSignup(id, patch)
  }

  async remove(id: string): Promise<void> {
    await this.removeSignup(id, { eventId: this.eventId })
  }
}

export function createStore(mode: StoreMode): SignupStore {
  // The local store is a dev tool; production builds always use Supabase, whatever mode was saved.
  if (mode === 'local' && devStoresEnabled()) return new LocalStore()
  return new SupabaseStore()
}
