import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { mcp, oAuthDiscoveryMetadata } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { polar, portal, webhooks } from '@polar-sh/better-auth'
import { db } from '@loora/db'
import * as schema from '@loora/db/schema'
import { applyCustomerStateWebhook } from '@loora/billing/billing'
import { getPolarClient, getPolarRuntime } from '@loora/billing/polar'
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from './legal-consent'

const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim()
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
const polarRuntime = getPolarRuntime()

export const googleOAuthEnabled = Boolean(googleClientId && googleClientSecret)

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  ...(googleClientId && googleClientSecret
    ? {
        socialProviders: {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
          },
        },
      }
    : {}),
  user: {
    additionalFields: {
      isAdmin: {
        type: 'boolean',
        required: false,
        defaultValue: false,
        input: false,
      },
      previewAccess: {
        type: 'boolean',
        required: false,
        defaultValue: false,
        input: false,
      },
      usageMultiplier: {
        type: 'number',
        required: false,
        defaultValue: 1,
        input: false,
      },
      acceptedTerms: {
        type: 'boolean',
        required: false,
        defaultValue: false,
      },
      acceptedPrivacy: {
        type: 'boolean',
        required: false,
        defaultValue: false,
      },
      termsAcceptedAt: {
        type: 'date',
        required: false,
        input: false,
      },
      privacyAcceptedAt: {
        type: 'date',
        required: false,
        input: false,
      },
      termsVersion: {
        type: 'string',
        required: false,
        input: false,
      },
      privacyVersion: {
        type: 'string',
        required: false,
        input: false,
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (newUser, context) => {
          if (context?.path !== '/sign-up/email') return { data: newUser }
          if (newUser.acceptedTerms !== true || newUser.acceptedPrivacy !== true) {
            throw new APIError('BAD_REQUEST', {
              message: 'You must accept the Terms of Service and Privacy Policy.',
            })
          }

          const acceptedAt = new Date()
          return {
            data: {
              ...newUser,
              acceptedTerms: true,
              acceptedPrivacy: true,
              termsAcceptedAt: acceptedAt,
              privacyAcceptedAt: acceptedAt,
              termsVersion: CURRENT_TERMS_VERSION,
              privacyVersion: CURRENT_PRIVACY_VERSION,
            },
          }
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    ...(polarRuntime.config
      ? [
          polar({
            client: getPolarClient(),
            createCustomerOnSignUp: false,
            use: [
              portal({ returnUrl: polarRuntime.config.origin }),
              webhooks({
                secret: polarRuntime.config.webhookSecret,
                onCustomerStateChanged: async (payload) => {
                  await applyCustomerStateWebhook(payload.data, payload.timestamp)
                },
              }),
            ],
          }),
        ]
      : []),
    // OAuth 2.1 authorization server for the remote MCP server
    // (mcp.loora.design). Handles dynamic client registration, PKCE authorize
    // and token endpoints under /api/auth/mcp/*; unauthenticated authorize
    // requests land on the app root, and the flow resumes once a session
    // exists. The resource server validates the issued tokens against the
    // same database (apps/mcp).
    mcp({
      loginPage: '/',
      oidcConfig: {
        loginPage: '/',
        consentPage: '/mcp-consent',
        // The 1h default meant a connected editor died mid-session every hour;
        // clients that do refresh then churn a token per hour, and clients that
        // don't just stop working. A working day of access, a month of refresh.
        accessTokenExpiresIn: 60 * 60 * 12,
        refreshTokenExpiresIn: 60 * 60 * 24 * 30,
      },
      ...(process.env.MCP_RESOURCE_URL?.trim()
        ? { resource: process.env.MCP_RESOURCE_URL.trim() }
        : {}),
    }),
    tanstackStartCookies(),
  ],
})

// Some MCP clients skip the WWW-Authenticate pointer and probe the site root
// for /.well-known/oauth-authorization-server; apps/web mounts this there.
export const mcpOAuthDiscoveryHandler = oAuthDiscoveryMetadata(auth)

export async function getSession(request: Request) {
  return auth.api.getSession({ headers: request.headers })
}

export async function requireSession(request: Request) {
  const session = await getSession(request)
  return session ?? null
}
