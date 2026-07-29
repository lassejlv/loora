import { relations, sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import type { CanvasDocument } from '@loora/canvas/model'
import type { CanvasTransaction } from '@loora/canvas/engine'
import type { CanvasElement, CanvasPage } from './canvas'
import type { DraftStatus } from './drafts'
import type { ShortcutConfig } from './shortcuts'
import { EMPTY_SHORTCUT_CONFIG } from './shortcuts'

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
    pages: jsonb('pages').$type<CanvasPage[]>().default([]).notNull(),
    canvasVersion: integer('canvas_version').default(1).notNull(),
    canvasDocument: jsonb('canvas_document').$type<CanvasDocument>(),
    canvasMigrationLeaseId: text('canvas_migration_lease_id'),
    canvasMigrationLeaseExpiresAt: timestamp('canvas_migration_lease_expires_at'),
    revision: integer('revision').default(0).notNull(),
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

export const designDraft = pgTable(
  'design_draft',
  {
    id: text('id').notNull(),
    designId: text('design_id').notNull(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    description: text('description').default('').notNull(),
    status: text('status').$type<DraftStatus>().default('active').notNull(),
    baseShapes: jsonb('base_shapes').$type<CanvasElement[]>().notNull(),
    shapes: jsonb('shapes').$type<CanvasElement[]>().notNull(),
    basePages: jsonb('base_pages').$type<CanvasPage[]>().default([]).notNull(),
    pages: jsonb('pages').$type<CanvasPage[]>().default([]).notNull(),
    canvasVersion: integer('canvas_version').default(1).notNull(),
    baseCanvasVersion: integer('base_canvas_version').default(1).notNull(),
    baseCanvasDocument: jsonb('base_canvas_document').$type<CanvasDocument>(),
    canvasDocument: jsonb('canvas_document').$type<CanvasDocument>(),
    baseRevision: integer('base_revision').notNull(),
    revision: integer('revision').default(0).notNull(),
    appliedVersionId: text('applied_version_id'),
    proposedAt: timestamp('proposed_at'),
    appliedAt: timestamp('applied_at'),
    closedAt: timestamp('closed_at'),
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
      name: 'design_draft_design_fk',
    }).onDelete('cascade'),
    index('design_draft_design_idx').on(table.userId, table.designId, table.status, table.updatedAt),
  ],
)

export const designVersion = pgTable(
  'design_version',
  {
    id: text('id').notNull(),
    designId: text('design_id').notNull(),
    draftId: text('draft_id'),
    userId: text('user_id').notNull(),
    message: text('message').notNull(),
    shapes: jsonb('shapes').$type<CanvasElement[]>().notNull(),
    pages: jsonb('pages').$type<CanvasPage[]>().default([]).notNull(),
    canvasVersion: integer('canvas_version').default(1).notNull(),
    canvasDocument: jsonb('canvas_document').$type<CanvasDocument>(),
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
    foreignKey({
      columns: [table.draftId, table.userId],
      foreignColumns: [designDraft.id, designDraft.userId],
      name: 'design_version_draft_fk',
    }).onDelete('cascade'),
    index('design_version_design_idx').on(
      table.userId,
      table.designId,
      table.draftId,
      table.createdAt,
    ),
  ],
)

export const canvasTransaction = pgTable(
  'canvas_transaction',
  {
    designId: text('design_id').notNull(),
    userId: text('user_id').notNull(),
    targetKey: text('target_key').notNull(),
    transactionId: text('transaction_id').notNull(),
    baseRevision: integer('base_revision').notNull(),
    revision: integer('revision').notNull(),
    transaction: jsonb('transaction').$type<CanvasTransaction>().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.designId, table.targetKey, table.transactionId],
    }),
    foreignKey({
      columns: [table.designId, table.userId],
      foreignColumns: [design.id, design.userId],
      name: 'canvas_transaction_design_fk',
    }).onDelete('cascade'),
    index('canvas_transaction_target_revision_idx').on(
      table.userId,
      table.designId,
      table.targetKey,
      table.revision,
    ),
    index('canvas_transaction_created_idx').on(table.createdAt),
  ],
)

