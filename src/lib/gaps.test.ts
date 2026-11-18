import { describe, expect, it } from 'vitest'
import type { Dish } from './catalog.ts'
import { allergyRollup, computeGaps, countPeople, dietaryCoverage, findDuplicates, neededCourses, ovenPlan } from './gaps.ts'
import { buildICS } from './ics.ts'
import { buildShoppingList } from './shopping.ts'
import { DEFAULT_TARGETS, EMPTY_DIETARY_NEEDS, type PotluckEvent, type Signup } from './types.ts'

function signup(partial: Partial<Signup> & { id: string }): Signup {
  return {
    eventId: 'test-event',
    name: 'Test',
    dish: 'Test dish',
    course: 'Mains',
    needOven: false,
    allergies: '',
    servings: 4,
    createdAt: '2026-11-14T00:00:00.000Z',
    ...partial,
  }
}

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

describe('computeGaps', () => {
  it('reports the shortfall per course against the targets', () => {
    const signups = [
      signup({ id: '1', dish: 'Salmon', course: 'Mains' }),
      signup({ id: '2', dish: 'Stuffing', course: 'Sides' }),
    ]
    const gaps = computeGaps(signups, DEFAULT_TARGETS)
    expect(gaps.find((g) => g.course === 'Mains')).toEqual({
      course: 'Mains',
      count: 1,
      target: 3,
      need: 2,
    })
    expect(gaps.find((g) => g.course === 'Drinks')).toEqual({
      course: 'Drinks',
      count: 0,
      target: 3,
      need: 3,
    })
    // Sides absorbed the retired Veggies course, target included.
    expect(gaps.find((g) => g.course === 'Sides')).toEqual({
      course: 'Sides',
      count: 1,
      target: 5,
      need: 4,
    })
    expect(gaps).toHaveLength(6)
  })

  it('never reports a negative need once a course is covered', () => {
    const signups = [1, 2, 3, 4].map((n) =>
      signup({ id: String(n), dish: `Dish ${n}`, course: 'Desserts' }),
    )
    expect(neededCourses(signups, DEFAULT_TARGETS).some((g) => g.course === 'Desserts')).toBe(false)
  })
})

describe('countPeople', () => {
  it('counts one person with several dishes once', () => {
    const signups = [
      signup({ id: '1', name: 'Priscilla', dish: 'Candied sweet potato', course: 'Sides' }),
      signup({ id: '2', name: 'Priscilla', dish: 'Buttermilk Cornbread', course: 'Sides' }),
      signup({ id: '3', name: 'Joe C', dish: 'Whole roasted chicken' }),
    ]
    expect(countPeople(signups)).toBe(2)
  })

  it('matches names trimmed and case-insensitively, and skips blanks', () => {
    const signups = [
      signup({ id: '1', name: '  Amanda ' }),
      signup({ id: '2', name: 'amanda' }),
      signup({ id: '3', name: '' }),
    ]
    expect(countPeople(signups)).toBe(1)
    expect(countPeople([])).toBe(0)
  })
})

describe('findDuplicates', () => {
  it('flags the same dish case-insensitively, and only then', () => {
    const signups = [
      signup({ id: '1', name: 'A', dish: 'Mac and Cheese', course: 'Sides' }),
      signup({ id: '2', name: 'B', dish: 'mac and cheese ', course: 'Sides' }),
      signup({ id: '3', name: 'C', dish: 'Salad', course: 'Appetizers' }),
    ]
    const warnings = findDuplicates(signups)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].names).toEqual(['A', 'B'])
    expect(warnings[0].exact).toBe(false)
  })

  it('marks a shared catalog dish id as an exact duplicate', () => {
    const signups = [
      signup({ id: '1', name: 'A', dish: 'Mac and Cheese', course: 'Sides', dishId: 'mac-and-cheese' }),
      signup({ id: '2', name: 'B', dish: 'Mac and Cheese', course: 'Sides', dishId: 'mac-and-cheese' }),
    ]
    const warnings = findDuplicates(signups)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].exact).toBe(true)
  })
})

