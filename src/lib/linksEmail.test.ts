import { describe, expect, it } from 'vitest'
import { buildLinksMailto } from './linksEmail.ts'

const guest = 'https://example.com/potluck/?event=taco-night-x7k2p'
const admin = 'https://example.com/potluck/?event=taco-night-x7k2p&admin=tok-123'

function parts(href: string) {
  const query = href.replace('mailto:?', '')
  const [subjectPart, bodyPart] = query.split('&body=')
  return {
    subject: decodeURIComponent(subjectPart.replace('subject=', '')),
    body: decodeURIComponent(bodyPart),
  }
}

describe('buildLinksMailto', () => {
  it('addresses nobody and puts the event name in the subject', () => {
    const href = buildLinksMailto({ eventName: 'Taco Night', guestUrl: guest })
    expect(href.startsWith('mailto:?subject=')).toBe(true)
    expect(parts(href).subject).toBe('Your Bring a Dish links: Taco Night')
  })

  it('encodes special characters in the subject', () => {
    const href = buildLinksMailto({ eventName: 'Fish & Chips Night?', guestUrl: guest })
    expect(href).not.toContain('Fish & Chips')
    expect(parts(href).subject).toBe('Your Bring a Dish links: Fish & Chips Night?')
  })

  it('names the event and includes the guest link and closing line in the body', () => {
    const { body } = parts(buildLinksMailto({ eventName: 'Taco Night', guestUrl: guest }))
    expect(body).toContain('Taco Night')
    expect(body).toContain('Guest link (share this one):')
    expect(body).toContain(guest)
    expect(body).toContain('Anyone with the guest link can sign up. Only the host link can edit event settings.')
  })

  it('includes the host link only when an admin URL is passed', () => {
    const withAdmin = parts(buildLinksMailto({ eventName: 'Taco Night', guestUrl: guest, adminUrl: admin }))
    expect(withAdmin.body).toContain('Host link (keep this one private: it controls the event):')
    expect(withAdmin.body).toContain(admin)
    const without = parts(buildLinksMailto({ eventName: 'Taco Night', guestUrl: guest }))
    expect(without.body).not.toContain('Host link')
    expect(without.body).not.toContain('admin=')
  })

  it('encodes line breaks as %0D%0A with no raw newlines', () => {
    const href = buildLinksMailto({ eventName: 'Taco Night', guestUrl: guest, adminUrl: admin })
    expect(href).toContain('%0D%0A')
    expect(href).not.toContain('\n')
    expect(href).not.toContain('\r')
  })
})
