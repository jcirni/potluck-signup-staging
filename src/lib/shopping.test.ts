import { describe, expect, it } from 'vitest'
import type { Dish } from './catalog.ts'
import { buildShoppingList } from './shopping.ts'

function dish(partial: Partial<Dish> & { id: string }): Dish {
  return {
    name: 'Test dish',
    course: 'Mains',
    cuisine: 'American',
    description: '',
    servings: 8,
    prepMin: 10,
    cookMin: 20,
    estCostUsd: 10,
    ingredients: [{ item: 'Test ingredient', quantity: 1, unit: 'cup' }],
    steps: ['Cook it.'],
    macros: { calories: 200, proteinG: 10, carbsG: 20, fatG: 9, fiberG: 2 },
    logistics: { needsOven: false, ovenTempF: null, crockpot: false, makeAhead: false, travelsWell: true, utensil: 'Spoon' },
    tags: { contains: [], diets: [] },
    ...partial,
  }
}

describe('buildShoppingList', () => {
  it('returns an empty list when nothing is claimed', () => {
    expect(buildShoppingList([])).toEqual([])
  })

  it('does not merge the same item in different units', () => {
    const d = dish({
      id: 'a',
      ingredients: [
        { item: 'Butter', quantity: 0.5, unit: 'cup' },
        { item: 'Butter', quantity: 2, unit: 'tbsp' },
      ],
    })
    expect(buildShoppingList([{ dish: d, scale: 1 }])).toEqual([
      { item: 'Butter', unit: 'cup', quantity: 0.5 },
      { item: 'Butter', unit: 'tbsp', quantity: 2 },
    ])
  })

  it('applies fractional scales and rounds away float noise', () => {
    const d = dish({ id: 'a', ingredients: [{ item: 'Oil', quantity: 0.1, unit: 'cup' }] })
    expect(buildShoppingList([{ dish: d, scale: 3 }])).toEqual([{ item: 'Oil', unit: 'cup', quantity: 0.3 }])
    expect(buildShoppingList([{ dish: d, scale: 0.5 }])).toEqual([{ item: 'Oil', unit: 'cup', quantity: 0.05 }])
  })

  it('sorts lines by item name', () => {
    const d = dish({
      id: 'a',
      ingredients: [
        { item: 'Zucchini', quantity: 1, unit: 'whole' },
        { item: 'Apples', quantity: 3, unit: 'whole' },
      ],
    })
    expect(buildShoppingList([{ dish: d, scale: 1 }]).map((l) => l.item)).toEqual(['Apples', 'Zucchini'])
  })
})
