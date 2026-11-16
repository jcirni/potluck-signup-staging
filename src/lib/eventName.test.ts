import { describe, expect, it } from 'vitest'
import { displayEventName, showDeviceOnlyNotice } from './eventName.ts'
import { DEFAULT_TARGETS, EMPTY_DIETARY_NEEDS, type PotluckEvent } from './types.ts'

function event(partial: Partial<PotluckEvent>): PotluckEvent {
  return {
    id: 'e2e-test-potluck-ylh5z',
    name: 'E2E Test Potluck',
    date: '2026-12-24',
    headcount: 10,
    targets: DEFAULT_TARGETS,
    dietaryNeeds: EMPTY_DIETARY_NEEDS,
    accent: 'brass',
    createdAt: '2026-11-14T00:00:00.000Z',
    ...partial,
  }
}

describe('displayEventName', () => {
  it('shows the loaded event name, not the local Friendsgiving default', () => {
    expect(displayEventName(event({}), 'Friendsgiving')).toBe('E2E Test Potluck')
  })

  it('falls back to the local name when no event record loaded', () => {
    expect(displayEventName(null, 'Friendsgiving')).toBe('Friendsgiving')
    expect(displayEventName(null, 'Neighborhood Cookout')).toBe('Neighborhood Cookout')
  })
})

describe('showDeviceOnlyNotice', () => {
  it('shows only when the load resolved missing and the browser holds the host token', () => {
    expect(showDeviceOnlyNotice('missing', true)).toBe(true)
    expect(showDeviceOnlyNotice('missing', false)).toBe(false)
    expect(showDeviceOnlyNotice('found', true)).toBe(false)
    expect(showDeviceOnlyNotice('failed', true)).toBe(false)
    expect(showDeviceOnlyNotice('pending', true)).toBe(false)
  })
})
