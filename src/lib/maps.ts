import { calendarPlatform, type CalendarPlatform } from './ics.ts'

/** Maps link for an address: Apple Maps on iOS (opens the app), Google Maps everywhere else. */
export function mapsUrl(location: string, platform: CalendarPlatform = calendarPlatform()): string {
  const q = encodeURIComponent(location)
  return platform === 'ios' ? `https://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`
}
