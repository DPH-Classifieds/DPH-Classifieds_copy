import {once} from 'node:events'
import type {IncomingMessage, ServerResponse} from 'node:http'
import {context, reddit, redis, settings} from '@devvit/web/server'
import type {
  PartialJsonValue,
  TriggerResponse,
  UiResponse,
} from '@devvit/web/shared'
import {
  Endpoint,
  EndpointMethod,
  type ErrorRsp,
  type GetCounterRsp,
  type IncCounterReq,
  type IncCounterRsp,
} from '../shared/api.ts'
import {dbGetCounter, dbIncCounter} from './db.ts'

type AnyRsp =
  | GetCounterRsp
  | IncCounterRsp
  | UiResponse
  | TriggerResponse
  | ErrorRsp

export async function onReq(
  reqMsg: IncomingMessage,
  rspMsg: ServerResponse,
): Promise<void> {
  try {
    await route(reqMsg, rspMsg)
  } catch (err) {
    const msg = `server error; ${err instanceof Error ? err.stack : err}`
    console.error(msg)
    writeJson<ErrorRsp>(500, {error: msg, status: 500}, rspMsg)
  }
}

async function route(
  reqMsg: IncomingMessage,
  rspMsg: ServerResponse,
): Promise<void> {
  const endpoint = reqMsg.url?.slice(1) as Endpoint
  const method = EndpointMethod[endpoint]

  let rsp: AnyRsp
  if (method !== reqMsg.method) {
    rsp = {error: 'not found', status: 404}
  } else {
    switch (endpoint) {
      case Endpoint.GetCounter:
        rsp = await routeGetCounter()
        break
      case Endpoint.IncCounter:
        rsp = await routeInc(reqMsg)
        break
      case Endpoint.OnMenuNewPost:
        rsp = await routeMenuNewPost()
        break
      case Endpoint.OnAppInstall:
        rsp = await routeAppInstall()
        break
      case Endpoint.OnCronRoundup:
        rsp = await routeCronRoundup()
        break
      case Endpoint.OnMenuRoundup:
        rsp = await routeMenuRoundup()
        break
      case Endpoint.OnMenuForceRoundup:
        rsp = await routeMenuForceRoundup()
        break
      default:
        endpoint satisfies never
        rsp = {error: 'not found', status: 404}
        break
    }
  }

  writeJson<PartialJsonValue>('status' in rsp ? rsp.status : 200, rsp, rspMsg)
}

async function routeGetCounter(): Promise<GetCounterRsp> {
  const t3 = context.postId
  if (!t3) throw Error('no t3')
  return {count: await dbGetCounter(t3)}
}

async function routeInc(reqMsg: IncomingMessage): Promise<IncCounterRsp> {
  const t3 = context.postId
  if (!t3) throw Error('no t3')
  const req = await readJson<IncCounterReq>(reqMsg)
  return {count: await dbIncCounter(t3, req.amount)}
}

async function routeMenuNewPost(): Promise<UiResponse> {
  const post = await reddit.submitCustomPost({title: context.appSlug})
  return {
    showToast: {text: `Post ${post.id} created.`, appearance: 'success'},
    navigateTo: post.url,
  }
}

async function routeAppInstall(): Promise<TriggerResponse> {
  // No-op: the roundup is scheduled via devvit.json (scheduler.tasks.roundup),
  // so install does not need to seed any post.
  return {}
}

/**
 * Fetch the pre-built roundup from the GitHub bridge and submit it. Railway
 * writes the bridge file; Devvit never needs to reach the Railway hostname.
 */
const FORCE_REPOST_COOLDOWN_MS = 10 * 60 * 1000

