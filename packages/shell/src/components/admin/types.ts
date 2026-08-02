import type { orpc } from '@loora/rpc/client'

export type AdminOverview = Awaited<ReturnType<typeof orpc.admin.overview>>
export type AdminUser = Awaited<ReturnType<typeof orpc.admin.listUsers>>[number]
export type AdminDesign = Awaited<ReturnType<typeof orpc.admin.listDesigns>>[number]
export type AdminUserFilter = 'all' | 'pending' | 'admins' | 'paid'
export type AdminFlag = Awaited<ReturnType<typeof orpc.admin.flags.list>>[number]
export type AdminFlagEvaluation = Awaited<ReturnType<typeof orpc.admin.flags.evaluate>>
