export type RoundupPost = {title: string; body: string}

const ODOMETER_LABEL_RE = /^(?:odometer|odo|mileage(?:\s+reading)?|kilometers?|kilometres?|kms?)(?:\s+\(?km\)?s?)?$/i

function isOdometerLabel(value: string): boolean {
  return ODOMETER_LABEL_RE.test(value.replace(/\*/g, '').trim())
}

function splitTableCells(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null
  return trimmed.slice(1, -1).split('|').map((cell) => cell.trim())
}

function isMarkdownTableSeparator(line: string): boolean {
  const cells = splitTableCells(line)
  return Boolean(cells?.length && cells.every((cell) => /^:?-{3,}:?$/.test(cell)))
}

function normalizeMetricLabelText(value: string): string {
  return value.replace(
    /(^|\s)(\*{0,2})(?:odometer|odo|mileage(?:\s+reading)?|kilometers?|kilometres?|kms?)(?:\s+\(?km\)?s?)?(\*{0,2})(?=\s*[:\-])/gi,
    '$1$2Odometer$3',
  )
}

/**
 * Keep the Devvit submission contract stable when a bridge payload was made
 * by an older worker (or was edited manually). Mileage and odometer are the
 * same car measurement here; Reddit should always show the canonical label.
 */
export function normalizeRoundupPost(post: RoundupPost): RoundupPost {
  const lines = post.body.split('\n')
  const body = lines.map((line, index) => {
    const cells = splitTableCells(line)
    if (cells && isMarkdownTableSeparator(lines[index + 1] || '')) {
      const normalized = cells.map((cell) => (isOdometerLabel(cell) ? 'Odometer' : cell))
      return `| ${normalized.join(' | ')} |`
    }
    return normalizeMetricLabelText(line)
  }).join('\n')

  return {
    title: normalizeMetricLabelText(post.title),
    body,
  }
}

export type RoundupPayload = {
  schema: 'dph-reddit-roundup/v2'
  count: number
  posts: RoundupPost[]
  cycle_id: string
  content_hash: string
  [key: string]: unknown
}

export function validateRoundupPayload(value: unknown): asserts value is RoundupPayload {
  if (!value || typeof value !== 'object') throw Error('GitHub bridge payload is invalid')
  const payload = value as Partial<RoundupPayload>
  const count = payload.count
  const posts = payload.posts
  if (
    payload.schema !== 'dph-reddit-roundup/v2' ||
    typeof count !== 'number' ||
    !Number.isInteger(count) ||
    count < 0 ||
    !Array.isArray(posts) ||
    (count === 0 && posts.length !== 0) ||
    (count > 0 && posts.length === 0) ||
    !payload.cycle_id ||
    !payload.content_hash
  ) {
    throw Error('GitHub bridge payload is invalid')
  }
  if (posts.some((post) => (
    !post ||
    typeof post.title !== 'string' ||
    !post.title.trim() ||
    typeof post.body !== 'string' ||
    !post.body.trim()
  ))) {
    throw Error('GitHub bridge payload contains an incomplete post')
  }
}
