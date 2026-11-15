/** A filled honeypot field means a bot: the field is invisible to humans, so any content is spam. */
export function isSpamSubmission(honeypotValue: string): boolean {
  return honeypotValue.trim() !== ''
}
