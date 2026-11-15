import { describe, expect, it } from 'vitest'
import { isSpamSubmission } from './honeypot.ts'

describe('isSpamSubmission', () => {
  it('passes an untouched or blank honeypot', () => {
    expect(isSpamSubmission('')).toBe(false)
    expect(isSpamSubmission('   ')).toBe(false)
  })

  it('flags any filled honeypot as spam', () => {
    expect(isSpamSubmission('http://spam.example')).toBe(true)
    expect(isSpamSubmission('x')).toBe(true)
  })
})