export const canvasAgentActivity = pgTable(
  'canvas_agent_activity',
  {
    id: text('id').notNull(),
    designId: text('design_id').notNull(),
    userId: text('user_id').notNull(),
    targetKey: text('target_key').notNull(),
    label: text('label').notNull(),
    nodeIds: jsonb('node_ids').$type<string[]>().default([]).notNull(),
    phase: text('phase')
      .$type<'working' | 'settled'>()
      .default('working')
      .notNull(),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.userId] }),
    foreignKey({
      columns: [table.designId, table.userId],
      foreignColumns: [design.id, design.userId],
      name: 'canvas_agent_activity_design_fk',
    }).onDelete('cascade'),
    index('canvas_agent_activity_target_idx').on(
      table.userId,
      table.designId,
      table.targetKey,
      table.expiresAt,
    ),
    index('canvas_agent_activity_expires_idx').on(table.expiresAt),
  ],
)

export const designChat = pgTable(
  'design_chat',
  {
    id: text('id').notNull(),
    designId: text('design_id').notNull(),
    draftId: text('draft_id'),
    userId: text('user_id').notNull(),
    title: text('title').default('New chat').notNull(),
    messages: jsonb('messages').$type<unknown[]>().default([]).notNull(),
    githubRepositoryId: text('github_repository_id'),
    githubRepositoryFullName: text('github_repository_full_name'),
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
    foreignKey({
      columns: [table.draftId, table.userId],
      foreignColumns: [designDraft.id, designDraft.userId],
      name: 'design_chat_draft_fk',
    }).onDelete('cascade'),
    index('design_chat_design_idx').on(
      table.userId,
      table.designId,
      table.draftId,
      table.updatedAt,
    ),
  ],
)

// Short-lived public links to a single element or composed Page. The row
// id doubles as the URL capability token, so deleting the row revokes the link
// instantly; content stays live (served from the design at request time).
export const publishLink = pgTable(
  'publish_link',
  {
    id: text('id').primaryKey(),
    designId: text('design_id').notNull(),
    userId: text('user_id').notNull(),
    elementId: text('element_id'),
    pageId: text('page_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.designId, table.userId],
      foreignColumns: [design.id, design.userId],
      name: 'publish_link_design_fk',
    }).onDelete('cascade'),
    index('publish_link_design_idx').on(table.userId, table.designId),
    check(
      'publish_link_one_target',
      sql`(${table.elementId} is not null) <> (${table.pageId} is not null)`,
    ),
  ],
)

// Bytes served through public publish links, one counter row per user per UTC
// day ('YYYY-MM-DD'). Upsert-incremented per response; limits sum a rolling
// window over these rows instead of logging one row per request.
export const publishEgress = pgTable(
  'publish_egress',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    day: text('day').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).default(0).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.day] })],
)

// GitHub App user tokens are encrypted before they reach these columns. A user
// token keeps repository access intersected with the person's current GitHub
// permissions, unlike a long-lived installation-only association.
export const githubAccount = pgTable('github_account', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  githubUserId: text('github_user_id').notNull(),
  login: text('login').notNull(),
  avatarUrl: text('avatar_url'),
  accessToken: text('access_token').notNull(),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshToken: text('refresh_token'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
})

export const figmaAccount = pgTable('figma_account', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  figmaUserId: text('figma_user_id').notNull(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  scope: text('scope').default('file_content:read').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
})

export const githubInstallation = pgTable(
  'github_installation',
  {
    userId: text('user_id')
      .notNull()
      .references(() => githubAccount.userId, { onDelete: 'cascade' }),
    installationId: text('installation_id').notNull(),
    targetId: text('target_id').notNull(),
    accountLogin: text('account_login').notNull(),
    accountType: text('account_type').notNull(),
    avatarUrl: text('avatar_url'),
    repositorySelection: text('repository_selection').notNull(),
    suspendedAt: timestamp('suspended_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.installationId] }),
    index('github_installation_id_idx').on(table.installationId),
  ],
)

export const designGithubRepository = pgTable(
  'design_github_repository',
  {
    designId: text('design_id').notNull(),
    userId: text('user_id').notNull(),
    installationId: text('installation_id').notNull(),
    repositoryId: text('repository_id').notNull(),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    defaultBranch: text('default_branch').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.designId, table.userId] }),
    foreignKey({
      columns: [table.designId, table.userId],
      foreignColumns: [design.id, design.userId],
      name: 'design_github_repository_design_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.userId, table.installationId],
      foreignColumns: [githubInstallation.userId, githubInstallation.installationId],
      name: 'design_github_repository_installation_fk',
    }).onDelete('cascade'),
    index('design_github_repository_repo_idx').on(
      table.userId,
      table.installationId,
      table.repositoryId,
    ),
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
    creditUnits: integer('credit_units').default(0).notNull(),
    topUpCreditUnits: integer('top_up_credit_units').default(0).notNull(),
    polarReportedAt: timestamp('polar_reported_at'),
    polarReportAttempts: integer('polar_report_attempts').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('ai_usage_user_created_idx').on(table.userId, table.createdAt)],
)

