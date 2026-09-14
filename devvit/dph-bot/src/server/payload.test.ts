import assert from 'node:assert/strict'
import test from 'node:test'
import {validateRoundupPayload} from './payload.js'

const base = {
  schema: 'dph-reddit-roundup/v2',
  count: 1,
  posts: [{title: 'Cars listed today', body: '| Make | Model |'}],
  cycle_id: '2026-09-14-rolling-48h',
  content_hash: 'hash',
}

test('accepts a complete count-matched roundup payload', () => {
  assert.doesNotThrow(() => validateRoundupPayload(base))
})

test('accepts a listing count larger than the number of Reddit post chunks', () => {
  assert.doesNotThrow(() => validateRoundupPayload({...base, count: 13}))
})

test('rejects a non-empty listing count with no Reddit post chunks', () => {
  assert.throws(() => validateRoundupPayload({...base, count: 2, posts: []}), /invalid/)
})

test('rejects an empty post body', () => {
  assert.throws(
    () => validateRoundupPayload({...base, posts: [{title: 'Cars', body: '  '}]}),
    /incomplete post/,
  )
})
