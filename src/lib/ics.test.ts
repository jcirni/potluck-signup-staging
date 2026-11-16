import { describe, expect, it } from 'vitest'
import { buildICS, calendarPlatform, calendarTarget, googleCalendarUrl, icsFilename } from './ics.ts'
import { DEFAULT_TARGETS, EMPTY_DIETARY_NEEDS, type PotluckEvent, type Signup } from './types.ts'

function event(partial: Partial<PotluckEvent>): PotluckEvent {
  return {
    id: 'friendsgiving',
    name: 'Friendsgiving',
    date: '2026-11-26',
    headcount: 12,
    targets: DEFAULT_TARGETS,
    dietaryNeeds: EMPTY_DIETARY_NEEDS,
    accent: 'brass',
    createdAt: '2026-11-14T00:00:00.000Z',
    ...partial,
  }
}

function signup(partial: Partial<Signup> & { id: string }): Signup {
  return {
    eventId: 'friendsgiving',
    name: 'Test',
    dish: 'Test dish',
    course: 'Mains',
    needOven: false,
    allergies: '',
    servings: 4,
    createdAt: '2026-11-14T00:00:00.000Z',
    ...partial,
  }
}

describe('icsFilename', () => {
  it('names the download after the event slug', () => {
    expect(icsFilename(event({}))).toBe('friendsgiving.ics')
  })
})

describe('buildICS', () => {
  it('produces a complete VEVENT with CRLF line endings', () => {
    const ics = buildICS(event({}), [])
    expect(ics).toContain('BEGIN:VCALENDAR\r\n')
    expect(ics).toContain('BEGIN:VEVENT\r\n')
    expect(ics).toContain('END:VEVENT\r\n')
    expect(ics).toContain('UID:friendsgiving@potluck-signup')
    expect(ics).toContain('SUMMARY:Friendsgiving')
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })

  it('ends the all-day event the day after, across month and year boundaries', () => {
    expect(buildICS(event({ date: '2026-11-30' }), [])).toContain('DTEND;VALUE=DATE:20261201')
    expect(buildICS(event({ date: '2026-12-31' }), [])).toContain('DTEND;VALUE=DATE:20270101')
  })

  it('includes an escaped LOCATION line when the event has a location', () => {
    const ics = buildICS(event({ location: 'Stratus Apartments, 820 Lenora St' }), [])
    expect(ics).toContain('LOCATION:Stratus Apartments\\, 820 Lenora St')
  })

  it('omits the LOCATION line when the event has no location', () => {
    expect(buildICS(event({}), [])).not.toContain('LOCATION:')
    expect(buildICS(event({ location: '' }), [])).not.toContain('LOCATION:')
  })

  it('emits a floating timed event ending 3 hours later when a start time is set', () => {
    const ics = buildICS(event({ startTime: '17:00' }), [])
    expect(ics).toContain('DTSTART:20261126T170000\r\n')
    expect(ics).toContain('DTEND:20261126T200000\r\n')
    expect(ics).not.toContain('VALUE=DATE')
    expect(ics).not.toContain('DTSTART:20261126T170000Z')
  })

  it('rolls the timed end past midnight into the next day', () => {
    const ics = buildICS(event({ startTime: '23:30' }), [])
    expect(ics).toContain('DTSTART:20261126T233000')
    expect(ics).toContain('DTEND:20261127T023000')
  })

  it('stays all-day when the start time is missing or malformed', () => {
    expect(buildICS(event({}), [])).toContain('DTSTART;VALUE=DATE:20261126')
    expect(buildICS(event({ startTime: '5pm' }), [])).toContain('DTSTART;VALUE=DATE:20261126')
    expect(buildICS(event({ startTime: '' }), [])).toContain('DTSTART;VALUE=DATE:20261126')
  })

  it('escapes commas and semicolons in the event name and lists the menu', () => {
    const ics = buildICS(event({ name: 'Smith, Jones; Reunion' }), [
      signup({ id: '1', name: 'Joe', dish: 'Salmon' }),
      signup({ id: '2', name: 'Val', dish: 'Stuffing' }),
    ])
    expect(ics).toContain('SUMMARY:Smith\\, Jones\\; Reunion')
    expect(ics).toContain('Salmon (Joe)')
    expect(ics).toContain('Stuffing (Val)')
  })
})

