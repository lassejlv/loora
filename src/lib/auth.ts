import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { checkout, polar, portal, webhooks } from '@polar-sh/better-auth'
import { db } from '#/db'
import * as schema from '#/db/schema'
import { applyCustomerStateWebhook } from '#/lib/billing'
import { applyPaidTopUpOrder, applyRefundedTopUpOrder } from '#/lib/credit-top-ups'
import { getPolarClient, getPolarRuntime } from '#/lib/polar'

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
              checkout({
                products: [
                  { productId: polarRuntime.config.proProductId, slug: 'pro' },
                  { productId: polarRuntime.config.studioProductId, slug: 'studio' },
                ],
                successUrl: `${polarRuntime.config.origin}/?checkout=success&checkout_id={CHECKOUT_ID}`,
                returnUrl: polarRuntime.config.origin,
                authenticatedUsersOnly: true,
              }),
              portal({ returnUrl: polarRuntime.config.origin }),
              webhooks({
                secret: polarRuntime.config.webhookSecret,
                onCustomerStateChanged: async (payload) => {
                  await applyCustomerStateWebhook(payload.data, payload.timestamp)
                },
                onOrderPaid: async (payload) => {
                  await applyPaidTopUpOrder(payload.data, payload.timestamp)
                },
                onOrderRefunded: async (payload) => {
                  await applyRefundedTopUpOrder(payload.data, payload.timestamp)
                },
              }),
            ],
          }),
        ]
      : []),
    tanstackStartCookies(),
  ],
})

export async function getSession(request: Request) {
  return auth.api.getSession({ headers: request.headers })
}

export async function requireSession(request: Request) {
  const session = await getSession(request)
  return session ?? null
}
