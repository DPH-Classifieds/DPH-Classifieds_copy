import {createHmac, timingSafeEqual} from 'node:crypto'

export function verifyPayloadSignature(payload: Record<string, unknown>, secret: string): void {
  if (payload.signature_version !== 'hmac-sha256-v1' || typeof payload.signature !== 'string') {
    throw Error('GitHub bridge payload has no valid HMAC signature')
  }
  const unsigned = Object.fromEntries(Object.entries(payload)
    .filter(([key]) => !['generated_at', 'signature', 'signature_version'].includes(key))
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
  const expected = createHmac('sha256', secret).update(canonicalJson(unsigned), 'utf8').digest('hex')
  const actual = Buffer.from(payload.signature, 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')
  if (actual.length !== expectedBytes.length || !timingSafeEqual(actual, expectedBytes)) {
    throw Error('GitHub bridge payload HMAC verification failed')
  }
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}
