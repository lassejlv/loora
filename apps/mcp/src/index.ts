import { handleRequest, stateFromEnv } from './handler'
import type { Env } from './env'

export default {
  async fetch(request: Request, env: Env) {
    return handleRequest(request, stateFromEnv(env))
  },
}
