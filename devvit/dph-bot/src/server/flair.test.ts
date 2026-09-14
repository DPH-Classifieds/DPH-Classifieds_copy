import assert from 'node:assert/strict'
import test from 'node:test'
import {flairMatches} from './flair.js'

test('matches a configured Selling flair when the subreddit adds a leading emoji', () => {
  assert.equal(flairMatches('📈 Selling', 'Selling'), true)
})

test('does not match a different flair label', () => {
  assert.equal(flairMatches('📈 Sold', 'Selling'), false)
})
