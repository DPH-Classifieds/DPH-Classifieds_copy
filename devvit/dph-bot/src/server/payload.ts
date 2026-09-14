export type RoundupPost = {title: string; body: string}

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
    posts.length !== count ||
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
