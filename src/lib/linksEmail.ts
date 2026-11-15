/** A mailto: href carrying an event's links, so the host can email them to themselves and not lose them. */
export function buildLinksMailto(input: { eventName: string; guestUrl: string; adminUrl?: string }): string {
  const subject = `Your Bring a Dish links: ${input.eventName}`
  const lines = [`Your links for ${input.eventName}:`, '', 'Guest link (share this one):', input.guestUrl]
  if (input.adminUrl) {
    lines.push('', 'Host link (keep this one private: it controls the event):', input.adminUrl)
  }
  lines.push('', 'Anyone with the guest link can sign up. Only the host link can edit event settings.')
  const body = lines.join('\r\n')
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
