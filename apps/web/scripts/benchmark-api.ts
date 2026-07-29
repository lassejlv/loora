import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { RouterClient } from '@orpc/server'
import type { appRouter } from '@loora/rpc'

type BenchmarkTarget = 'canvas' | 'mcp'

function integerEnvironment(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return parsed
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function percentile(samples: number[], fraction: number) {
  const sorted = [...samples].sort((left, right) => left - right)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  )
  return sorted[index] ?? 0
}

function summary(samples: number[]) {
  const average =
    samples.reduce((total, sample) => total + sample, 0) /
    Math.max(1, samples.length)
  return {
    requests: samples.length,
    averageMs: Math.round(average * 10) / 10,
    p50Ms: Math.round(percentile(samples, 0.5) * 10) / 10,
    p95Ms: Math.round(percentile(samples, 0.95) * 10) / 10,
    p99Ms: Math.round(percentile(samples, 0.99) * 10) / 10,
    maximumMs: Math.round(Math.max(...samples) * 10) / 10,
  }
}

async function benchmark(
  task: () => Promise<void>,
  iterations: number,
  concurrency: number,
) {
  const samples: number[] = []
  let next = 0
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < iterations) {
        next += 1
        const startedAt = performance.now()
        await task()
        samples.push(performance.now() - startedAt)
      }
    }),
  )
  return samples
}

function serverTotalDuration(value: string | null) {
  if (!value) return null
  const match = /(?:^|,\s*)total;dur=([0-9.]+)/.exec(value)
  return match ? Number(match[1]) : null
}

async function benchmarkCanvas(
  baseUrl: string,
  designId: string,
  draftId: string | null,
  iterations: number,
  concurrency: number,
) {
  const cookie = requiredEnvironment('LOORA_BENCHMARK_SESSION_COOKIE')
  const serverSamples: number[] = []
  const measuredFetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const response = await fetch(input, init)
      const serverDuration = serverTotalDuration(
        response.headers.get('server-timing'),
      )
      if (serverDuration !== null) serverSamples.push(serverDuration)
      return response
    },
    { preconnect: fetch.preconnect },
  )
  const link = new RPCLink({
    url: `${baseUrl}/api/rpc`,
    headers: () => ({ cookie }),
    fetch: measuredFetch,
  })
  const client: RouterClient<typeof appRouter> = createORPCClient(link)
  const initial = await client.canvas.get({ designId, draftId })
  if (initial.status !== 'ready') {
    throw new Error('The benchmark target is not a supported Canvas document')
  }
  const task = async () => {
    const result = await client.canvas.get({
      designId,
      draftId,
      sinceRevision: initial.revision,
    })
    if (result.status !== 'ready') {
      throw new Error('Canvas became unavailable during the benchmark')
    }
  }
  await benchmark(task, 3, 1)
  serverSamples.length = 0
  const wallSamples = await benchmark(task, iterations, concurrency)
  return {
    target: 'canvas',
    wall: summary(wallSamples),
    server: serverSamples.length > 0 ? summary(serverSamples) : null,
  }
}

async function benchmarkMcp(
  baseUrl: string,
  designId: string,
  draftId: string | null,
  iterations: number,
  concurrency: number,
) {
  const token = requiredEnvironment('LOORA_BENCHMARK_MCP_TOKEN')
  let requestSequence = 0
  const serverSamples: number[] = []
  const task = async () => {
    requestSequence += 1
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'Mcp-Protocol-Version': '2025-03-26',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: requestSequence,
        method: 'tools/call',
        params: {
          name: 'getDesignContext',
          arguments: {
            designId,
            ...(draftId ? { draftId } : {}),
            depth: 1,
          },
        },
      }),
    })
    const serverDuration = serverTotalDuration(
      response.headers.get('server-timing'),
    )
    if (serverDuration !== null) serverSamples.push(serverDuration)
    if (!response.ok) {
      throw new Error(`MCP benchmark request failed with HTTP ${response.status}`)
    }
    const payload = (await response.json()) as {
      error?: { message?: string }
    }
    if (payload.error) {
      throw new Error(payload.error.message ?? 'MCP benchmark request failed')
    }
  }
  await benchmark(task, 3, 1)
  serverSamples.length = 0
  const wallSamples = await benchmark(task, iterations, concurrency)
  return {
    target: 'mcp',
    wall: summary(wallSamples),
    server: serverSamples.length > 0 ? summary(serverSamples) : null,
  }
}

const target = (process.env.LOORA_BENCHMARK_TARGET?.trim() ||
  'canvas') as BenchmarkTarget
if (target !== 'canvas' && target !== 'mcp') {
  throw new Error('LOORA_BENCHMARK_TARGET must be canvas or mcp')
}

const baseUrl = requiredEnvironment('LOORA_BENCHMARK_BASE_URL').replace(
  /\/+$/,
  '',
)
const designId = requiredEnvironment('LOORA_BENCHMARK_DESIGN_ID')
const draftId = process.env.LOORA_BENCHMARK_DRAFT_ID?.trim() || null
const iterations = integerEnvironment('LOORA_BENCHMARK_ITERATIONS', 50, 1, 10_000)
const concurrency = integerEnvironment('LOORA_BENCHMARK_CONCURRENCY', 1, 1, 50)

const result =
  target === 'canvas'
    ? await benchmarkCanvas(
        baseUrl,
        designId,
        draftId,
        iterations,
        concurrency,
      )
    : await benchmarkMcp(
        baseUrl,
        designId,
        draftId,
        iterations,
        concurrency,
      )

console.log(JSON.stringify(result, null, 2))
