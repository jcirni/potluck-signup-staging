import { useState } from 'react'
import { buildNewEvent, createUniqueEvent, eventLinks, randomSuffix, uniqueSlug, type CreatedEvent } from '../lib/eventCreate.ts'
import { isSpamSubmission } from '../lib/honeypot.ts'
import { buildLinksMailto } from '../lib/linksEmail.ts'
import type { SignupStore } from '../lib/storage.ts'

interface CreateEventProps {
  store: SignupStore
  /** Drawer use gets a Done button; the home page gets a create-another reset instead. */
  onClose?: () => void
  /** Fires after a real creation, so the home page can refresh its your-events list. */
  onCreated?: () => void
}

/** The create-event form and its success panel, shared by the event-page drawer and the home page. */
export default function CreateEvent({ store, onClose, onCreated }: CreateEventProps) {
  const [form, setForm] = useState({ name: '', date: '', time: '', headcount: '', location: '', details: '' })
  const [honeypot, setHoneypot] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<CreatedEvent | null>(null)
  const [copiedLink, setCopiedLink] = useState('')

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault()
    // A filled honeypot means a bot: show the success panel, create nothing.
    if (isSpamSubmission(honeypot)) {
      const name = form.name.trim() || 'Your potluck'
      setCreated({
        event: buildNewEvent(
          { name, date: form.date, startTime: form.time, headcount: 0, location: form.location, details: form.details },
          uniqueSlug(name, randomSuffix()),
        ),
        adminToken: crypto.randomUUID(),
      })
      return
    }
    const name = form.name.trim()
    if (!name) {
      setError('Give your potluck a name first.')
      return
    }
    setError('')
    setCreating(true)
    try {
      const result = await createUniqueEvent(store, {
        name,
        date: form.date,
        startTime: form.time,
        headcount: Math.max(0, Number(form.headcount) || 0),
        location: form.location,
        details: form.details,
      })
      setCreated(result)
      onCreated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the event.')
    } finally {
      setCreating(false)
    }
  }

  function copyLink(which: 'guest' | 'admin', url: string) {
    void navigator.clipboard.writeText(url).then(
      () => setCopiedLink(which),
      () => setError('Could not copy. Select the link text and copy it by hand.'),
    )
  }

  function reset() {
    setCreated(null)
    setForm({ name: '', date: '', time: '', headcount: '', location: '', details: '' })
    setHoneypot('')
    setError('')
    setCopiedLink('')
  }

  if (created) {
    const links = eventLinks(
      `${window.location.origin}${window.location.pathname}`,
      created.event.id,
      created.adminToken,
    )
    return (
      <>
        <p className="good">
          <strong>{created.event.name}</strong> is ready.
        </p>
        <h3>Share link for guests</h3>
        <p className="share-link">
          <code>{links.guest}</code>
        </p>
        <div className="row">
          <button type="button" onClick={() => copyLink('guest', links.guest)}>
            {copiedLink === 'guest' ? 'Copied' : 'Copy share link'}
          </button>
        </div>
        <h3>Your admin link</h3>
        <p className="share-link">
          <code>{links.admin}</code>
        </p>
        <div className="row">
          <button type="button" onClick={() => copyLink('admin', links.admin)}>
            {copiedLink === 'admin' ? 'Copied' : 'Copy admin link'}
          </button>
        </div>
        <div className="row">
          <a
            className="button"
            href={buildLinksMailto({ eventName: created.event.name, guestUrl: links.guest, adminUrl: links.admin })}
          >
            Email me these links
          </a>
        </div>
        <p className="hint">
          The admin link is your host key: it unlocks event settings, so keep it private and share only the guest
          link.
        </p>
        <div className="row">
          <button
            type="button"
            className="primary"
            onClick={() => {
              window.location.href = links.admin
            }}
          >
            Go to my event
          </button>
          {onClose ? (
            <button type="button" onClick={onClose}>
              Done
            </button>
          ) : (
            <button type="button" onClick={reset}>
              Create another event
            </button>
          )}
        </div>
      </>
    )
  }

  return (
    <form onSubmit={submitCreate}>
      <div className="settings">
        <label>
          Event name
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            maxLength={120}
            placeholder="e.g. Friendsgiving 2026"
            required
          />
        </label>
        <label>
          Date (optional)
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </label>
        <label>
          Start time (optional)
          <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
        </label>
        <label>
          Rough headcount (optional)
          <input
            type="number"
            min={0}
            value={form.headcount}
            onChange={(e) => setForm({ ...form, headcount: e.target.value })}
          />
        </label>
        <label>
          Location (optional)
          <input
            value={form.location}
            maxLength={200}
            placeholder="e.g. Stratus Apartments, 820 Lenora St"
            onChange={(e) => setForm({ ...form, location: e.target.value })}
          />
        </label>
        <label>
          Details for guests (optional)
          <textarea
            rows={5}
            maxLength={2000}
            placeholder="Directions, parking, what to expect…"
            value={form.details}
            onChange={(e) => setForm({ ...form, details: e.target.value })}
          />
        </label>
        <div className="hp-field" aria-hidden="true">
          <label>
            Website
            <input
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />
          </label>
        </div>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button type="submit" className="primary" disabled={creating}>
          {creating ? 'Creating…' : 'Create event'}
        </button>
      </div>
    </form>
  )
}
