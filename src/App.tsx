import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CreateEvent from './components/CreateEvent.tsx'
import Home from './components/Home.tsx'
import { cuisineColor, cuisinesOf, filterDishes, loadCatalog, suggestDishes, type Dish } from './lib/catalog.ts'
import { allergyRollup, computeGaps, countPeople, findDuplicates, neededCourses, type CourseGap } from './lib/gaps.ts'
import { displayEventName, showDeviceOnlyNotice, type EventLoad } from './lib/eventName.ts'
import { isSpamSubmission } from './lib/honeypot.ts'
import { buildICS, calendarPlatform, calendarTarget } from './lib/ics.ts'
import { mapsUrl } from './lib/maps.ts'
import { buildLinksMailto } from './lib/linksEmail.ts'
import { installAction, isIosDevice, isStandalone, shouldShowInstallButton } from './lib/install.ts'
import { SAMPLE_SIGNUPS } from './lib/seed.ts'
import { flushPendingSuggestions, submitSuggestion } from './lib/suggestions.ts'
import {
  DEFAULT_SUPABASE_ANON_KEY,
  DEFAULT_SUPABASE_URL,
  SUPABASE_KEY_STORAGE_KEY,
  SUPABASE_URL_STORAGE_KEY,
  captureAdminTokenFromUrl,
  createStore,
  devStoresEnabled,
  eventAdminToken,
  forgetToken,
  getStoredSetting,
  ownsSignup,
  resolveMode,
  setStoredSetting,
  sha256Hex,
  type SignupStore,
  type StoreMode,
} from './lib/storage.ts'
import {
  ACCENTS,
  COURSES,
  DEFAULT_ACCENT,
  DEFAULT_TARGETS,
  isAccent,
  isCourse,
  isTimeOfDay,
  type Accent,
  type Course,
  type PotluckEvent,
  type Signup,
  type Targets,
} from './lib/types.ts'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// Picker labels for the stored accent keys.
const ACCENT_LABELS: Record<Accent, string> = { brass: 'Coral', burgundy: 'Plum', forest: 'Teal', slate: 'Charcoal' }

const MODE_KEY = 'potluck:store-mode'
const EVENT_KEY = 'potluck:event-name'
const ACCENT_KEY = 'potluck:accent'

function emptyForm(): { name: string; dish: string; course: Course; needOven: boolean; allergies: string; servings: string } {
  return { name: '', dish: '', course: 'Mains', needOven: false, allergies: '', servings: '' }
}

/** '2026-11-26' -> 'Thursday, November 26, 2026'; unparseable input passes through. */
function formatEventDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

