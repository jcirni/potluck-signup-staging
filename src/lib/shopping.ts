import type { Dish } from './catalog.ts'

export interface ShoppingLine {
  item: string
  unit: string
  quantity: number
}

export interface ClaimedDish {
  dish: Dish
  /** Recipe scale the cook chose (1 = as written). */
  scale: number
}

/** Shopping list from claimed dishes: quantities scaled per cook, summed across dishes sharing item + unit, sorted by item. */
export function buildShoppingList(claims: ClaimedDish[]): ShoppingLine[] {
  const byKey = new Map<string, ShoppingLine>()
  for (const { dish, scale } of claims) {
    for (const ing of dish.ingredients) {
      const key = `${ing.item}||${ing.unit}`
      const existing = byKey.get(key)
      const quantity = Math.round(ing.quantity * scale * 100) / 100
      if (existing) {
        existing.quantity = Math.round((existing.quantity + quantity) * 100) / 100
      } else {
        byKey.set(key, { item: ing.item, unit: ing.unit, quantity })
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.item.localeCompare(b.item))
}
