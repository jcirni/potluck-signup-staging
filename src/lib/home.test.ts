import { describe, expect, it } from 'vitest'
import { extractEventSlug, mergeYourEvents } from './home.ts'
import { DEFAULT_TARGETS, EMPTY_DIETARY_NEEDS, DEFAULT_ACCENT, type PotluckEvent } from './types.ts'

describe('extractEventSlug', () => {
  it('accepts a bare slug', () => {
    expect(extractEventSlug('friendsgiving')).toBe('friendsgiving')
    expect(extractEventSlug('  my-party-x7k2p  ')).toBe('my-party-x7k2p')
  })

  it('pulls the slug out of a full event URL', () => {
    expect(extractEventSlug('https://jcirni.github.io/potluck-signup/?event=friendsgiving')).toBe('friendsgiving')
    expect(extractEventSlug('https://example.com/app/?event=bbq-2026-ab3de#s=xyz')).toBe('bbq-2026-ab3de')
  })

  it('takes only the slug from an admin link, never the token', () => {
    const slug = extractEventSlug('https://jcirni.github.io/potluck-signup/?event=bbq-2026-ab3de&admin=secret-token')
    expect(slug).toBe('bbq-2026-ab3de')
  })

  it('rejects empty and garbage input', () => {
    expect(extractEventSlug('')).toBeNull()
    expect(extractEventSlug('   ')).toBeNull()
    expect(extractEventSlug('hello world')).toBeNull()
    expect(extractEventSlug('https://example.com/')).toBeNull()
    expect(extractEventSlug('?admin=only-a-token')).toBeNull()
    expect(extractEventSlug('not a slug!')).toBeNull()
  })
})

function localEvent(id: string, name: string): PotluckEvent {
  return {
    id,
    name,
    date: '',
    headcount: 0,
    targets: { ...DEFAULT_TARGETS },
    dietaryNeeds: { ...EMPTY_DIETARY_NEEDS },
    accent: DEFAULT_ACCENT,
    createdAt: '2026-11-14T00:00:00.000Z',
  }
}

describe('mergeYourEvents', () => {
  it('sorts by slug and keeps tokens from the scan', () => {
    const merged = mergeYourEvents(
      [
        { slug: 'zeta', token: 't1' },
        { slug: 'alpha', token: 't2' },
      ],
      [],
    )
    expect(merged).toEqual([
      { slug: 'alpha', token: 't2' },
      { slug: 'zeta', token: 't1' },
    ])
  })

  it('dedupes local events against the scan and fills in names', () => {
    const merged = mergeYourEvents(
      [{ slug: 'bbq-2026-ab3de', token: 'tok' }],
      [localEvent('bbq-2026-ab3de', 'Summer BBQ'), localEvent('local-only', 'Local Only')],
    )
    expect(merged).toEqual([
      { slug: 'bbq-2026-ab3de', token: 'tok', name: 'Summer BBQ' },
      { slug: 'local-only', name: 'Local Only' },
    ])
  })

  it('returns an empty list when the browser administers nothing', () => {
    expect(mergeYourEvents([], [])).toEqual([])
  })
})
