import { describe, expect, it } from 'vitest'
import { mapsUrl } from './maps.ts'

const address = '6428 Carleton Ave S, Seattle, WA 98108'

describe('mapsUrl', () => {
  it('links iOS to Apple Maps with the address encoded', () => {
    expect(mapsUrl(address, 'ios')).toBe('https://maps.apple.com/?q=6428%20Carleton%20Ave%20S%2C%20Seattle%2C%20WA%2098108')
  })

  it('links Android and desktop to Google Maps search', () => {
    const url = 'https://www.google.com/maps/search/?api=1&query=6428%20Carleton%20Ave%20S%2C%20Seattle%2C%20WA%2098108'
    expect(mapsUrl(address, 'android')).toBe(url)
    expect(mapsUrl(address, 'other')).toBe(url)
  })
})
