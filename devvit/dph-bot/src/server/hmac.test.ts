import assert from 'node:assert/strict'
import test from 'node:test'
import {createHmac} from 'node:crypto'
import {canonicalJson, verifyPayloadSignature} from './hmac.js'

test('verifies the Python-compatible bridge signature and rejects tampering', () => {
  const payload = {schema: 'dph-reddit-roundup/v2', cycle_id: '2026-08-18-rolling-48h', count: 1, generated_at: 'refresh'}
  const signature = createHmac('sha256', 'test-secret').update(canonicalJson({schema: payload.schema, cycle_id: payload.cycle_id, count: payload.count})).digest('hex')
  const signed = {...payload, signature_version: 'hmac-sha256-v1', signature}
  assert.doesNotThrow(() => verifyPayloadSignature(signed, 'test-secret'))
  assert.throws(() => verifyPayloadSignature({...signed, count: 2}, 'test-secret'), /HMAC verification failed/)
  assert.throws(() => verifyPayloadSignature(signed, 'wrong-secret'), /HMAC verification failed/)
})
