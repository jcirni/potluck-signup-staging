/** Maps link for an address: Google's universal URL, which opens the Google Maps app when installed and the web map otherwise. */
export function mapsUrl(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`
}
