import { useCallback, useEffect, useState } from 'react'
import CreateEvent from './CreateEvent.tsx'
import { extractEventSlug, mergeYourEvents, type YourEvent } from '../lib/home.ts'
import { scanAdminEvents, type SignupStore, type StoreMode } from '../lib/storage.ts'

interface HomeProps {
  store: SignupStore
  mode: StoreMode
  showInstallButton: boolean
  installHint: 'ios' | 'menu' | null
  onInstall: () => void
}

/** The entry page at the bare URL: create an event, or find one by link or from this device. */
export default function Home({ store, mode, showInstallButton, installHint, onInstall }: HomeProps) {
  const [yourEvents, setYourEvents] = useState<YourEvent[]>([])
  const [openValue, setOpenValue] = useState('')
  const [openError, setOpenError] = useState('')

  const loadYours = useCallback(async () => {
    const refs = scanAdminEvents()
    // Local mode also knows its events by name; other modes have no directory to ask.
    const locals = mode === 'local' ? await store.listEvents().catch(() => []) : []
    setYourEvents(mergeYourEvents(refs, locals))
  }, [mode, store])

  useEffect(() => {
    void loadYours()
  }, [loadYours])

  function openEvent(e: React.FormEvent) {
    e.preventDefault()
    const slug = extractEventSlug(openValue)
    if (!slug) {
      setOpenError('That does not look like an event link. Paste the full link you were sent, or just its event name.')
      return
    }
    window.location.href = `?event=${encodeURIComponent(slug)}`
  }

  return (
    <>
      <header className="hero home-hero">
        <img className="home-icon" src="icons/icon.svg" alt="" width={76} height={76} />
        <h1 className="hero-name">Bring a Dish</h1>
        <p className="home-tagline">
          See what&rsquo;s already coming, claim what&rsquo;s missing, and sign up to bring a dish.
        </p>
      </header>

      <div className="home-wrap">
        <section className="panel">
          <h2>Start a potluck</h2>
          <CreateEvent store={store} onCreated={() => void loadYours()} />
        </section>

        <section className="panel">
          <h2>Find an event</h2>
          <p className="hint">Were you sent a link? Paste it here, or just type the event name from the end of it.</p>
          <form className="open-form" onSubmit={openEvent}>
            <input
              type="text"
              value={openValue}
              onChange={(e) => {
                setOpenValue(e.target.value)
                setOpenError('')
              }}
              placeholder="Paste an event link…"
              aria-label="Event link or name"
            />
            <button type="submit" className="primary">
              Open event
            </button>
          </form>
          {openError && (
            <p className="notice error" role="alert">
              {openError}
            </p>
          )}
          <h3>Events you host on this device</h3>
          {yourEvents.length === 0 ? (
            <p className="hint">Events you create will show up here on this device.</p>
          ) : (
            <ul className="your-events">
              {yourEvents.map((ev) => (
                <li key={ev.slug}>
                  <span className="your-event-id">
                    <a href={`?event=${encodeURIComponent(ev.slug)}`}>{ev.name ?? ev.slug}</a>
                    {ev.name && <span className="hint">{ev.slug}</span>}
                  </span>
                  {ev.token && (
                    <a className="your-event-host" href={`?event=${encodeURIComponent(ev.slug)}&admin=${encodeURIComponent(ev.token)}`}>
                      Open as host
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <footer className="page-footer">
        {showInstallButton && (
          <button type="button" className="link" onClick={onInstall}>
            Add to home screen
          </button>
        )}
        {installHint === 'ios' && (
          <p className="hint">On iPhone or iPad: tap the Share button in Safari, then &ldquo;Add to Home Screen&rdquo;.</p>
        )}
        {installHint === 'menu' && (
          <p className="hint">Open your browser menu and choose &ldquo;Install app&rdquo; or &ldquo;Add to Home Screen&rdquo;.</p>
        )}
      </footer>
    </>
  )
}