describe('ovenPlan and allergyRollup', () => {
  it('orders the oven plan hottest first, and collects only non-empty allergy notes', () => {
    const signups = [
      signup({ id: '1', dish: 'Rolls', needOven: true, allergies: 'Nut allergy', dishId: 'dinner-rolls' }),
      signup({ id: '2', dish: 'Pie', needOven: true, allergies: '', dishId: 'pumpkin-pie' }),
      signup({ id: '3', needOven: false, allergies: '  ' }),
    ]
    expect(allergyRollup(signups)).toHaveLength(1)
    const dishesById = new Map<string, Dish>([
      ['dinner-rolls', dish({ id: 'dinner-rolls', logistics: { needsOven: true, ovenTempF: 375, crockpot: false, makeAhead: true, travelsWell: true, utensil: 'Basket' } })],
      ['pumpkin-pie', dish({ id: 'pumpkin-pie', logistics: { needsOven: true, ovenTempF: 425, crockpot: false, makeAhead: true, travelsWell: true, utensil: 'Pie server' } })],
    ])
    expect(ovenPlan(signups, dishesById).map((e) => e.dish)).toEqual(['Pie', 'Rolls'])
  })
})

describe('dietaryCoverage', () => {
  it('counts catalog dishes by diet tag and free-text signups as unknown', () => {
    const dishesById = new Map<string, Dish>([
      ['veggie-lasagna', dish({ id: 'veggie-lasagna', tags: { contains: ['dairy', 'gluten', 'egg'], diets: ['vegetarian'] } })],
      ['lentil-chili', dish({ id: 'lentil-chili', tags: { contains: [], diets: ['vegetarian', 'vegan', 'gluten-free'] } })],
    ])
    const signups = [
      signup({ id: '1', dish: 'Veggie Lasagna', dishId: 'veggie-lasagna' }),
      signup({ id: '2', dish: 'Lentil Chili', dishId: 'lentil-chili' }),
      signup({ id: '3', dish: 'Mystery casserole' }),
    ]
    const coverage = dietaryCoverage(signups, dishesById, { ...EMPTY_DIETARY_NEEDS, vegetarian: 2, vegan: 1, glutenFree: 1, noPork: 1 })
    expect(coverage.find((c) => c.key === 'vegetarian')).toEqual({ key: 'vegetarian', label: 'Vegetarian', needed: 2, covered: 2, unknown: 1 })
    expect(coverage.find((c) => c.key === 'vegan')).toMatchObject({ needed: 1, covered: 1, unknown: 1 })
    expect(coverage.find((c) => c.key === 'glutenFree')).toMatchObject({ needed: 1, covered: 1, unknown: 1 })
    expect(coverage.find((c) => c.key === 'noPork')).toMatchObject({ needed: 1, covered: 2, unknown: 1 })
  })
})

describe('buildShoppingList', () => {
  it('scales ingredients and sums shared items across claimed dishes', () => {
    const d1 = dish({ id: 'a', ingredients: [{ item: 'Butter', quantity: 0.5, unit: 'cup' }, { item: 'Sugar', quantity: 1, unit: 'cup' }] })
    const d2 = dish({ id: 'b', ingredients: [{ item: 'Butter', quantity: 0.25, unit: 'cup' }] })
    const list = buildShoppingList([
      { dish: d1, scale: 2 },
      { dish: d2, scale: 1 },
    ])
    expect(list).toEqual([
      { item: 'Butter', unit: 'cup', quantity: 1.25 },
      { item: 'Sugar', unit: 'cup', quantity: 2 },
    ])
  })
})

describe('buildICS', () => {
  it('builds an all-day calendar event with the menu in the description', () => {
    const event: PotluckEvent = {
      id: 'friendsgiving',
      name: 'Friendsgiving',
      date: '2026-11-26',
      headcount: 12,
      targets: DEFAULT_TARGETS,
      dietaryNeeds: EMPTY_DIETARY_NEEDS,
      accent: 'brass',
      createdAt: '2026-11-14T00:00:00.000Z',
    }
    const ics = buildICS(event, [signup({ id: '1', name: 'Joe', dish: 'Salmon' })])
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('DTSTART;VALUE=DATE:20261126')
    expect(ics).toContain('DTEND;VALUE=DATE:20261127')
    expect(ics).toContain('Salmon')
  })

  it('returns empty when the event has no date yet', () => {
    const event: PotluckEvent = {
      id: 'x',
      name: 'X',
      date: '',
      headcount: 0,
      targets: DEFAULT_TARGETS,
      dietaryNeeds: EMPTY_DIETARY_NEEDS,
      accent: 'brass',
      createdAt: '2026-11-14T00:00:00.000Z',
    }
    expect(buildICS(event, [])).toBe('')
  })
})
