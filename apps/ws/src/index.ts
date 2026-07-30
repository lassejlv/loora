// ws.loora.design — the realtime service.
//
// One socket per open document. The web app authenticates the person, checks
// their access to the design, and mints a short-lived ticket; this process only
// verifies that ticket, then joins the socket to the room. Everything else it
// carries — canvas revisions, agent activity from MCP tool calls, and cursors —
// is fanned out through Bun's own pub/sub, with Redis carrying events between
// instances when it is configured.
import { readWsConfig, WsConfigError, type WsConfig } from './config'
import { createRealtimeService } from './server'

let config: WsConfig
try {
  config = readWsConfig()
} catch (error) {
  console.error(
    `[loora-ws] ${error instanceof WsConfigError ? error.message : error}`,
  )
  process.exit(1)
}

const service = createRealtimeService(config)

function shutdown(signal: string) {
  console.info(`[loora-ws] ${signal} — closing ${service.sockets.size} socket(s)`)
  void service.stop().finally(() => process.exit(0))
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

console.info(
  `[loora-ws] listening on :${service.server.port} — bus ${service.bus.kind}, ` +
    `origins ${config.allowedOrigins?.join(', ') ?? 'any'}`,
)