/** '17:00' -> '5:00 PM'; invalid input passes through. */
function formatEventTime(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm)
  if (!m) return hhmm
  const h24 = Number(m[1])
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${m[2]} ${h24 >= 12 ? 'PM' : 'AM'}`
}

/** Progress line for one course in the gap view. */
function gapText(g: CourseGap): string {
  if (g.target === 0) return 'no target set'
  return `${g.count} of ${g.target}`
}

export default function App() {
  // The bare URL is the home page; an event page needs ?event=.
  const [isHome] = useState(() => {
    if (typeof window === 'undefined') return false
    return !new URLSearchParams(window.location.search).get('event')
  })
  const [mode, setMode] = useState<StoreMode>(() => resolveMode(localStorage.getItem(MODE_KEY)))
  const [store, setStore] = useState<SignupStore>(() => createStore(mode))
  const [signups, setSignups] = useState<Signup[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [targets, setTargets] = useState<Targets>({ ...DEFAULT_TARGETS })
  const [eventName, setEventName] = useState(() => localStorage.getItem(EVENT_KEY) ?? 'Friendsgiving')
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  const [confirmClearSamples, setConfirmClearSamples] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [standalone] = useState(isStandalone)
  const [justInstalled, setJustInstalled] = useState(false)
  const [iosDevice] = useState(isIosDevice)
  const [installHint, setInstallHint] = useState<'ios' | 'menu' | null>(null)
  const [event, setEvent] = useState<PotluckEvent | null>(null)
  const [eventLoad, setEventLoad] = useState<EventLoad>('pending')
  const [accent, setAccent] = useState<Accent>(() => {
    const saved = localStorage.getItem(ACCENT_KEY)
    return isAccent(saved) ? saved : DEFAULT_ACCENT
  })
  const [dishes, setDishes] = useState<Dish[]>([])
  const [dishFilter, setDishFilter] = useState('')
  const [dishCourse, setDishCourse] = useState<Course | 'All'>('All')
  const [dishCuisine, setDishCuisine] = useState('All')
  const [pickedDishId, setPickedDishId] = useState<string | null>(null)
  const [dishListOpen, setDishListOpen] = useState(false)
  const [recipePrompt, setRecipePrompt] = useState<{ dish: string; name: string; servings: number } | null>(null)
  const [recipeOpen, setRecipeOpen] = useState(false)
  const [recipeForm, setRecipeForm] = useState({ ingredients: '', steps: '', cuisine: '', servings: '' })
  const [recipeError, setRecipeError] = useState('')
  const [recipeThanks, setRecipeThanks] = useState(false)
  const [recipeHoneypot, setRecipeHoneypot] = useState('')
  const [detailsForm, setDetailsForm] = useState({ location: '', time: '', details: '' })
  const [detailsSaved, setDetailsSaved] = useState(false)
  const [detailsError, setDetailsError] = useState('')
  const [targetsForm, setTargetsForm] = useState<Targets>({ ...DEFAULT_TARGETS })
  const [targetsSaved, setTargetsSaved] = useState(false)
  const [targetsError, setTargetsError] = useState('')
  const [formInView, setFormInView] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const formSectionRef = useRef<HTMLElement>(null)
  const gapSectionRef = useRef<HTMLElement>(null)
  const menuSectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setInstallPrompt(null)
      setJustInstalled(true)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  // The drawer and create sheet close on Escape and lock page scroll while open.
  useEffect(() => {
    if (!manageOpen && !createOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setManageOpen(false)
        setCreateOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [manageOpen, createOpen])

  const installApp = useCallback(async () => {
    if (!installPrompt) return
    await installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(null)
  }, [installPrompt])
  const [supabaseUrl, setSupabaseUrl] = useState(
    () => getStoredSetting(SUPABASE_URL_STORAGE_KEY) || DEFAULT_SUPABASE_URL,
  )
  const [supabaseKey, setSupabaseKey] = useState(
    () => getStoredSetting(SUPABASE_KEY_STORAGE_KEY) || DEFAULT_SUPABASE_ANON_KEY,
  )

  const refresh = useCallback(async (s: SignupStore, seedIfEmpty: boolean) => {
    setError('')
    try {
      const list = await s.list()
      // Seed the 2024 samples once per offline mode, through the store; the flag keeps a manual clear cleared.
      const seedKey = `potluck:seeded:${s.mode}`
      if (list.length === 0 && seedIfEmpty && !localStorage.getItem(seedKey)) {
        for (const sample of SAMPLE_SIGNUPS) await s.add(sample)
        localStorage.setItem(seedKey, '1')
        setSignups(SAMPLE_SIGNUPS)
      } else {
        setSignups(list)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load signups.')
      setSignups([])
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    // An admin link opened in a new browser hands this browser its host token.
    captureAdminTokenFromUrl()
    const s = createStore(mode)
    setStore(s)
    setConfirmRemoveId(null)
    setConfirmClearSamples(false)
    localStorage.setItem(MODE_KEY, mode)
    // The home page binds no event: no signup load, no demo seeding, no event record fetch.
    if (isHome) {
      setLoaded(true)
      return
    }
    setLoaded(false)
    // Seed samples only for the dev local store; the central backend starts empty.
    void refresh(s, mode === 'local')
    // The event record carries the date, accent, and host details; modes without one leave it null.
    setEvent(null)
    setEventLoad('pending')
    void s
      .getEvent(s.eventId)
      .then((ev) => {
        setEvent(ev)
        setEventLoad(ev ? 'found' : 'missing')
        if (ev) {
          setAccent(ev.accent)
          setEventName(ev.name)
          setTargets(ev.targets)
          setTargetsForm(ev.targets)
          setTargetsSaved(false)
          setTargetsError('')
          setDetailsForm({ location: ev.location ?? '', time: ev.startTime ?? '', details: ev.details ?? '' })
          setDetailsSaved(false)
          setDetailsError('')
        }
      })
      .catch(() => {
        setEvent(null)
        setEventLoad('failed')
      })
  }, [mode, refresh, isHome])

  useEffect(() => {
    // The catalog powers the dish picker; without it the form still works as free text.
    void loadCatalog().then((c) => setDishes(c.dishes)).catch(() => setDishes([]))
  }, [])

  useEffect(() => {
    // Dish suggestions parked while the backend was unreachable retry on load.
    void flushPendingSuggestions()
  }, [])

  useEffect(() => {
    const el = formSectionRef.current
    if (!el) return
    const obs = new IntersectionObserver(([entry]) => setFormInView(entry.isIntersecting), { rootMargin: '-30% 0px -30% 0px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const gaps = useMemo(() => neededCourses(signups, targets), [signups, targets])
  const allGaps = useMemo(() => computeGaps(signups, targets), [signups, targets])
  const duplicates = useMemo(() => findDuplicates(signups), [signups])
  const peopleCount = useMemo(() => countPeople(signups), [signups])
  const allergies = useMemo(() => allergyRollup(signups), [signups])
  const hasSample = signups.some((s) => s.sample)
  // '' until the event has a date; that is what gates the calendar button.
  const icsText = useMemo(() => (event ? buildICS(event, signups) : ''), [event, signups])
  // A plain link whose target is ready at render: the tap itself opens it, so iOS cannot swallow it behind a share sheet.
  const calTarget = useMemo(
    () => (event && icsText ? calendarTarget(calendarPlatform(), event, signups) : null),
    [event, signups, icsText],
  )
  const [calHref, setCalHref] = useState('')
  useEffect(() => {
    if (calTarget?.kind !== 'ics') {
      setCalHref('')
      return
    }
    const url = URL.createObjectURL(new Blob([calTarget.text], { type: 'text/calendar' }))
    setCalHref(url)
    return () => URL.revokeObjectURL(url)
  }, [calTarget])
  // Holding the event's admin token makes this browser the host: it can edit or remove any signup.
  const isHost = eventAdminToken(store.eventId) !== undefined
  const showInstallButton = shouldShowInstallButton(standalone, justInstalled)
  const pickedDish = useMemo(() => dishes.find((d) => d.id === pickedDishId) ?? null, [dishes, pickedDishId])
  const filteredDishes = useMemo(
    () => filterDishes(dishes, { query: dishFilter, course: dishCourse, cuisine: dishCuisine }),
    [dishes, dishFilter, dishCourse, dishCuisine],
  )
  const cuisineOptions = useMemo(() => cuisinesOf(dishes), [dishes])
  // The search text doubles as an add-your-own entry unless it exactly names a catalog dish.
  const ownDishName = dishFilter.trim()
  const showOwnDish = ownDishName !== '' && !filteredDishes.some((d) => d.name.toLowerCase() === ownDishName.toLowerCase())
  const dishSuggestions = useMemo(() => suggestDishes(dishes, form.dish), [dishes, form.dish])

  /** Sticky mobile button target: bring the signup form into view. */
  function scrollToForm() {
    formSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  /** Shortcut directory target: smooth-scroll a page section into view. */
  function scrollToSection(ref: React.RefObject<HTMLElement | null>) {
    ref.current?.scrollIntoView({ behavior: 'smooth' })
  }

  /** Claim-a-dish: preselect the course, then put the guest at the top of the form. */
  function claimCourse(course: Course) {
    setEditingId(null)
    setForm((f) => ({ ...f, course }))
    formSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
    window.setTimeout(() => nameRef.current?.focus({ preventScroll: true }), 400)
  }

  /** Adding your own dish from the search box: the typed text becomes the dish, un-picked. */
  function addOwnDish() {
    const name = dishFilter.trim()
    if (!name) return
    setPickedDishId(null)
    setForm((f) => ({ ...f, dish: name }))
    nameRef.current?.focus({ preventScroll: true })
  }

  /** Picking a catalog dish fills the form from it; the dish id rides along on submit. */
  function pickDish(d: Dish) {
    setPickedDishId(d.id)
    setForm((f) => ({
      ...f,
      dish: d.name,
      course: d.course,
      needOven: d.logistics.needsOven,
      servings: d.servings > 0 ? String(d.servings) : f.servings,
    }))
  }

  /** Save course targets through the same host path as the details, so every guest sees them. */
  async function saveCourseTargets() {
    setTargetsError('')
    try {
      if (mode === 'supabase') {
        const token = eventAdminToken(store.eventId)
        if (token) await store.updateEvent(store.eventId, { targets: targetsForm }, await sha256Hex(token))
      } else if (event) {
        await store.updateEvent(store.eventId, { targets: targetsForm })
      }
      setTargets(targetsForm)
      setEvent((prev) => (prev ? { ...prev, targets: targetsForm } : prev))
      setTargetsSaved(true)
    } catch (err) {
      setTargetsError(err instanceof Error ? err.message : 'Could not save the course targets.')
    }
  }

  function saveEventName(name: string) {
    setEventName(name)
    localStorage.setItem(EVENT_KEY, name)
  }

  /** Leaving the name field saves it to the event itself when this browser is the host. */
  async function persistEventName() {
    const name = eventName.trim().slice(0, 120)
    if (!name || !event || name === event.name || !canEditAccent) return
    try {
      if (mode === 'supabase') {
        const token = eventAdminToken(store.eventId)
        if (token) await store.updateEvent(store.eventId, { name }, await sha256Hex(token))
      } else {
        await store.updateEvent(store.eventId, { name })
      }
      setEvent((prev) => (prev ? { ...prev, name } : prev))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the event name.')
    }
  }

  // Accent editing is the host's: on Supabase that means holding the event's admin token.
  const canEditAccent = mode === 'supabase' ? eventAdminToken(store.eventId) !== undefined : true

  // The drawer's email link carries the host link only when this browser holds the admin token.
  const guestLink = `${window.location.origin}${window.location.pathname}?event=${encodeURIComponent(store.eventId)}`
  const heldAdminToken = eventAdminToken(store.eventId)
  const linksMailto = buildLinksMailto({
    eventName: displayEventName(event, eventName),
    guestUrl: guestLink,
    adminUrl: heldAdminToken ? `${guestLink}&admin=${encodeURIComponent(heldAdminToken)}` : undefined,
  })

  /** Re-skin at once, then persist: admin RPC on Supabase, the stored event record elsewhere. */
  async function pickAccent(next: Accent) {
    setAccent(next)
    localStorage.setItem(ACCENT_KEY, next)
    try {
      if (mode === 'supabase') {
        const token = eventAdminToken(store.eventId)
        if (token) await store.updateEvent(store.eventId, { accent: next }, await sha256Hex(token))
      } else if (event) {
        await store.updateEvent(store.eventId, { accent: next })
      }
      setEvent((prev) => (prev ? { ...prev, accent: next } : prev))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the accent color.')
    }
  }

  /** Save location + start time + details through the same host path as the accent. */
  async function saveEventDetails() {
    const location = detailsForm.location.trim()
    const details = detailsForm.details.trim()
    // A cleared or malformed time input saves as '' and clears the stored time.
    const startTime = isTimeOfDay(detailsForm.time) ? detailsForm.time : ''
    setDetailsError('')
    try {
      if (mode === 'supabase') {
        const token = eventAdminToken(store.eventId)
        if (token) await store.updateEvent(store.eventId, { location, details, startTime }, await sha256Hex(token))
      } else if (event) {
        await store.updateEvent(store.eventId, { location, details, startTime: startTime || undefined })
      }
      setEvent((prev) =>
        prev ? { ...prev, location: location || undefined, details: details || undefined, startTime: startTime || undefined } : prev,
      )
      setDetailsSaved(true)
    } catch (err) {
      setDetailsError(err instanceof Error ? err.message : 'Could not save the event details.')
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const name = form.name.trim()
    const dish = form.dish.trim()
    if (!name || !dish) {
      setError('Name and dish are both required.')
      return
    }
    const servings = form.servings === '' ? 0 : Math.max(0, Number(form.servings) || 0)
    // The catalog id only rides along while the dish text still matches the picked dish.
    const dishId = pickedDish && pickedDish.name === dish ? pickedDish.id : undefined
    setError('')
    try {
      if (editingId) {
        const patch = {
          name,
          dish,
          dishId,
          course: form.course,
          needOven: form.needOven,
          allergies: form.allergies.trim(),
          servings,
          sample: undefined,
        }
        // Editing someone else's dish goes through the host path, which checks the admin token instead.
        const adminToken = eventAdminToken(store.eventId)
        if (!ownsSignup(editingId) && adminToken) {
          await store.updateSignup(editingId, patch, { eventId: store.eventId, adminTokenHash: await sha256Hex(adminToken) })
        } else {
          await store.update(editingId, patch)
        }
        setNotice('Updated.')
      } else {
        const signup: Signup = {
          id: crypto.randomUUID(),
          eventId: store.eventId,
          dishId,
          name,
          dish,
          course: form.course,
          needOven: form.needOven,
          allergies: form.allergies.trim(),
          servings,
          createdAt: new Date().toISOString(),
        }
        await store.add(signup)
        setNotice('You are signed up. Your edit link is saved in this browser, so you can change or remove your dish later.')
        // A dish that did not come from the catalog earns a quiet ask for its recipe.
        if (dishId) {
          setRecipePrompt(null)
        } else {
          setRecipePrompt({ dish, name, servings })
          setRecipeForm({ ingredients: '', steps: '', cuisine: '', servings: servings > 0 ? String(servings) : '' })
          setRecipeOpen(false)
          setRecipeError('')
          setRecipeThanks(false)
        }
      }
      setForm(emptyForm())
      setPickedDishId(null)
      setEditingId(null)
      await refresh(store, false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that signup.')
    }
  }

  /** Send the recipe behind a new dish; delivery queues locally when the backend is unreachable. */
  async function submitRecipe(e: React.FormEvent) {
    e.preventDefault()
    if (!recipePrompt) return
    // A filled honeypot means a bot: show the thanks, send nothing.
    if (isSpamSubmission(recipeHoneypot)) {
      setRecipeThanks(true)
      return
    }
    if (!recipeForm.ingredients.trim()) {
      setRecipeError('Add at least one ingredient so we can work out the nutrition.')
      return
    }
    setRecipeError('')
    await submitSuggestion({
      dishName: recipePrompt.dish,
      ingredients: recipeForm.ingredients,
      steps: recipeForm.steps,
      cuisine: recipeForm.cuisine,
      servings: recipeForm.servings === '' ? undefined : Number(recipeForm.servings),
      submitterName: recipePrompt.name,
      eventId: store.eventId,
    })
    setRecipeThanks(true)
  }

  async function removeSignup(s: Signup) {
    setConfirmRemoveId(null)
    try {
      // Removing someone else's dish goes through the host path, which checks the admin token instead.
      const adminToken = eventAdminToken(store.eventId)
      if (!ownsSignup(s.id) && adminToken) {
        await store.removeSignup(s.id, { eventId: store.eventId, adminTokenHash: await sha256Hex(adminToken) })
      } else {
        await store.remove(s.id)
        forgetToken(s.id)
      }
      await refresh(store, false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that signup.')
    }
  }

  async function clearSample() {
    setConfirmClearSamples(false)
    try {
      for (const s of signups.filter((x) => x.sample)) await store.remove(s.id)
      await refresh(store, false)
    } catch (err) {
      // The local store seeds from memory, so clearing is local state.
      setSignups(signups.filter((x) => !x.sample))
      setError(err instanceof Error ? err.message : '')
    }
  }

  function copyShareLink() {
    const url = window.location.href
    void navigator.clipboard.writeText(url).then(
      () => setNotice('Link copied.'),
      () => setError('Could not copy the link. Copy it from the address bar instead.'),
    )
  }

  function openCreate() {
    setManageOpen(false)
    setCreateOpen(true)
  }

  // Footer install: captured prompt, iOS Share hint, or the browser-menu hint.
  async function installFromFooter() {
    const action = installAction(installPrompt !== null, iosDevice)
    if (action === 'prompt') {
      await installApp()
      return
    }
    const hint = action === 'ios-hint' ? 'ios' : 'menu'
    setInstallHint((cur) => (cur === hint ? null : hint))
  }

  function startEdit(s: Signup) {
    setConfirmRemoveId(null)
    setPickedDishId(s.dishId ?? null)
    setForm({
      name: s.name,
      dish: s.dish,
      course: s.course,
      needOven: s.needOven,
      allergies: s.allergies,
      servings: s.servings > 0 ? String(s.servings) : '',
    })
    setEditingId(s.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (isHome) {
    return (
      <div className="page" data-accent={accent}>
        <Home
          store={store}
          mode={mode}
          showInstallButton={showInstallButton}
          installHint={installHint}
          onInstall={() => void installFromFooter()}
        />
      </div>
    )
  }

  return (
    <div className="page" data-accent={accent}>
      <header className="hero">
        <button
          type="button"
          className="burger"
          onClick={() => setManageOpen(true)}
          aria-label="Manage event"
          aria-haspopup="dialog"
        >
          <span />
          <span />
          <span />
        </button>
        <p className="hero-eyebrow">Bring a Dish</p>
        <h1 className="hero-name">{displayEventName(event, eventName)}</h1>
        {event?.date && (
          <p className="hero-date">
            {formatEventDate(event.date)}
            {event.startTime ? ` · ${formatEventTime(event.startTime)}` : ''}
          </p>
        )}
        {event?.location && (
          <p className="hero-location">
            <a href={mapsUrl(event.location)} target="_blank" rel="noopener noreferrer">
              {event.location}
            </a>
          </p>
        )}
        <div className="stats" data-count={2}>
          <div className="stat">
            <span className="stat-num">{peopleCount}</span>
            <span className="stat-label">{peopleCount === 1 ? 'person' : 'people'} signed up</span>
          </div>
          <div className="stat">
            <span className="stat-num">{signups.length}</span>
            <span className="stat-label">dishes on the menu</span>
          </div>
        </div>
        <nav className="hero-nav" aria-label="Jump to a section">
          <button type="button" onClick={() => scrollToSection(menuSectionRef)}>
            The menu
          </button>
          <button type="button" onClick={() => scrollToSection(gapSectionRef)}>
            What&rsquo;s needed
          </button>
          <button type="button" onClick={scrollToForm}>
            Add Dish
          </button>
        </nav>
        <div className="hero-actions">
          <button type="button" className="link" onClick={copyShareLink}>
            Copy share link
          </button>
          {calTarget?.kind === 'google' ? (
            <a className="link" href={calTarget.url} target="_blank" rel="noopener noreferrer">
              Add to calendar
            </a>
          ) : calTarget?.kind === 'ics' && calHref ? (
            <a className="link" href={calHref} {...(calTarget.download ? { download: calTarget.filename } : {})}>
              Add to calendar
            </a>
          ) : null}
        </div>
      </header>
      {showDeviceOnlyNotice(eventLoad, eventAdminToken(store.eventId) !== undefined) && (
        <div className="notice-band">
          <p className="notice" role="alert">
            This event isn&rsquo;t in the shared database yet. It may have been created on this device only.
          </p>
        </div>
      )}
      {event?.details && (
        <div className="details-band">
          <section className="details-card">
            <p className="details-text">{event.details}</p>
          </section>
        </div>
      )}
      <div className="menu-band">
      <section id="menu" ref={menuSectionRef}>
        <h2>The menu so far</h2>
        {!loaded ? (
          <p className="hint">Loading…</p>
        ) : signups.length === 0 ? (
          <p className="hint">Nobody has signed up yet. Be the first.</p>
        ) : (
          <div className="menu-grid">
            {COURSES.map((course) => {
              const rows = signups.filter((s) => s.course === course)
              if (rows.length === 0) return null
              return (
                <div key={course} className="course-group">
                  <h3>
                    {course} ({rows.length})
                  </h3>
                  <ul className="menu">
                    {rows.map((s) => {
                      const canEdit = s.sample === true || ownsSignup(s.id) || isHost
                      return (
                        <li key={s.id}>
                          <strong>{s.dish}</strong> — {s.name}
                          {s.servings > 0 && <span className="hint"> · serves {s.servings}</span>}
                          {s.needOven && <span className="tag">oven</span>}
                          {s.allergies && <span className="hint"> · {s.allergies}</span>}
                          {s.sample === true && <span className="tag sample">sample</span>}
                          {canEdit && (
                            <span className="actions">
                              {confirmRemoveId === s.id ? (
                                <>
                                  <span>Remove this signup?</span>
                                  <button type="button" className="link danger" onClick={() => void removeSignup(s)}>
                                    Confirm
                                  </button>
                                  <button type="button" className="link" onClick={() => setConfirmRemoveId(null)}>
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button type="button" className="link" onClick={() => startEdit(s)}>
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    className="link danger"
                                    onClick={() => setConfirmRemoveId(s.id)}
                                  >
                                    Remove
                                  </button>
                                </>
                              )}
                            </span>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </div>
        )}
      </section>
      </div>


      <div className="layout">
      <aside>
        <section className="panel" id="needed" ref={gapSectionRef}>
          <h2>We could use more of</h2>
          {gaps.length === 0 && <p className="good">Every course has hit its target. Nice spread.</p>}
          <ul className="gap-list">
            {allGaps.map((g) => (
              <li key={g.course} className="gap-row">
                <button type="button" className="gap-claim" onClick={() => claimCourse(g.course)}>
                  <span className="gap-head">
                    <strong>{g.course}</strong>
                    <span className="hint">{gapText(g)}</span>
                  </span>
                  <span className="gapbar" aria-hidden="true">
                    <span
                      className="gapbar-fill"
                      style={{ width: `${g.target > 0 ? Math.min(100, (g.count / g.target) * 100) : 0}%` }}
                    />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {allergies.length > 0 && (
          <section className="panel">
            <h2>Allergies &amp; dietary notes</h2>
            <ul>
              {allergies.map((a) => (
                <li key={`${a.name}-${a.dish}`}>
                  <strong>{a.name}</strong> ({a.dish}): {a.note}
                </li>
              ))}
            </ul>
          </section>
        )}

      </aside>

      <main>
        {error && <p className="notice error" role="alert">{error}</p>}
        {notice && (
          <p className="notice">
            {notice} <button type="button" className="link" onClick={() => setNotice('')}>Dismiss</button>
          </p>
        )}
        {hasSample && (
          <p className="notice">
            Showing four sample rows from the 2024 Friendsgiving sheet (Howard, Joe, Valerie, Gardner).
          </p>
        )}
        {duplicates.length > 0 && (
          <p className="notice" role="alert">
            Heads up — duplicate dish{duplicates.length > 1 ? 'es' : ''}:{' '}
            {duplicates.map((d) => `${d.dish} (${d.names.join(' and ')})`).join('; ')}. Maybe coordinate so the menu is not doubled up.
          </p>
        )}

        <section ref={formSectionRef} className="form-section" id="signup">
          <h2>{editingId ? 'Edit your dish' : 'What are you bringing?'}</h2>
          {dishes.length > 0 && (
            <div className="picker">
              <label className="picker-search">
                Pick from the catalog
                <input
                  type="search"
                  placeholder="Search dishes or cuisines…"
                  value={dishFilter}
                  onChange={(e) => setDishFilter(e.target.value)}
                />
              </label>
              <div className="picker-filters">
                <label>
                  Course
                  <select
                    value={dishCourse}
                    onChange={(e) => setDishCourse(isCourse(e.target.value) ? e.target.value : 'All')}
                  >
                    <option value="All">All courses</option>
                    {COURSES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Cuisine
                  <select value={dishCuisine} onChange={(e) => setDishCuisine(e.target.value)}>
                    <option value="All">All cuisines</option>
                    {cuisineOptions.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>
              {pickedDish && (
                <p className="hint">
                  Picked: <strong>{pickedDish.name}</strong>{' '}
                  <button type="button" className="link" onClick={() => setPickedDishId(null)}>
                    Clear
                  </button>
                </p>
              )}
              {showOwnDish && (
                <button type="button" className="picker-row own" onClick={addOwnDish}>
                  <span className="picker-name">+ Bring your own: {ownDishName}</span>
                  <span className="badge">not in the catalog</span>
                </button>
              )}
              {filteredDishes.length === 0 ? (
                <p className="hint">No dishes in the catalog match. Add yours above, or type it in the dish field below.</p>
              ) : (
                <ul className="picker-list">
                  {filteredDishes.slice(0, 60).map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        className={`picker-row${d.id === pickedDishId ? ' picked' : ''}`}
                        onClick={() => pickDish(d)}
                      >
                        <span className="picker-name">{d.name}</span>
                        <span className="chip" style={{ background: cuisineColor(d.cuisine) }}>{d.cuisine}</span>
                        <span className="badge">{d.macros.calories} kcal</span>
                        <span className="badge">{d.macros.proteinG}g protein</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {filteredDishes.length > 60 && (
                <p className="hint">Showing 60 of {filteredDishes.length}. Keep typing to narrow it down.</p>
              )}
            </div>
          )}
          <h2>Add Your Dish</h2>
          <form onSubmit={submit} className="form">
            <label>
              Your name
              <input ref={nameRef} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label>
              Dish
              <span className="dish-field">
                <input
                  value={form.dish}
                  onChange={(e) => {
                    setForm({ ...form, dish: e.target.value })
                    setDishListOpen(true)
                    // Typing a different dish by hand un-picks the catalog dish.
                    if (pickedDish && e.target.value !== pickedDish.name) setPickedDishId(null)
                  }}
                  onFocus={() => {
                    if (!pickedDish || pickedDish.name !== form.dish) setDishListOpen(true)
                  }}
                  onBlur={() => setDishListOpen(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setDishListOpen(false)
                  }}
                  role="combobox"
                  aria-expanded={dishListOpen && dishSuggestions.length > 0}
                  aria-controls="dish-suggestions"
                  aria-autocomplete="list"
                  required
                />
                {dishListOpen && dishSuggestions.length > 0 && (
                  <ul className="suggest-list" id="dish-suggestions" role="listbox" aria-label="Catalog dishes">
                    {dishSuggestions.map((d) => (
                      <li key={d.id} role="option" aria-selected={d.id === pickedDishId}>
                        <button
                          type="button"
                          className="picker-row"
                          onMouseDown={(e) => {
                            // Land the pick before the input blur closes the list.
                            e.preventDefault()
                            pickDish(d)
                            setDishListOpen(false)
                          }}
                        >
                          <span className="picker-name">{d.name}</span>
                          <span className="chip" style={{ background: cuisineColor(d.cuisine) }}>{d.cuisine}</span>
                          <span className="badge">{d.macros.calories} kcal</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </span>
            </label>
            <label>
              Course
              <select
                value={form.course}
                onChange={(e) => setForm({ ...form, course: isCourse(e.target.value) ? e.target.value : 'Mains' })}
              >
                {COURSES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.needOven}
                onChange={(e) => setForm({ ...form, needOven: e.target.checked })}
              />
              Needs the oven
            </label>
            <label>
              Servings (optional)
              <input
                type="number"
                min={0}
                value={form.servings}
                onChange={(e) => setForm({ ...form, servings: e.target.value })}
              />
            </label>
            <label>
              Food allergies / dietary notes
              <input
                value={form.allergies}
                onChange={(e) => setForm({ ...form, allergies: e.target.value })}
                placeholder="e.g. nut allergy, vegetarian"
              />
            </label>
            <div className="row">
              <button type="submit" className="primary">{editingId ? 'Save changes' : 'Add Dish'}</button>
              {editingId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null)
                    setPickedDishId(null)
                    setForm(emptyForm())
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>

          {recipePrompt && (
            <div className="recipe-banner">
              {recipeThanks ? (
                <div className="recipe-head">
                  <p>
                    Thanks! Your recipe for <strong>{recipePrompt.dish}</strong> is on its way to the catalog.
                  </p>
                  <button type="button" className="drawer-close" onClick={() => setRecipePrompt(null)} aria-label="Dismiss">
                    ×
                  </button>
                </div>
              ) : (
                <>
                  <div className="recipe-head">
                    <p>
                      New dish — tell us what&rsquo;s in your <strong>{recipePrompt.dish}</strong> and we&rsquo;ll add
                      it to the catalog with nutrition and recipe details.
                    </p>
                    <button type="button" className="drawer-close" onClick={() => setRecipePrompt(null)} aria-label="Dismiss">
                      ×
                    </button>
                  </div>
                  {!recipeOpen ? (
                    <div className="row">
                      <button type="button" onClick={() => setRecipeOpen(true)}>
                        Share the recipe
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={submitRecipe} className="recipe-form">
                      <div className="hp-field" aria-hidden="true">
                        <label>
                          Website
                          <input
                            name="website"
                            tabIndex={-1}
                            autoComplete="off"
                            value={recipeHoneypot}
                            onChange={(e) => setRecipeHoneypot(e.target.value)}
                          />
                        </label>
                      </div>
                      <label>
                        Ingredients
                        <textarea
                          rows={4}
                          required
                          placeholder="One per line, with amounts if you know them"
                          value={recipeForm.ingredients}
                          onChange={(e) => setRecipeForm({ ...recipeForm, ingredients: e.target.value })}
                        />
                      </label>
                      <label>
                        Recipe steps (optional)
                        <textarea
                          rows={3}
                          value={recipeForm.steps}
                          onChange={(e) => setRecipeForm({ ...recipeForm, steps: e.target.value })}
                        />
                      </label>
                      <label>
                        Cuisine (optional)
                        <input
                          value={recipeForm.cuisine}
                          onChange={(e) => setRecipeForm({ ...recipeForm, cuisine: e.target.value })}
                        />
                      </label>
                      <label>
                        Servings (optional)
                        <input
                          type="number"
                          min={0}
                          value={recipeForm.servings}
                          onChange={(e) => setRecipeForm({ ...recipeForm, servings: e.target.value })}
                        />
                      </label>
                      {recipeError && (
                        <p className="notice error" role="alert">
                          {recipeError}
                        </p>
                      )}
                      <div className="row">
                        <button type="submit" className="primary">
                          Send recipe
                        </button>
                      </div>
                    </form>
                  )}
                </>
              )}
            </div>
          )}
        </section>

      </main>
      </div>

      <footer className="page-footer">
        <a className="link" href="./">
          Home
        </a>
        <span className="footer-sep" aria-hidden="true">·</span>
        <button type="button" className="link" onClick={() => setManageOpen(true)}>
          Manage event
        </button>
        <span className="footer-sep" aria-hidden="true">·</span>
        <button type="button" className="link" onClick={openCreate}>
          Start your own potluck
        </button>
        {showInstallButton && (
          <>
            <span className="footer-sep" aria-hidden="true">·</span>
            <button type="button" className="link" onClick={() => void installFromFooter()}>
              Add to home screen
            </button>
          </>
        )}
        {installHint === 'ios' && (
          <p className="hint">On iPhone or iPad: tap the Share button in Safari, then &ldquo;Add to Home Screen&rdquo;.</p>
        )}
        {installHint === 'menu' && (
          <p className="hint">Open your browser menu and choose &ldquo;Install app&rdquo; or &ldquo;Add to Home Screen&rdquo;.</p>
        )}
      </footer>

      {manageOpen && (
        <>
          <div className="drawer-backdrop" onClick={() => setManageOpen(false)} />
          <div className="drawer" role="dialog" aria-modal="true" aria-label="Manage event">
            <div className="drawer-head">
              <h2>Manage event</h2>
              <button type="button" className="drawer-close" onClick={() => setManageOpen(false)} aria-label="Close">
                ×
              </button>
            </div>

            <section className="drawer-section">
              <label className="event-label">
                Event name
                <input
                  value={eventName}
                  onChange={(e) => saveEventName(e.target.value)}
                  onBlur={() => void persistEventName()}
                  aria-label="Event name"
                />
              </label>
            </section>

            {canEditAccent && (
              <section className="drawer-section">
                <h3>Accent color</h3>
                <div className="swatches" role="group" aria-label="Event accent color">
                  {ACCENTS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      className={`swatch${accent === a ? ' selected' : ''}`}
                      data-swatch={a}
                      onClick={() => void pickAccent(a)}
                      aria-label={`${ACCENT_LABELS[a]} accent`}
                      aria-pressed={accent === a}
                      title={ACCENT_LABELS[a]}
                    />
                  ))}
                </div>
              </section>
            )}

            {canEditAccent && (
              <section className="drawer-section">
                <h3>Event details</h3>
                <div className="settings">
                  <label>
                    Location
                    <input
                      value={detailsForm.location}
                      maxLength={200}
                      placeholder="e.g. Stratus Apartments, 820 Lenora St"
                      onChange={(e) => {
                        setDetailsForm({ ...detailsForm, location: e.target.value })
                        setDetailsSaved(false)
                      }}
                    />
                  </label>
                  <label>
                    Start time (optional)
                    <input
                      type="time"
                      value={detailsForm.time}
                      onChange={(e) => {
                        setDetailsForm({ ...detailsForm, time: e.target.value })
                        setDetailsSaved(false)
                      }}
                    />
                  </label>
                  <label>
                    Details for guests
                    <textarea
                      rows={5}
                      maxLength={2000}
                      placeholder="Directions, parking, what to expect…"
                      value={detailsForm.details}
                      onChange={(e) => {
                        setDetailsForm({ ...detailsForm, details: e.target.value })
                        setDetailsSaved(false)
                      }}
                    />
                  </label>
                </div>
                {detailsError && (
                  <p className="notice error" role="alert">
                    {detailsError}
                  </p>
                )}
                <div className="row">
                  <button type="button" className="primary" onClick={() => void saveEventDetails()}>
                    Save details
                  </button>
                  {detailsSaved && <span className="hint">Saved.</span>}
                </div>
              </section>
            )}

            {canEditAccent && (
              <section className="drawer-section">
                <h3>Course targets</h3>
                <p className="hint">How many of each course the event needs. Guests see these numbers in What's needed.</p>
                <div className="targets">
                  {COURSES.map((course) => (
                    <label key={course}>
                      {course}
                      <input
                        type="number"
                        min={0}
                        value={targetsForm[course]}
                        onChange={(e) => {
                          setTargetsForm({ ...targetsForm, [course]: Math.max(0, Number(e.target.value) || 0) })
                          setTargetsSaved(false)
                        }}
                      />
                    </label>
                  ))}
                </div>
                {targetsError && (
                  <p className="notice error" role="alert">
                    {targetsError}
                  </p>
                )}
                <div className="row">
                  <button type="button" className="primary" onClick={() => void saveCourseTargets()}>
                    Save targets
                  </button>
                  {targetsSaved && <span className="hint">Saved.</span>}
                </div>
              </section>
            )}

            {devStoresEnabled() && (
            <section className="drawer-section">
              <h3>Where signups live</h3>
              <label className="event-label">
                Storage
                <select value={mode} onChange={(e) => setMode(e.target.value as StoreMode)}>
                  <option value="local">This browser only (demo)</option>
                  <option value="supabase">Supabase (Postgres)</option>
                </select>
              </label>
              <p className="hint">{store.note}</p>
              <div className="row">
                <button type="button" onClick={() => void refresh(store, false)}>
                  Refresh
                </button>
                <button type="button" onClick={() => setShowSettings((v) => !v)}>
                  {showSettings ? 'Hide settings' : 'Settings'}
                </button>
                {installPrompt && (
                  <button type="button" onClick={() => void installApp()}>
                    Install app
                  </button>
                )}
              </div>
              {showSettings && (
                <div className="settings">
                  <label>
                    Supabase project URL
                    <input
                      type="url"
                      placeholder="https://xyzcompany.supabase.co"
                      value={supabaseUrl}
                      onChange={(e) => {
                        setSupabaseUrl(e.target.value)
                        setStoredSetting(SUPABASE_URL_STORAGE_KEY, e.target.value)
                      }}
                    />
                  </label>
                  <label>
                    Supabase anon key
                    <input
                      type="password"
                      value={supabaseKey}
                      onChange={(e) => {
                        setSupabaseKey(e.target.value)
                        setStoredSetting(SUPABASE_KEY_STORAGE_KEY, e.target.value)
                      }}
                    />
                  </label>
                  <p className="hint">
                    Keys live in this browser only. The backend schema is in <code>backend/supabase.sql</code>.
                  </p>
                </div>
              )}
            </section>
            )}

            <section className="drawer-section">
              <h3>Share link</h3>
              <p className="share-link">
                <code>{window.location.href}</code>
              </p>
              <div className="row">
                <button type="button" onClick={copyShareLink}>
                  Copy share link
                </button>
              </div>
              <div className="row">
                <a className="button" href={linksMailto}>
                  Email me these links
                </a>
              </div>
            </section>

            <section className="drawer-section">
              <h3>Your own potluck</h3>
              <p className="hint">Hosting a different event? Create it and get your own share and admin links.</p>
              <div className="row">
                <button type="button" onClick={openCreate}>
                  Start your own potluck
                </button>
              </div>
            </section>

            {devStoresEnabled() && hasSample && (
              <section className="drawer-section">
                <h3>Sample data</h3>
                {confirmClearSamples ? (
                  <p className="hint">
                    Clear the four sample rows from the 2024 sheet and start fresh?{' '}
                    <button type="button" className="link danger" onClick={() => void clearSample()}>
                      Confirm
                    </button>{' '}
                    <button type="button" className="link" onClick={() => setConfirmClearSamples(false)}>
                      Cancel
                    </button>
                  </p>
                ) : (
                  <p className="hint">
                    This event still shows the four sample rows.{' '}
                    <button type="button" className="link" onClick={() => setConfirmClearSamples(true)}>
                      Clear sample data
                    </button>
                  </p>
                )}
              </section>
            )}
          </div>
        </>
      )}

      {createOpen && (
        <>
          <div className="drawer-backdrop" onClick={() => setCreateOpen(false)} />
          <div className="drawer" role="dialog" aria-modal="true" aria-label="Start your own potluck">
            <div className="drawer-head">
              <h2>Start your own potluck</h2>
              <button type="button" className="drawer-close" onClick={() => setCreateOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
            <section className="drawer-section">
              <CreateEvent store={store} onClose={() => setCreateOpen(false)} />
            </section>
          </div>
        </>
      )}

      {!formInView && !manageOpen && !createOpen && (
        <button type="button" className="sticky-signup" onClick={scrollToForm}>
          {editingId ? 'Back to the form' : 'Add Dish'}
        </button>
      )}
    </div>
  )
}
