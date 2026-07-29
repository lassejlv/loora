import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { checkDatabaseConnection } from '@loora/db'
import { serviceReadinessResponse } from '@loora/rpc/readiness'

export function readinessResponse() {
  return serviceReadinessResponse('web', checkDatabaseConnection)
}

export const Route = createFileRoute('/api/ready')({
  server: {
    handlers: {
      GET: () => readinessResponse(),
    },
  },
})
