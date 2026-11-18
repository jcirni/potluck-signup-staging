import type { Dish } from './catalog.ts'
import type { Course, DietaryNeeds, Signup, Targets } from './types.ts'
import { COURSES } from './types.ts'

export interface CourseGap {
  course: Course
  count: number
  target: number
  need: number
}

/** Per-course counts against the target counts. `need` is 0 when covered. */
export function computeGaps(signups: Signup[], targets: Targets): CourseGap[] {
  return COURSES.map((course) => {
    const count = signups.filter((s) => s.course === course).length
    const target = targets[course]
    return { course, count, target, need: Math.max(0, target - count) }
  })
}

/** Distinct people behind the signups: one person can bring several dishes. Names match trimmed and case-insensitively. */
export function countPeople(signups: Signup[]): number {
  return new Set(signups.map((s) => s.name.trim().toLowerCase()).filter(Boolean)).size
}

/** Courses still short, most-needed first. */
export function neededCourses(signups: Signup[], targets: Targets): CourseGap[] {
  return computeGaps(signups, targets)
    .filter((g) => g.need > 0)
    .sort((a, b) => b.need - a.need)
}

export interface DuplicateWarning {
  dish: string
  names: string[]
  course: Course
  /** True when the match is exact: both signups claimed the same catalog dish. */
  exact: boolean
}

/** Same dish signed up more than once, grouped by name (case-insensitive); exact = two signups claimed the same catalog dish id. */
export function findDuplicates(signups: Signup[]): DuplicateWarning[] {
  const byName = new Map<string, Signup[]>()
  for (const s of signups) {
    const key = s.dish.trim().toLowerCase()
    if (!key) continue
    const group = byName.get(key) ?? []
    group.push(s)
    byName.set(key, group)
  }
  const warnings: DuplicateWarning[] = []
  for (const group of byName.values()) {
    if (group.length < 2) continue
    const ids = group.map((s) => s.dishId).filter((id): id is string => id !== undefined)
    const exact = ids.length >= 2 && new Set(ids).size < ids.length
    warnings.push({
      dish: group[0].dish,
      names: group.map((s) => s.name),
      course: group[0].course,
      exact,
    })
  }
  return warnings
}

export interface DietaryCoverage {
  key: keyof DietaryNeeds
  label: string
  needed: number
  covered: number
  /** Catalog dishes with no usable tag info, plus free-text signups. */
  unknown: number
}

/**
 * Check dietary needs against the menu. Only catalog dishes carry diet
 * tags, so free-text signups count as unknown, not a miss. No-pork also
 * counts any catalog dish containing no meat.
 */
export function dietaryCoverage(
  signups: Signup[],
  dishesById: Map<string, Dish>,
  needs: DietaryNeeds,
): DietaryCoverage[] {
  const labels: { key: keyof DietaryNeeds; label: string }[] = [
    { key: 'vegetarian', label: 'Vegetarian' },
    { key: 'vegan', label: 'Vegan' },
    { key: 'glutenFree', label: 'Gluten-free' },
    { key: 'noPork', label: 'No pork' },
  ]
  return labels.map(({ key, label }) => {
    let covered = 0
    let unknown = 0
    for (const s of signups) {
      const dish = s.dishId ? dishesById.get(s.dishId) : undefined
      if (!dish) {
        unknown += 1
        continue
      }
      const diets = dish.tags.diets
      if (key === 'noPork') {
        if (diets.includes('vegetarian') || diets.includes('vegan') || !dish.tags.contains.includes('meat')) covered += 1
      } else if (key === 'glutenFree') {
        if (diets.includes('gluten-free')) covered += 1
      } else if (diets.includes(key)) {
        covered += 1
      }
    }
    return { key, label, needed: needs[key], covered, unknown }
  })
}

export interface OvenEntry {
  dish: string
  name: string
  tempF: number | null
}

/** Oven plan: dishes needing the oven, highest temperature first; unknown temps last. */
export function ovenPlan(signups: Signup[], dishesById: Map<string, Dish>): OvenEntry[] {
  const entries: OvenEntry[] = []
  for (const s of signups) {
    if (!s.needOven) continue
    const dish = s.dishId ? dishesById.get(s.dishId) : undefined
    entries.push({ dish: s.dish, name: s.name, tempF: dish?.logistics.ovenTempF ?? null })
  }
  return entries.sort((a, b) => (b.tempF ?? 0) - (a.tempF ?? 0))
}

/** Non-empty allergy / dietary notes, one per signup, for the host roll-up. */
export function allergyRollup(signups: Signup[]): { name: string; dish: string; note: string }[] {
  return signups
    .filter((s) => s.allergies.trim().length > 0)
    .map((s) => ({ name: s.name, dish: s.dish, note: s.allergies.trim() }))
}
