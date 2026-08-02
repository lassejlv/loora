import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { passkey } from '@better-auth/passkey'
import {
  bearer,
  haveIBeenPwned,
  mcp,
  oAuthDiscoveryMetadata,
  oneTimeToken,
} from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { polar, portal, webhooks } from '@polar-sh/better-auth'
import { db } from '@loora/db'
import * as schema from '@loora/db/schema'
import { applyCustomerStateWebhook } from '@loora/billing/billing'
import { getPolarClient } from '@loora/billing/polar-client'
import { getPolarRuntime } from '@loora/billing/polar'
import {
  sendAccountVerificationEmail,
  sendPasswordResetEmail,
} from '@loora/email'
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
  advanced: {
    /**
     * Where the caller's address comes from, for Better Auth's own rate
     * limiting and for the addresses it records on sessions.
     *
     * Its default is `x-forwarded-for`, and it refuses that header outright
     * when it carries more than one entry — which behind Cloudflare and
     * Railway it always does. The result was every caller sharing one bucket
     * per path, so one busy client could turn sign-in away for everybody.
     *
     * Cloudflare overwrites `cf-connecting-ip` on every proxied request, so it
     * holds exactly one entry and no client can set it. `x-forwarded-for`
     * stays behind it for a deployment without Cloudflare in front; Better
     * Auth's own single-entry rule is what keeps that fallback honest.
     */
    ipAddress: {
      ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'],
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url, token }) => {
      void sendPasswordResetEmail({
        email: user.email,
        name: user.name,
        token,
        url,
      }).catch(reportEmailFailure('password-reset'))
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url, token }) => {
      void sendAccountVerificationEmail({
        email: user.email,
        name: user.name,
        token,
        url,
      }).catch(reportEmailFailure('account-verification'))
    },
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
    // same database through the Rust MCP resource server.
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
    // The desktop app has no cookie jar: its own process holds the session and
    // sends it as `Authorization: Bearer <token>` when it proxies a request on
    // to this app. The token is the same signed session token the cookie
    // carries, so a stolen one is worth exactly what a stolen cookie is.
    bearer(),
    // How the desktop app comes by that token. The browser signs in at
    // loora.design as usual, mints a single-use code from that session, and
    // hands it to the app waiting on loopback, which trades it for the
    // session. Only the hash is stored, so the row is worthless on its own.
    oneTimeToken({ expiresIn: 2, storeToken: 'hashed' }),
    tanstackStartCookies(),
    haveIBeenPwned({
      customPasswordCompromisedMessage:
        'This password has appeared in a data breach. Please choose a different one.',
    }),
    passkey(),
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

function reportEmailFailure(kind: 'account-verification' | 'password-reset') {
  return () => {
    console.error(JSON.stringify({
      event: 'email.send_failed',
      kind,
    }))
  }
}