describe('googleCalendarUrl', () => {
  it('builds a timed template link with floating local dates, end 3 hours after start', () => {
    const url = googleCalendarUrl(event({ startTime: '17:00' }), [])
    expect(url.startsWith('https://calendar.google.com/calendar/render?')).toBe(true)
    const params = new URL(url).searchParams
    expect(params.get('action')).toBe('TEMPLATE')
    expect(params.get('text')).toBe('Friendsgiving')
    expect(params.get('dates')).toBe('20261126T170000/20261126T200000')
    expect(params.get('details')).toBe('Potluck signup is open.')
  })

  it('builds an all-day template link ending the next day (exclusive)', () => {
    const params = new URL(googleCalendarUrl(event({ date: '2026-11-30' }), [])).searchParams
    expect(params.get('dates')).toBe('20261130/20261201')
  })

  it('includes the location and the menu in details, URL-encoded', () => {
    const url = googleCalendarUrl(event({ name: 'Smith, Jones; Reunion', location: '820 Lenora St, Seattle' }), [
      signup({ id: '1', name: 'Joe', dish: 'Salmon' }),
    ])
    const params = new URL(url).searchParams
    expect(params.get('text')).toBe('Smith, Jones; Reunion')
    expect(params.get('location')).toBe('820 Lenora St, Seattle')
    expect(params.get('details')).toBe('Menu so far:\nSalmon (Joe)')
    expect(url).not.toContain('820 Lenora St, Seattle')
  })

  it('omits location when unset and returns empty without a date', () => {
    expect(new URL(googleCalendarUrl(event({}), [])).searchParams.has('location')).toBe(false)
    expect(googleCalendarUrl(event({ date: '' }), [])).toBe('')
  })
})

describe('calendarPlatform', () => {
  it('routes Android user agents to android', () => {
    expect(calendarPlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)' })).toBe('android')
    expect(calendarPlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-S918B)' })).toBe('android')
  })

  it('routes iPhone and iPad user agents to ios, including desktop-mode iPads', () => {
    expect(calendarPlatform({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })).toBe('ios')
    expect(calendarPlatform({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)' })).toBe('ios')
    expect(calendarPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe('ios')
  })

  it('routes desktop browsers to other', () => {
    expect(calendarPlatform({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32', maxTouchPoints: 0 })).toBe('other')
    expect(calendarPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe('other')
    expect(calendarPlatform({})).toBe('other')
  })
})

describe('calendarTarget', () => {
  it('points Android at the Google template link', () => {
    const target = calendarTarget('android', event({}), [])
    expect(target.kind).toBe('google')
    if (target.kind === 'google') expect(target.url).toContain('calendar.google.com/calendar/render')
  })

  it('gives iOS the ICS itself, opened in place rather than downloaded', () => {
    const target = calendarTarget('ios', event({}), [])
    expect(target.kind).toBe('ics')
    if (target.kind === 'ics') {
      expect(target.download).toBe(false)
      expect(target.filename).toBe('friendsgiving.ics')
      expect(target.text).toContain('BEGIN:VCALENDAR')
    }
  })

  it('gives other platforms the ICS as a file download', () => {
    const target = calendarTarget('other', event({}), [])
    expect(target.kind).toBe('ics')
    if (target.kind === 'ics') expect(target.download).toBe(true)
  })

  it('falls back to the ICS on Android when the event has no date', () => {
    const target = calendarTarget('android', event({ date: '' }), [])
    expect(target.kind).toBe('ics')
  })
})
