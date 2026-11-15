import type { PotluckEvent, Signup } from './types.ts'

function icsEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function nextDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

/** Download filename for an event's calendar file. */
export function icsFilename(event: PotluckEvent): string {
  return `${event.id}.ics`
}

/** Only a genuine user dismissal (AbortError) should stay silent; other share failures fall back to download. */
export function isShareAbort(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
}

/** Download the .ics via a temporary anchor in the DOM; revoke the object URL after a tick so the click lands. */
export function downloadIcs(icsText: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([icsText], { type: 'text/calendar' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export interface ShareNavigatorLike {
  canShare?: (data: ShareData) => boolean
  share: (data: ShareData) => Promise<void>
}

/** Share the .ics when files are shareable; download on any share failure except a user dismissal. */
export async function shareOrDownloadIcs(opts: {
  text: string
  filename: string
  title: string
  nav?: ShareNavigatorLike
  download?: (text: string, filename: string) => void
}): Promise<'shared' | 'cancelled' | 'downloaded'> {
  const nav = opts.nav ?? (typeof navigator !== 'undefined' ? (navigator as ShareNavigatorLike) : undefined)
  const download = opts.download ?? downloadIcs
  const file = new File([opts.text], opts.filename, { type: 'text/calendar' })
  if (nav && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: opts.title })
      return 'shared'
    } catch (err) {
      if (isShareAbort(err)) return 'cancelled'
      download(opts.text, opts.filename)
      return 'downloaded'
    }
  }
  download(opts.text, opts.filename)
  return 'downloaded'
}

/** Build an .ics file for the event ('' when it has no date yet). All-day; the description carries the menu. */
export function buildICS(event: PotluckEvent, signups: Signup[]): string {
  if (!event.date) return ''
  const start = event.date.replace(/-/g, '')
  const menu = signups.map((s) => `${s.dish} (${s.name})`).join('\\n')
  const description = menu ? `Menu so far:\\n${menu}` : 'Potluck signup is open.'
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Bring a Dish//EN',
    'BEGIN:VEVENT',
    `UID:${event.id}@potluck-signup`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${nextDay(event.date)}`,
    `SUMMARY:${icsEscape(event.name)}`,
    ...(event.location ? [`LOCATION:${icsEscape(event.location)}`] : []),
    `DESCRIPTION:${icsEscape(description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return `${lines.join('\r\n')}\r\n`
}
