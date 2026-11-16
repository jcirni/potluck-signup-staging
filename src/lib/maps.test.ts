import { describe, expect, it } from 'vitest'
import { mapsUrl } from './maps.ts'

describe('mapsUrl', () => {
  it('builds a Google Maps search link with the address encoded', () => {
    expect(mapsUrl('6428 Carleton Ave S, Seattle, WA 98108')).toBe(
      'https://www.google.com/maps/search/?api=1&query=6428%20Carleton%20Ave%20S%2C%20Seattle%2C%20WA%2098108',
    )
  })
})
