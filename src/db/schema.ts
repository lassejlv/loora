import { relations } from 'drizzle-orm'
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import type { UIMessage } from 'ai'
import type { CanvasElement } from '#/lib/canvas'

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  isAdmin: boolean('is_admin').default(false).notNull(),
  previewAccess: boolean('preview_access').default(false).notNull(),
  previewAccessRequestedAt: timestamp('preview_access_requested_at'),
  usageMultiplier: integer('usage_multiplier').default(1).notNull(),
  image: text('image'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
})

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('session_user_id_idx').on(table.userId)],
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('account_user_id_idx').on(table.userId)],
)

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
)

export const design = pgTable(
  'design',
  {
    id: text('id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    shapes: jsonb('shapes').$type<CanvasElement[]>().default([]).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.userId] }),
    index('design_user_id_idx').on(table.userId),
  ],
)

export const designVersion = pgTable(
  'design_version',
  {
    id: text('id').notNull(),
    designId: text('design_id').notNull(),
    userId: text('user_id').notNull(),
    message: text('message').notNull(),
    shapes: jsonb('shapes').$type<CanvasElement[]>().notNull(),
    added: integer('added').notNull(),
    removed: integer('removed').notNull(),
    changed: integer('changed').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.userId] }),
    foreignKey({
      columns: [table.designId, table.userId],
      foreignColumns: [design.id, design.userId],
      name: 'design_version_design_fk',
    }).onDelete('cascade'),
    index('design_version_design_idx').on(table.userId, table.designId, table.createdAt),
  ],
)

export const designChat = pgTable(
  'design_chat',
  {
    id: text('id').notNull(),
    designId: text('design_id').notNull(),
    userId: text('user_id').notNull(),
    title: text('title').default('New chat').notNull(),
    messages: jsonb('messages').$type<UIMessage[]>().default([]).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.userId] }),
    foreignKey({
      columns: [table.designId, table.userId],
      foreignColumns: [design.id, design.userId],
      name: 'design_chat_design_fk',
    }).onDelete('cascade'),
    index('design_chat_design_idx').on(table.userId, table.designId, table.updatedAt),
  ],
)

export const asset = pgTable(
  'asset',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    mediaType: text('media_type').notNull(),
    size: integer('size').notNull(),
    // S3 object key when a bucket is configured…
    storageKey: text('storage_key'),
    // …else base64 payload directly in Postgres
    data: text('data'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('asset_user_id_idx').on(table.userId, table.createdAt)],
)

// One row per completed AI request; cost stored in micro-USD so limit sums stay integer.
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    costMicroUsd: integer('cost_micro_usd').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('ai_usage_user_created_idx').on(table.userId, table.createdAt)],
)

// Login-with-ChatGPT sessions (tokens encrypted at rest by the handler).
// Keyed by the handler's opaque session id, not by app user.
export const chatgptSession = pgTable('chatgpt_session', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  expiresAt: timestamp('expires_at'),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
})

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  designs: many(design),
}))

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}))

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}))

export const designRelations = relations(design, ({ one }) => ({
  user: one(user, { fields: [design.userId], references: [user.id] }),
}))
