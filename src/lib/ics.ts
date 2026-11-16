import type { PotluckEvent, Signup } from './types.ts'
import { isTimeOfDay } from './types.ts'

function icsEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function nextDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

/** Floating 'YYYYMMDDTHHMMSS' from raw date + time components, so no timezone ever shifts the wall clock. */
function floatingStamp(date: string, time: string, addHours = 0): string {
  const [y, mo, d] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  const ms = Date.UTC(y, mo - 1, d, h + addHours, mi)
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '')
}

/** Plain-text event description shared by the ICS and the Google template link. */
function menuText(signups: Signup[]): string {
  const menu = signups.map((s) => `${s.dish} (${s.name})`).join('\n')
  return menu ? `Menu so far:\n${menu}` : 'Potluck signup is open.'
}

/** Download filename for an event's calendar file. */
export function icsFilename(event: PotluckEvent): string {
  return `${event.id}.ics`
}

export type CalendarPlatform = 'android' | 'ios' | 'other'

/** Platform routing for Add to calendar: Android gets the Google template link, iOS the ICS open flow, the rest a download. */
export function calendarPlatform(
  nav: { userAgent?: string; platform?: string; maxTouchPoints?: number } = typeof navigator !== 'undefined'
    ? navigator
    : {},
): CalendarPlatform {
  const ua = nav.userAgent ?? ''
  if (/android/i.test(ua)) return 'android'
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  // iPads in desktop mode pose as Macs; touch points give them away.
  if (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1) return 'ios'
  return 'other'
}

export type CalendarTarget =
  | { kind: 'google'; url: string }
  | { kind: 'ics'; text: string; filename: string; download: boolean }

/** What the Add to calendar link points at, ready before the tap so no script runs between tap and hand-off. */
export function calendarTarget(platform: CalendarPlatform, event: PotluckEvent, signups: Signup[]): CalendarTarget {
  // Android goes to the Google Calendar template; Samsung Calendar and other non-Google calendars are not reachable this way.
  if (platform === 'android') {
    const url = googleCalendarUrl(event, signups)
    if (url) return { kind: 'google', url }
  }
  // iOS opens the .ics in place (no download flag) so Safari hands it to Calendar; desktop saves the file.
  return { kind: 'ics', text: buildICS(event, signups), filename: icsFilename(event), download: platform !== 'ios' }
}

/** Google Calendar 'add event' template link for the event ('' when it has no date yet). */
export function googleCalendarUrl(event: PotluckEvent, signups: Signup[]): string {
  if (!event.date) return ''
  // Timed events reuse the ICS window (start + 3h); all-day ends are the exclusive next day, per Google's format.
  const dates = isTimeOfDay(event.startTime)
    ? `${floatingStamp(event.date, event.startTime)}/${floatingStamp(event.date, event.startTime, 3)}`
    : `${event.date.replace(/-/g, '')}/${nextDay(event.date)}`
  const params = new URLSearchParams({ action: 'TEMPLATE', text: event.name, dates, details: menuText(signups) })
  if (event.location) params.set('location', event.location)
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

/** Build an .ics file for the event ('' when it has no date yet). Timed when a start time is set; the description carries the menu. */
export function buildICS(event: PotluckEvent, signups: Signup[]): string {
  if (!event.date) return ''
  const start = event.date.replace(/-/g, '')
  const menu = signups.map((s) => `${s.dish} (${s.name})`).join('\\n')
  const description = menu ? `Menu so far:\\n${menu}` : 'Potluck signup is open.'
  // Timed events default to a 3-hour block; there is no end-time field yet.
  const dateLines = isTimeOfDay(event.startTime)
    ? [`DTSTART:${floatingStamp(event.date, event.startTime)}`, `DTEND:${floatingStamp(event.date, event.startTime, 3)}`]
    : [`DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${nextDay(event.date)}`]
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Bring a Dish//EN',
    'BEGIN:VEVENT',
    `UID:${event.id}@potluck-signup`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`,
    ...dateLines,
    `SUMMARY:${icsEscape(event.name)}`,
    ...(event.location ? [`LOCATION:${icsEscape(event.location)}`] : []),
    `DESCRIPTION:${icsEscape(description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return `${lines.join('\r\n')}\r\n`
}
