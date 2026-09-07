import type {IncomingMessage, ServerResponse} from 'node:http'
import {context, reddit, redis, settings} from '@devvit/web/server'
import type {PartialJsonValue, TriggerResponse, UiResponse} from '@devvit/web/shared'
import {verifyPayloadSignature} from './hmac.js'

type AppResponse = TriggerResponse | UiResponse | {error: string; status: number}
const FORCE_REPOST_COOLDOWN_MS = 10 * 60 * 1000

export async function onReq(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const endpoint = req.url?.slice(1)
    let response: AppResponse
    if (req.method !== 'POST') response = {error: 'not found', status: 404}
    else if (endpoint === 'internal/cron/roundup') response = await postScheduledRoundup()
    else if (endpoint === 'internal/on/menu/roundup') response = await postRoundupFromMenu()
    else if (endpoint === 'internal/on/menu/force-roundup') response = await forceRoundupFromMenu()
    else response = {error: 'not found', status: 404}
    writeJson('status' in response ? response.status : 200, response, res)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`dph-bot error: ${message}`)
    writeJson(500, {error: message, status: 500}, res)
  }
}

async function postScheduledRoundup(): Promise<TriggerResponse> {
  const result = await postRoundup()
  console.log(result.skipped ? 'roundup: skipped' : `roundup: posted ${result.count} -> ${result.url}`)
  return {}
}

async function postRoundupFromMenu(): Promise<UiResponse> {
  try {
    const result = await postRoundup()
    return {showToast: {text: result.skipped ? 'No new listings to post.' : `Posted ${result.count} cars.`, appearance: 'success'}}
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {showToast: {text: `Roundup failed: ${message}`.slice(0, 450)}}
  }
}

async function forceRoundupFromMenu(): Promise<UiResponse> {
  try {
    const result = await postRoundup(true)
    return {showToast: {text: `Test reposted ${result.count} cars.`, appearance: 'success'}}
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {showToast: {text: `Force repost failed: ${message}`.slice(0, 450)}}
  }
}

async function postRoundup(force = false): Promise<{count: number; url?: string; skipped?: boolean}> {
  const githubUrl = (await settings.get<string>('roundupUrl'))?.trim()
  const githubToken = (await settings.get<string>('roundupToken'))?.trim()
  const hmacSecret = (await settings.get<string>('roundupHmacSecret'))?.trim()
  // Reddit's API expects a bare subreddit name. Moderators often enter the
  // familiar `r/name` form in settings, so normalize it before submitting.
  const configuredSubreddit = (await settings.get<string>('targetSubreddit'))?.trim()
  const targetSubreddit = (configuredSubreddit || context.subredditName || '').replace(/^r\//i, '')
  const flairText = (await settings.get<string>('roundupFlairText'))?.trim() || 'Selling'
  if (!githubUrl) throw Error('roundupUrl is not set in app settings')
  if (!targetSubreddit) throw Error('no target subreddit')
  const url = new URL(githubUrl)
  if (url.protocol !== 'https:' || url.hostname !== 'api.github.com' || !url.pathname.startsWith('/repos/')) {
    throw Error('roundupUrl must be a GitHub Contents API URL on api.github.com')
  }
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (/^(ghp_|github_pat_)/.test(githubToken || '')) headers.Authorization = `Bearer ${githubToken}`
  const response = await fetch(url, {headers})
  if (!response.ok) throw Error(`GitHub roundup fetch failed: ${response.status}`)
  const source = (await response.json()) as {content?: string; encoding?: string}
  if (source.encoding !== 'base64' || !source.content) throw Error('GitHub bridge response has no base64 content')
  const payload = JSON.parse(Buffer.from(source.content, 'base64').toString('utf8')) as {
    schema?: string; title?: string; body?: string; posts?: Array<{title?: string; body?: string}>; count?: number; cycle_id?: string; content_hash?: string; generated_at?: string; signature?: string; signature_version?: string
  }
  if (payload.schema !== 'dph-reddit-roundup/v2' || !Number.isInteger(payload.count)) {
    throw Error('GitHub bridge payload is invalid')
  }
  if (!payload.cycle_id || !payload.content_hash) throw Error('GitHub bridge payload has no cycle_id/content_hash')
  // Schema + count checks alone don't prove this payload came from our own
  // bridge worker — a compromised repo/PAT could otherwise post arbitrary
  // content to Reddit under this app's identity. Require the signature.
  if (!hmacSecret) throw Error('roundupHmacSecret is not set in app settings')
  verifyPayloadSignature(payload, hmacSecret)
  if (!payload.count) return {count: 0, skipped: true}
  const posts = payload.posts
  if (!posts?.length || posts.some(post => !post.title || !post.body)) throw Error('GitHub bridge payload has no posts')
  const flair = (await reddit.getPostFlairTemplates(targetSubreddit)).find(template => template.text.trim().toLowerCase() === flairText.toLowerCase())
  if (!flair) throw Error(`post flair not found: ${flairText}`)
  const postedKeyPrefix = `roundup:posted:${targetSubreddit}:${payload.cycle_id}`
  const forceKey = `roundup:force:last:${targetSubreddit}`
  if (force) {
    const lastForce = Number(await redis.get(forceKey))
    const remaining = FORCE_REPOST_COOLDOWN_MS - (Date.now() - lastForce)
    if (Number.isFinite(lastForce) && remaining > 0) throw Error(`force repost cooldown: retry in ${Math.ceil(remaining / 60000)} min`)
  } else if (await Promise.all(posts.map((_, index) => redis.get(`${postedKeyPrefix}:${index}`))).then(keys => keys.every(Boolean))) {
    return {count: payload.count, skipped: true}
  }
  let firstUrl: string | undefined
  for (const [index, item] of posts.entries()) {
    const postedKey = `${postedKeyPrefix}:${index}`
    if (!force && await redis.get(postedKey)) continue
    const post = await reddit.submitPost({subredditName: targetSubreddit, title: item.title!, text: item.body!, flairId: flair.id, flairText: flair.text})
    await redis.set(postedKey, post.id)
    firstUrl ??= post.url
  }
  if (force) await redis.set(forceKey, `${Date.now()}`)
  return {count: payload.count, url: firstUrl}
}

function writeJson(status: number, json: Readonly<PartialJsonValue>, res: ServerResponse): void {
  const body = JSON.stringify(json)
  res.writeHead(status, {'Content-Length': Buffer.byteLength(body), 'Content-Type': 'application/json'})
  res.end(body)
}
