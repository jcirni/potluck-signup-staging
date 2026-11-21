import type { Course } from './types.ts'
import { isCourse } from './types.ts'

export interface Macros {
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG: number
}

export interface DishIngredient {
  item: string
  quantity: number
  unit: string
}

export interface Dish {
  id: string
  name: string
  /** Where the recipe came from, when known (e.g. a named contributor). */
  origin?: string
  course: Course
  cuisine: string
  description: string
  servings: number
  prepMin: number
  cookMin: number
  estCostUsd: number
  ingredients: DishIngredient[]
  steps: string[]
  macros: Macros
  logistics: {
    needsOven: boolean
    ovenTempF: number | null
    crockpot: boolean
    makeAhead: boolean
    travelsWell: boolean
    utensil: string
  }
  tags: {
    contains: string[]
    diets: string[]
  }
}

export interface SupplyItem {
  id: string
  name: string
  description: string
  estCostUsd: number
}

export interface Catalog {
  dishes: Dish[]
  supplies: SupplyItem[]
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function cleanDish(raw: unknown): Dish | null {
  if (!isRecord(raw)) return null
  const m = raw.macros
  const l = raw.logistics
  const t = raw.tags
  if (
    typeof raw.id !== 'string' ||
    typeof raw.name !== 'string' ||
    typeof raw.course !== 'string' ||
    !isCourse(raw.course) ||
    typeof raw.cuisine !== 'string' ||
    typeof raw.description !== 'string' ||
    typeof raw.servings !== 'number' ||
    typeof raw.prepMin !== 'number' ||
    typeof raw.cookMin !== 'number' ||
    typeof raw.estCostUsd !== 'number' ||
    !Array.isArray(raw.ingredients) ||
    !Array.isArray(raw.steps) ||
    !isRecord(m) ||
    typeof m.calories !== 'number' ||
    typeof m.proteinG !== 'number' ||
    typeof m.carbsG !== 'number' ||
    typeof m.fatG !== 'number' ||
    typeof m.fiberG !== 'number' ||
    !isRecord(l) ||
    typeof l.needsOven !== 'boolean' ||
    typeof l.crockpot !== 'boolean' ||
    typeof l.makeAhead !== 'boolean' ||
    typeof l.travelsWell !== 'boolean' ||
    typeof l.utensil !== 'string' ||
    !isRecord(t) ||
    !Array.isArray(t.contains) ||
    !Array.isArray(t.diets)
  ) {
    return null
  }
  const ingredients: DishIngredient[] = []
  for (const ing of raw.ingredients as unknown[]) {
    if (!isRecord(ing) || typeof ing.item !== 'string' || typeof ing.quantity !== 'number' || typeof ing.unit !== 'string') {
      return null
    }
    ingredients.push({ item: ing.item, quantity: ing.quantity, unit: ing.unit })
  }
  if (ingredients.length === 0 || raw.steps.length === 0) return null
  if (l.needsOven && typeof l.ovenTempF !== 'number') return null
  return {
    id: raw.id,
    name: raw.name,
    ...(typeof raw.origin === 'string' ? { origin: raw.origin } : {}),
    course: raw.course as Course,
    cuisine: raw.cuisine,
    description: raw.description,
    servings: raw.servings,
    prepMin: raw.prepMin,
    cookMin: raw.cookMin,
    estCostUsd: raw.estCostUsd,
    ingredients,
    steps: raw.steps as string[],
    macros: {
      calories: m.calories,
      proteinG: m.proteinG,
      carbsG: m.carbsG,
      fatG: m.fatG,
      fiberG: m.fiberG,
    },
    logistics: {
      needsOven: l.needsOven,
      ovenTempF: typeof l.ovenTempF === 'number' ? l.ovenTempF : null,
      crockpot: l.crockpot,
      makeAhead: l.makeAhead,
      travelsWell: l.travelsWell,
      utensil: l.utensil,
    },
    tags: { contains: t.contains as string[], diets: t.diets as string[] },
  }
}

/** Validate raw catalog JSON (used by the loader and by tests). */
export function validateCatalog(raw: unknown): Catalog {
  if (!isRecord(raw) || !Array.isArray(raw.dishes) || !Array.isArray(raw.supplies)) {
    throw new Error('Catalog file is not shaped like { dishes, supplies }.')
  }
  const dishes = raw.dishes.map(cleanDish)
  if (dishes.some((d) => d === null)) throw new Error('Catalog has a dish with missing or mistyped fields.')
  const supplies: SupplyItem[] = []
  for (const s of raw.supplies as unknown[]) {
    if (!isRecord(s) || typeof s.id !== 'string' || typeof s.name !== 'string' || typeof s.description !== 'string' || typeof s.estCostUsd !== 'number') {
      throw new Error('Catalog has a supply item with missing or mistyped fields.')
    }
    supplies.push({ id: s.id, name: s.name, description: s.description, estCostUsd: s.estCostUsd })
  }
  return { dishes: dishes as Dish[], supplies }
}

/** Load public/data/dishes.json relative to the page, so it works under any GitHub Pages subpath. */
export async function loadCatalog(): Promise<Catalog> {
  const res = await fetch('data/dishes.json')
  if (!res.ok) throw new Error(`Could not load the dish catalog (${res.status}).`)
  return validateCatalog(await res.json())
}

export function cuisinesOf(dishes: Dish[]): string[] {
  return [...new Set(dishes.map((d) => d.cuisine))].sort()
}

/** Chip colors for cuisines, muted jewel tones readable with dark text. */
export const CUISINE_PALETTE = [
  '#d9a441', '#c96f4a', '#9db87c', '#7fa6a3', '#9a86c8', '#c98aa6',
  '#b8b06a', '#8aa6c9', '#c47f5a', '#7c9a5f', '#a67c52', '#5f8a7d',
]

/** Deterministic chip color for a cuisine: same name, same color, every load. */
export function cuisineColor(cuisine: string): string {
  let hash = 0
  for (let i = 0; i < cuisine.length; i++) hash = (hash * 31 + cuisine.charCodeAt(i)) >>> 0
  return CUISINE_PALETTE[hash % CUISINE_PALETTE.length]
}

/** Picker list: name-sorted dishes narrowed by search text, course, and cuisine (the three combine, AND). */
export function filterDishes(
  dishes: Dish[],
  opts: { query?: string; course?: Course | 'All'; cuisine?: string } = {},
): Dish[] {
  const q = (opts.query ?? '').trim().toLowerCase()
  const course = opts.course ?? 'All'
  const cuisine = opts.cuisine ?? 'All'
  return [...dishes]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((d) => course === 'All' || d.course === course)
    .filter((d) => cuisine === 'All' || d.cuisine === cuisine)
    .filter((d) => !q || `${d.name} ${d.cuisine} ${d.course}`.toLowerCase().includes(q))
}

/** Autocomplete matches: name substring hits first (alphabetical), cuisine hits fill the rest. */
export function suggestDishes(dishes: Dish[], query: string, limit = 6): Dish[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const byName = (a: Dish, b: Dish) => a.name.localeCompare(b.name)
  const nameHits = dishes.filter((d) => d.name.toLowerCase().includes(q)).sort(byName)
  if (nameHits.length >= limit) return nameHits.slice(0, limit)
  const seen = new Set(nameHits.map((d) => d.id))
  const cuisineHits = dishes.filter((d) => !seen.has(d.id) && d.cuisine.toLowerCase().includes(q)).sort(byName)
  return [...nameHits, ...cuisineHits].slice(0, limit)
}

/** Scale a dish's ingredient quantities by a factor (0.5x, 2x, 3x). */
export function scaleIngredients(dish: Dish, scale: number): DishIngredient[] {
  return dish.ingredients.map((ing) => ({ ...ing, quantity: Math.round(ing.quantity * scale * 100) / 100 }))
}

/** One ingredient line for a recipe view: "1/4 cup Berbere spice". */
export function formatIngredient(ing: DishIngredient): string {
  return [formatQuantity(ing.quantity), ing.unit, ing.item].filter(Boolean).join(' ')
}

/** Format a quantity for a shopping list: 0.5 -> "1/2", 1.25 -> "1 1/4", otherwise trimmed decimal. */
export function formatQuantity(q: number): string {
  const whole = Math.floor(q)
  const frac = Math.round((q - whole) * 100) / 100
  const fracs: Record<number, string> = { 0.25: '1/4', 0.33: '1/3', 0.5: '1/2', 0.67: '2/3', 0.75: '3/4' }
  const fracText = fracs[frac] ?? (frac > 0 ? String(frac) : '')
  if (whole === 0) return fracText || '0'
  return fracText ? `${whole} ${fracText}` : String(whole)
}
