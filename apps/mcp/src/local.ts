import { configFrom } from './config'
import { handleRequest, createAppState } from './handler'

const config = configFrom((key) => process.env[key])
const state = createAppState(config)

const server = Bun.serve({
  port: config.port,
  fetch: (request) => handleRequest(request, state),
})

console.info(`Loora MCP server listening on http://localhost:${server.port}`)
