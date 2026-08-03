import { configureRuntime } from '@loora/platform'

configureRuntime({
  apiOrigin:
    import.meta.env.VITE_LOORA_API_ORIGIN ??
    (import.meta.env.DEV ? 'http://localhost:3001' : 'https://api.loora.design'),
})
