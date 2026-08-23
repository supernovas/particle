import { ulid } from './ulid.ts';

/**
 * All particle identifiers are TypeID-style: a short type prefix + "_" + ULID,
 * e.g. "prj_01J8ZC3AH2V9FYQ6MZ0X7T4KDB". Readable like Stripe ids, still
 * lexically time-sortable within a kind.
 */
export type IdPrefix = 'prj' | 'evt' | 'tsk' | 'run';

export type Id<P extends IdPrefix = IdPrefix> = `${P}_${string}`;

export function newId<P extends IdPrefix>(prefix: P): Id<P> {
  return `${prefix}_${ulid()}`;
}
