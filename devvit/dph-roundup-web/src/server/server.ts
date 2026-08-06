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
async function postRoundup(): Promise<{
  count: number
  url?: string
  skipped?: boolean
}> {
  const githubRepo = (await settings.get<string>('githubRepo'))?.trim()
  const githubPath = (await settings.get<string>('githubPath'))?.trim()
  const githubBranch =
    (await settings.get<string>('githubBranch'))?.trim() || 'main'
  const githubToken = (await settings.get<string>('githubToken'))?.trim()
  const targetSub =
    (await settings.get<string>('targetSubreddit')) || context.subredditName
  if (!githubRepo || !githubPath)
    throw Error('githubRepo / githubPath not set in app settings')
  if (!targetSub) throw Error('no target subreddit')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(githubRepo))
    throw Error('githubRepo must be owner/repo')

  const path = githubPath.split('/').map(encodeURIComponent).join('/')
  const res = await fetch(
    `https://api.github.com/repos/${githubRepo}/contents/${path}?ref=${encodeURIComponent(githubBranch)}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        ...(githubToken ? {Authorization: `Bearer ${githubToken}`} : {}),
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  )
  if (!res.ok) throw Error(`GitHub roundup fetch failed: ${res.status}`)
  const source = (await res.json()) as {content?: string; encoding?: string}
  if (source.encoding !== 'base64' || !source.content)
    throw Error('GitHub bridge response has no base64 content')
  let data: {
    title: string
    body: string
    count: number
    cycle_id?: string
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
  if (!cycleId) throw Error('GitHub bridge payload has no cycle_id')
  const postedKey = `roundup:posted:${targetSub}:${cycleId}`
  if (await redis.get(postedKey)) {
    return {count: data.count, skipped: true}
  }

  const post = await reddit.submitPost({
    subredditName: targetSub,
    title: data.title,
    text: data.body,
  })
  await redis.set(postedKey, post.id)
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
