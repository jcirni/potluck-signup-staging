import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CUISINE_PALETTE, cuisineColor, cuisinesOf, filterDishes, formatIngredient, formatQuantity, scaleIngredients, suggestDishes, validateCatalog, type Dish } from './catalog.ts'

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

const rawCatalog = JSON.parse(
  readFileSync(new URL('../../public/data/dishes.json', import.meta.url), 'utf8'),
) as unknown

describe('validateCatalog on the shipped catalog', () => {
  it('passes and holds 155 dishes and 8 supply items across 25 cuisines', () => {
    const catalog = validateCatalog(rawCatalog)
    expect(catalog.dishes).toHaveLength(155)
    expect(catalog.supplies).toHaveLength(8)
    expect(cuisinesOf(catalog.dishes)).toHaveLength(25)
    const ids = catalog.dishes.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('files the retired Veggies dishes under Sides', () => {
    const catalog = validateCatalog(rawCatalog)
    const byCourse = new Map<string, number>()
    for (const d of catalog.dishes) byCourse.set(d.course, (byCourse.get(d.course) ?? 0) + 1)
    expect(byCourse.get('Sides')).toBe(40)
    expect(byCourse.has('Veggies')).toBe(false)
  })
})

describe('validateCatalog rejects bad data', () => {
  it('throws when the top-level shape is wrong', () => {
    expect(() => validateCatalog(null)).toThrow()
    expect(() => validateCatalog({ dishes: [] })).toThrow()
    expect(() => validateCatalog({ dishes: [], supplies: 'nope' })).toThrow()
  })

  it('throws when a dish is missing or mistypes a required field', () => {
    const missingName = dish({ id: 'x' }) as unknown as Record<string, unknown>
    delete missingName.name
    expect(() => validateCatalog({ dishes: [missingName], supplies: [] })).toThrow()
    expect(() => validateCatalog({ dishes: [{ ...dish({ id: 'x' }), servings: 'eight' }], supplies: [] })).toThrow()
  })

  it('throws on an unknown course and on empty ingredients or steps', () => {
    expect(() => validateCatalog({ dishes: [{ ...dish({ id: 'x' }), course: 'Snacks' }], supplies: [] })).toThrow()
    expect(() => validateCatalog({ dishes: [dish({ id: 'x', ingredients: [] })], supplies: [] })).toThrow()
    expect(() => validateCatalog({ dishes: [dish({ id: 'x', steps: [] })], supplies: [] })).toThrow()
  })

  it('throws when a dish needs the oven but has no temperature', () => {
    const bad = dish({
      id: 'x',
      logistics: { needsOven: true, ovenTempF: null, crockpot: false, makeAhead: false, travelsWell: true, utensil: 'Pan' },
    })
    expect(() => validateCatalog({ dishes: [bad], supplies: [] })).toThrow()
  })

  it('throws on a malformed supply item', () => {
    expect(() => validateCatalog({ dishes: [], supplies: [{ id: 'ice', name: 'Ice' }] })).toThrow()
  })

  it('keeps a string origin and drops a non-string one', () => {
    const withOrigin = validateCatalog({ dishes: [{ ...dish({ id: 'x' }), origin: 'Joe' }], supplies: [] })
    expect(withOrigin.dishes[0].origin).toBe('Joe')
    const badOrigin = validateCatalog({ dishes: [{ ...dish({ id: 'x' }), origin: 42 }], supplies: [] })
    expect(badOrigin.dishes[0].origin).toBeUndefined()
  })
})

describe('formatIngredient', () => {
  it('joins quantity, unit, and item, skipping an empty unit', () => {
    expect(formatIngredient({ item: 'Berbere spice', quantity: 0.25, unit: 'cup' })).toBe('1/4 cup Berbere spice')
    expect(formatIngredient({ item: 'Eggs, hard-boiled', quantity: 6, unit: '' })).toBe('6 Eggs, hard-boiled')
    expect(formatIngredient({ item: 'Chicken thighs', quantity: 3, unit: 'lb' })).toBe('3 lb Chicken thighs')
  })
})

describe('scaleIngredients', () => {
  it('multiplies quantities and rounds to two decimals', () => {
    const d = dish({ id: 'x', ingredients: [{ item: 'Oil', quantity: 0.1, unit: 'cup' }, { item: 'Rice', quantity: 2, unit: 'cups' }] })
    expect(scaleIngredients(d, 3)).toEqual([
      { item: 'Oil', quantity: 0.3, unit: 'cup' },
      { item: 'Rice', quantity: 6, unit: 'cups' },
    ])
    expect(scaleIngredients(d, 0.5)[1].quantity).toBe(1)
  })
})

describe('cuisineColor', () => {
  it('is deterministic and always returns a palette color', () => {
    for (const cuisine of ['Italian', 'Mexican', 'Thai', 'American', 'Ethiopian']) {
      expect(cuisineColor(cuisine)).toBe(cuisineColor(cuisine))
      expect(CUISINE_PALETTE).toContain(cuisineColor(cuisine))
    }
  })

  it('spreads different cuisines across the palette', () => {
    const used = new Set(['Italian', 'Mexican', 'Thai', 'Indian', 'Japanese', 'French'].map(cuisineColor))
    expect(used.size).toBeGreaterThan(1)
  })
})

describe('suggestDishes', () => {
  const dishes = [
    dish({ id: 'baklava', name: 'Baklava', cuisine: 'Middle Eastern' }),
    dish({ id: 'baked-ziti', name: 'Baked Ziti', cuisine: 'Italian' }),
    dish({ id: 'apple-crisp', name: 'Apple Crisp', cuisine: 'American' }),
    dish({ id: 'bruschetta', name: 'Bruschetta', cuisine: 'Italian' }),
  ]

  it('matches dish names case-insensitively by substring, alphabetical', () => {
    expect(suggestDishes(dishes, 'BAK').map((d) => d.id)).toEqual(['baked-ziti', 'baklava'])
  })

  it('fills remaining slots with cuisine matches after name matches', () => {
    const hits = suggestDishes(dishes, 'ita')
    expect(hits.map((d) => d.id)).toEqual(['baked-ziti', 'bruschetta'])
    expect(suggestDishes(dishes, 'crisp').map((d) => d.id)).toEqual(['apple-crisp'])
  })

  it('respects the limit and returns nothing for a blank query', () => {
    expect(suggestDishes(dishes, 'a', 2)).toHaveLength(2)
    expect(suggestDishes(dishes, '   ')).toEqual([])
    expect(suggestDishes(dishes, 'zzz')).toEqual([])
  })
})

describe('filterDishes', () => {
  const dishes = [
    dish({ id: 'baklava', name: 'Baklava', cuisine: 'Middle Eastern', course: 'Desserts' }),
    dish({ id: 'baked-ziti', name: 'Baked Ziti', cuisine: 'Italian', course: 'Mains' }),
    dish({ id: 'apple-crisp', name: 'Apple Crisp', cuisine: 'American', course: 'Desserts' }),
    dish({ id: 'bruschetta', name: 'Bruschetta', cuisine: 'Italian', course: 'Appetizers' }),
  ]

  it('returns everything name-sorted when no filters are set', () => {
    expect(filterDishes(dishes).map((d) => d.id)).toEqual(['apple-crisp', 'baked-ziti', 'baklava', 'bruschetta'])
    expect(filterDishes(dishes, { course: 'All', cuisine: 'All', query: '' })).toHaveLength(4)
  })

  it('filters by course and by cuisine independently', () => {
    expect(filterDishes(dishes, { course: 'Desserts' }).map((d) => d.id)).toEqual(['apple-crisp', 'baklava'])
    expect(filterDishes(dishes, { cuisine: 'Italian' }).map((d) => d.id)).toEqual(['baked-ziti', 'bruschetta'])
  })

  it('combines course, cuisine, and search text (AND)', () => {
    expect(filterDishes(dishes, { course: 'Desserts', cuisine: 'Italian' })).toEqual([])
    expect(filterDishes(dishes, { course: 'Appetizers', cuisine: 'Italian', query: 'brus' }).map((d) => d.id)).toEqual(['bruschetta'])
    expect(filterDishes(dishes, { cuisine: 'Italian', query: 'ziti' }).map((d) => d.id)).toEqual(['baked-ziti'])
  })

  it('keeps the old search behavior: text matches name, cuisine, or course', () => {
    expect(filterDishes(dishes, { query: 'middle' }).map((d) => d.id)).toEqual(['baklava'])
    expect(filterDishes(dishes, { query: 'MAINS' }).map((d) => d.id)).toEqual(['baked-ziti'])
    expect(filterDishes(dishes, { query: 'zzz' })).toEqual([])
  })

  it('does not mutate the input array', () => {
    const before = dishes.map((d) => d.id)
    filterDishes(dishes, { course: 'Desserts' })
    expect(dishes.map((d) => d.id)).toEqual(before)
  })
})

describe('formatQuantity', () => {
  it('renders common fractions and whole numbers', () => {
    expect(formatQuantity(0.5)).toBe('1/2')
    expect(formatQuantity(0.75)).toBe('3/4')
    expect(formatQuantity(1.25)).toBe('1 1/4')
    expect(formatQuantity(2)).toBe('2')
    expect(formatQuantity(0)).toBe('0')
  })
})
