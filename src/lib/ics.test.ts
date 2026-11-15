import { describe, expect, it, vi } from 'vitest'
import { buildICS, icsFilename, isShareAbort, shareOrDownloadIcs } from './ics.ts'
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

describe('shareOrDownloadIcs', () => {
  const base = { text: 'BEGIN:VCALENDAR', filename: 'party.ics', title: 'Party' }

  it('shares when file sharing is supported and the share succeeds', async () => {
    const download = vi.fn()
    const nav = { canShare: () => true, share: vi.fn(async () => {}) }
    await expect(shareOrDownloadIcs({ ...base, nav, download })).resolves.toBe('shared')
    expect(download).not.toHaveBeenCalled()
  })

  it('stays silent on a genuine user dismissal (AbortError)', async () => {
    const download = vi.fn()
    const nav = { canShare: () => true, share: vi.fn(async () => { throw new DOMException('cancelled', 'AbortError') }) }
    await expect(shareOrDownloadIcs({ ...base, nav, download })).resolves.toBe('cancelled')
    expect(download).not.toHaveBeenCalled()
    expect(isShareAbort(new DOMException('x', 'AbortError'))).toBe(true)
    expect(isShareAbort(new DOMException('x', 'NotAllowedError'))).toBe(false)
  })

  it('falls back to download when share rejects with NotAllowedError', async () => {
    const download = vi.fn()
    const nav = { canShare: () => true, share: vi.fn(async () => { throw new DOMException('no gesture', 'NotAllowedError') }) }
    await expect(shareOrDownloadIcs({ ...base, nav, download })).resolves.toBe('downloaded')
    expect(download).toHaveBeenCalledTimes(1)
    expect(download).toHaveBeenCalledWith(base.text, base.filename)
  })

  it('downloads directly when file sharing is unsupported', async () => {
    const download = vi.fn()
    const nav = { canShare: () => false, share: vi.fn(async () => {}) }
    await expect(shareOrDownloadIcs({ ...base, nav, download })).resolves.toBe('downloaded')
    expect(nav.share).not.toHaveBeenCalled()
    expect(download).toHaveBeenCalledTimes(1)
  })
})
