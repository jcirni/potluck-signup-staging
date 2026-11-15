import type { PotluckEvent, Signup } from './types.ts'
import { DEFAULT_TARGETS, EMPTY_DIETARY_NEEDS } from './types.ts'

/** The demo event the sample signups belong to. */
export const SAMPLE_EVENT: PotluckEvent = {
  id: 'friendsgiving',
  name: 'Friendsgiving',
  date: '',
  headcount: 0,
  targets: { ...DEFAULT_TARGETS },
  dietaryNeeds: { ...EMPTY_DIETARY_NEEDS },
  accent: 'brass',
  createdAt: '2024-11-01T00:00:00.000Z',
}

/**
 * Sample data: the four entries quoted from the 2024 Friendsgiving sheet.
 * Oven need / servings were not quoted for them, so they default to
 * false / 0 (not stated) rather than a guess.
 */
export const SAMPLE_SIGNUPS: Signup[] = [
  {
    id: 'sample-howard',
    eventId: 'friendsgiving',
    name: 'Howard',
    dish: 'Rice noodles',
    course: 'Mains',
    needOven: false,
    allergies: '',
    servings: 0,
    createdAt: '2024-11-01T00:00:00.000Z',
    sample: true,
  },
  {
    id: 'sample-joe',
    eventId: 'friendsgiving',
    name: 'Joe',
    dish: 'Salmon',
    course: 'Mains',
    needOven: false,
    allergies: '',
    servings: 0,
    createdAt: '2024-11-01T00:00:00.000Z',
    sample: true,
  },
  {
    id: 'sample-valerie',
    eventId: 'friendsgiving',
    name: 'Valerie',
    dish: 'Stuffing',
    course: 'Sides',
    needOven: false,
    allergies: '',
    servings: 0,
    createdAt: '2024-11-01T00:00:00.000Z',
    sample: true,
  },
  {
    id: 'sample-gardner',
    eventId: 'friendsgiving',
    name: 'Gardner',
    dish: 'Seltzers',
    course: 'Drinks',
    needOven: false,
    allergies: '',
    servings: 0,
    createdAt: '2024-11-01T00:00:00.000Z',
    sample: true,
  },
]
