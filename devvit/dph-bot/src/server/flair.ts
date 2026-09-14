const LEADING_DECORATION = /^[^\p{L}\p{N}]+/u

export function normalizeFlairLabel(value: string): string {
  return value.normalize('NFKC').trim().replace(LEADING_DECORATION, '').trim().toLowerCase()
}

export function flairMatches(actual: string, configured: string): boolean {
  return normalizeFlairLabel(actual) === normalizeFlairLabel(configured)
}