async function postRoundup(force = false): Promise<{
  count: number
  url?: string
  skipped?: boolean
}> {
  const githubUrl = (await settings.get<string>('roundupUrl'))?.trim()
  const githubToken = (await settings.get<string>('roundupToken'))?.trim()
  const targetSub =
    (await settings.get<string>('targetSubreddit')) || context.subredditName
  if (!githubUrl) throw Error('roundupUrl is not set in app settings')
  if (!targetSub) throw Error('no target subreddit')
  let githubApi: URL
  try {
    githubApi = new URL(githubUrl)
  } catch {
    throw Error('roundupUrl must be a valid GitHub API URL')
  }
  if (
    githubApi.protocol !== 'https:' ||
    githubApi.hostname !== 'api.github.com'
  )
    throw Error('roundupUrl must use api.github.com')
  if (!githubApi.pathname.startsWith('/repos/'))
    throw Error('roundupUrl must be a GitHub repository Contents API URL')
  // The app previously stored its Railway shared secret in roundupToken. Only
  // forward an explicit GitHub token; never leak that retired backend secret.
  const githubHeaders: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (/^(ghp_|github_pat_)/.test(githubToken || ''))
    githubHeaders.Authorization = `Bearer ${githubToken}`
  const res = await fetch(githubApi.toString(), {
    headers: githubHeaders,
  })
  if (!res.ok) throw Error(`GitHub roundup fetch failed: ${res.status}`)
  const source = (await res.json()) as {content?: string; encoding?: string}
  if (source.encoding !== 'base64' || !source.content)
    throw Error('GitHub bridge response has no base64 content')
  let data: {
    title: string
    body: string
    count: number
    cycle_id?: string
    content_hash?: string
    schema?: string
  }
  try {
    data = JSON.parse(Buffer.from(source.content, 'base64').toString('utf8'))
  } catch {
    throw Error('GitHub bridge JSON is invalid')
  }
  if (
    data.schema !== 'dph-reddit-roundup/v1' ||
    !data.title ||
    !data.body ||
    !Number.isInteger(data.count)
  )
    throw Error('GitHub bridge payload is invalid')
  if (!data.count) return {count: 0, skipped: true}

  const cycleId = data.cycle_id
  const contentHash = data.content_hash
  if (!cycleId || !contentHash)
    throw Error('GitHub bridge payload has no cycle_id/content_hash')
  // A changed prepared post is a new revision for a moderator-initiated test,
  // while the unchanged scheduled payload remains exactly-once.
  const postedKey = `roundup:posted:${targetSub}:${cycleId}:${contentHash}`
  const forceKey = `roundup:force:last:${targetSub}`
  if (force) {
    const lastForce = Number(await redis.get(forceKey))
    const remaining = FORCE_REPOST_COOLDOWN_MS - (Date.now() - lastForce)
    if (Number.isFinite(lastForce) && remaining > 0)
      throw Error(
        `force repost cooldown: retry in ${Math.ceil(remaining / 60000)} min`,
      )
  } else if (await redis.get(postedKey)) {
    return {count: data.count, skipped: true}
  }

  const post = await reddit.submitPost({
    subredditName: targetSub,
    title: data.title,
    text: data.body,
  })
  await redis.set(postedKey, post.id)
  if (force) await redis.set(forceKey, `${Date.now()}`)
  return {count: data.count, url: post.url}
}

async function routeCronRoundup(): Promise<TriggerResponse> {
  const r = await postRoundup()
  console.log(
    r.skipped
      ? 'roundup: no new listings; skipped'
      : `roundup: posted ${r.count} cars -> ${r.url}`,
  )
  return {}
}

async function routeMenuRoundup(): Promise<UiResponse> {
  try {
    const r = await postRoundup()
    return {
      showToast: {
        text: r.skipped
          ? 'No new listings to post.'
          : `Posted ${r.count} cars.`,
        appearance: 'success',
      },
    }
  } catch (err) {
    // Surface the real error in the toast so it's visible without playtest logs.
    const msg = err instanceof Error ? err.message : String(err)
    return {showToast: {text: `Roundup failed: ${msg}`.slice(0, 450)}}
  }
}

async function routeMenuForceRoundup(): Promise<UiResponse> {
  try {
    const r = await postRoundup(true)
    return {
      showToast: {
        text: `Test reposted ${r.count} cars.`,
        appearance: 'success',
      },
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {showToast: {text: `Force repost failed: ${msg}`.slice(0, 450)}}
  }
}

async function readJson<T>(reqMsg: IncomingMessage): Promise<T> {
  const chunks: Uint8Array[] = []
  reqMsg.on('data', chunk => chunks.push(chunk))
  await once(reqMsg, 'end')
  return JSON.parse(`${Buffer.concat(chunks)}`)
}

function writeJson<T extends PartialJsonValue>(
  status: number,
  json: Readonly<T>,
  rsp: ServerResponse,
): void {
  const body = JSON.stringify(json)
  const len = Buffer.byteLength(body)
  rsp.writeHead(status, {
    'Content-Length': len,
    'Content-Type': 'application/json',
  })
  rsp.end(body)
}