export const userPreferences = pgTable('user_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  shortcuts: jsonb('shortcuts')
    .$type<ShortcutConfig>()
    .default(EMPTY_SHORTCUT_CONFIG)
    .notNull(),
  agentSystemPrompt: text('agent_system_prompt').default('').notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
})

// User-supplied AI provider credentials are encrypted before storage. The
// provider name is part of the primary key so more BYOK providers can be added
// without changing the ownership or deletion model.
export const aiProviderCredential = pgTable(
  'ai_provider_credential',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    encryptedApiKey: text('encrypted_api_key').notNull(),
    label: text('label'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.provider] })],
)

export const billingEntitlement = pgTable('billing_entitlement', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  polarCustomerId: text('polar_customer_id'),
  polarSubscriptionId: text('polar_subscription_id'),
  productId: text('product_id'),
  plan: text('plan'),
  subscriptionStatus: text('subscription_status'),
  accessGranted: boolean('access_granted').default(false).notNull(),
  currentPeriodStart: timestamp('current_period_start'),
  currentPeriodEnd: timestamp('current_period_end'),
  trialStart: timestamp('trial_start'),
  trialEnd: timestamp('trial_end'),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),
  meterBalance: integer('meter_balance').default(0).notNull(),
  creditedUnits: integer('credited_units').default(0).notNull(),
  consumedUnits: integer('consumed_units').default(0).notNull(),
  lastEventAt: timestamp('last_event_at'),
  syncedAt: timestamp('synced_at').defaultNow().notNull(),
})

export const billingCreditTopUp = pgTable(
  'billing_credit_top_up',
  {
    polarOrderId: text('polar_order_id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    polarCheckoutId: text('polar_checkout_id'),
    polarCustomerId: text('polar_customer_id').notNull(),
    productId: text('product_id').notNull(),
    amountCents: integer('amount_cents').notNull(),
    creditUnits: integer('credit_units').notNull(),
    refundedAmountCents: integer('refunded_amount_cents').default(0).notNull(),
    refundedCreditUnits: integer('refunded_credit_units').default(0).notNull(),
    paidAt: timestamp('paid_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('billing_credit_top_up_user_paid_idx').on(table.userId, table.paidAt)],
)

export const aiGenerationLease = pgTable(
  'ai_generation_lease',
  {
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
    token: text('token').notNull(),
    acquiredAt: timestamp('acquired_at').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
  },
  // One row per concurrent generation; the cap is enforced in acquireGenerationLease.
  (table) => [primaryKey({ columns: [table.userId, table.token] })],
)

// Login-with-ChatGPT sessions (tokens encrypted at rest by the handler).
// Keyed by the handler's opaque session id, not by app user.
export const chatgptSession = pgTable('chatgpt_session', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  expiresAt: timestamp('expires_at'),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
})

// OAuth 2.1 provider tables for the Better Auth `mcp` plugin (remote MCP
// server auth). Clients self-register (RFC 7591) as public PKCE clients, so
// clientSecret and userId are nullable.
export const oauthApplication = pgTable(
  'oauth_application',
  {
    id: text('id').primaryKey(),
    name: text('name'),
    icon: text('icon'),
    metadata: text('metadata'),
    clientId: text('client_id').unique(),
    clientSecret: text('client_secret'),
    redirectUrls: text('redirect_urls'),
    type: text('type'),
    disabled: boolean('disabled').default(false),
    userId: text('user_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
)

export const oauthAccessToken = pgTable(
  'oauth_access_token',
  {
    id: text('id').primaryKey(),
    accessToken: text('access_token').unique(),
    refreshToken: text('refresh_token').unique(),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    clientId: text('client_id'),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    scopes: text('scopes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('oauth_access_token_user_id_idx').on(table.userId)],
)

export const oauthConsent = pgTable(
  'oauth_consent',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id'),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    scopes: text('scopes'),
    consentGiven: boolean('consent_given'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('oauth_consent_user_id_idx').on(table.userId)],
)

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
