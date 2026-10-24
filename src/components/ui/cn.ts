/**
 * Tiny class-name joiner. Keeps conditional class lists readable without
 * pulling in a dependency; later classes win only because callers order them
 * deliberately, not because of merge magic.
 */
export type ClassValue = string | false | null | undefined;

export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ');
}
