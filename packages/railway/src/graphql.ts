const RAILWAY_GRAPHQL_ENDPOINT =
  process.env.RAILWAY_GRAPHQL_ENDPOINT ??
  'https://backboard.railway.com/graphql/v2'

type GraphQLResponse<T> = {
  data?: T
  errors?: Array<{ message: string; path?: string[] }>
}

function authHeaders(): Record<string, string> {
  const token = process.env.RAILWAY_TOKEN
  if (!token) throw new Error('RAILWAY_TOKEN is not set.')
  return { 'Project-Access-Token': token }
}

async function railwayGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(RAILWAY_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!response.ok) {
    throw new Error(`Railway API returned ${response.status}`)
  }
  const body = (await response.json()) as GraphQLResponse<T>
  if (body.errors?.length) {
    throw new Error(body.errors[0]!.message)
  }
  return body.data as T
}

export function flagsOwner() {
  const projectId = process.env.RAILWAY_PROJECT_ID
  if (!projectId) throw new Error('RAILWAY_PROJECT_ID is not set.')
  return `project:${projectId}`
}

export type FlagType = 'bool' | 'string' | 'number' | 'json'

export type FlagRule = {
  id: string
  expression: unknown
  source: { type: 'literal'; value: unknown } | { type: 'sandbox'; sandboxId: string }
}

export type FlagSummary = {
  id: string
  name: string
  type: FlagType
  default: unknown
  rules: FlagRule[]
  version: number
  updatedAt: string
}

export type FlagEvaluation = {
  value: unknown
  reason: string
  trace: Array<{ ruleId: string; matched: boolean; value: unknown }>
}

export async function listFlags(): Promise<FlagSummary[]> {
  const data = await railwayGraphQL<{ signals: FlagSummary[] }>(`
    query ListFlags($owner: String!) {
      signals(owner: $owner) {
        id name type default rules version updatedAt
      }
    }
  `, { owner: flagsOwner() })
  return data.signals
}

export async function getFlag(name: string): Promise<FlagSummary> {
  const data = await railwayGraphQL<{ signal: FlagSummary }>(`
    query GetFlag($owner: String!, $name: String!) {
      signal(owner: $owner, name: $name) {
        id name type default rules version updatedAt
      }
    }
  `, { owner: flagsOwner(), name })
  return data.signal
}

export async function createFlag(
  name: string,
  type: FlagType,
  defaultValue: unknown,
): Promise<FlagSummary> {
  const data = await railwayGraphQL<{ signalCreate: FlagSummary }>(`
    mutation CreateFlag($input: SignalCreateInput!) {
      signalCreate(input: $input) {
        id name type default rules version updatedAt
      }
    }
  `, {
    input: {
      name,
      owner: flagsOwner(),
      type,
      default: defaultValue,
    },
  })
  return data.signalCreate
}

export async function updateFlagDefault(
  name: string,
  defaultValue: unknown,
): Promise<FlagSummary> {
  const data = await railwayGraphQL<{ signalDefaultSet: FlagSummary }>(`
    mutation UpdateDefault($input: SignalDefaultSetInput!) {
      signalDefaultSet(input: $input) {
        id name type default rules version updatedAt
      }
    }
  `, {
    input: {
      name,
      owner: flagsOwner(),
      default: defaultValue,
    },
  })
  return data.signalDefaultSet
}

export async function setFlagRule(
  name: string,
  ruleId: string,
  expression: unknown,
  value: unknown,
): Promise<FlagSummary> {
  const data = await railwayGraphQL<{ signalRuleSet: FlagSummary }>(`
    mutation SetRule($input: SignalRuleSetInput!) {
      signalRuleSet(input: $input) {
        id name type default rules version updatedAt
      }
    }
  `, {
    input: {
      name,
      owner: flagsOwner(),
      ruleId,
      expression,
      value,
    },
  })
  return data.signalRuleSet
}

export async function unsetFlagRule(
  name: string,
  ruleId: string,
): Promise<FlagSummary> {
  const data = await railwayGraphQL<{ signalRuleUnset: FlagSummary }>(`
    mutation UnsetRule($input: SignalRuleUnsetInput!) {
      signalRuleUnset(input: $input) {
        id name type default rules version updatedAt
      }
    }
  `, {
    input: {
      name,
      owner: flagsOwner(),
      ruleId,
    },
  })
  return data.signalRuleUnset
}

export async function deleteFlag(name: string): Promise<{ id: string; name: string }> {
  const data = await railwayGraphQL<{ signalDelete: { id: string; name: string } }>(`
    mutation DeleteFlag($input: SignalDeleteInput!) {
      signalDelete(input: $input) { id name }
    }
  `, {
    input: {
      name,
      owner: flagsOwner(),
    },
  })
  return data.signalDelete
}

export async function evaluateFlag(
  name: string,
  context: Record<string, unknown>,
): Promise<FlagEvaluation> {
  const data = await railwayGraphQL<{ signalEvaluate: FlagEvaluation }>(`
    query EvaluateFlag($owner: String!, $name: String!, $context: JSON!) {
      signalEvaluate(owner: $owner, name: $name, context: $context) {
        value reason trace { ruleId matched value }
      }
    }
  `, { owner: flagsOwner(), name, context })
  return data.signalEvaluate
}