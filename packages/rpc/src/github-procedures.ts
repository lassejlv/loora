import { ORPCError } from '@orpc/server'
import {
  and,
  eq,
} from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@loora/db'
import {
  design,
  designGithubRepository,
} from '@loora/db/schema'
import {
  disconnectGitHub,
  getGitHubStatus,
  GitHubIntegrationError,
  listGitHubRepositories,
  syncGitHubInstallations,
} from '@loora/auth/github'
import { protectedProcedure } from './procedures'

/**
 * The `github` namespace: the connection and what a design is bound to.
 */

export function githubProcedureError(error: unknown): never {
  if (error instanceof GitHubIntegrationError) {
    if (error.code === 'RECONNECT_REQUIRED') {
      throw new ORPCError('UNAUTHORIZED', { message: error.message })
    }
    if (error.code === 'ACCESS_DENIED') {
      throw new ORPCError('FORBIDDEN', { message: error.message })
    }
    if (error.code === 'RATE_LIMITED') {
      throw new ORPCError('TOO_MANY_REQUESTS', { message: error.message })
    }
    throw new ORPCError('BAD_REQUEST', { message: error.message })
  }
  throw error
}

export const getGithubStatus = protectedProcedure.handler(async ({ context }) => {
  try {
    return await getGitHubStatus(context.user.id)
  } catch (error) {
    return githubProcedureError(error)
  }
})

export const listGithubRepositories = protectedProcedure.handler(async ({ context }) => {
  try {
    return await listGitHubRepositories(context.user.id)
  } catch (error) {
    return githubProcedureError(error)
  }
})

export const refreshGithub = protectedProcedure.handler(async ({ context }) => {
  try {
    await syncGitHubInstallations(context.user.id)
    return await listGitHubRepositories(context.user.id)
  } catch (error) {
    return githubProcedureError(error)
  }
})

export const getDesignGithubRepository = protectedProcedure
  .input(z.object({ designId: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const [repository] = await db
      .select({
        installationId: designGithubRepository.installationId,
        id: designGithubRepository.repositoryId,
        owner: designGithubRepository.owner,
        name: designGithubRepository.name,
        defaultBranch: designGithubRepository.defaultBranch,
      })
      .from(designGithubRepository)
      .where(
        and(
          eq(designGithubRepository.designId, input.designId),
          eq(designGithubRepository.userId, context.user.id),
        ),
      )
      .limit(1)
    return repository ? { ...repository, fullName: `${repository.owner}/${repository.name}` } : null
  })

export const bindDesignGithubRepository = protectedProcedure
  .input(
    z.object({
      designId: z.string().min(1).max(128),
      installationId: z.string().min(1).max(64),
      repositoryId: z.string().min(1).max(64),
    }),
  )
  .handler(async ({ context, input }) => {
    const [ownedDesign] = await db
      .select({ id: design.id })
      .from(design)
      .where(and(eq(design.id, input.designId), eq(design.userId, context.user.id)))
      .limit(1)
    if (!ownedDesign) throw new ORPCError('NOT_FOUND')

    try {
      const repositories = await listGitHubRepositories(context.user.id)
      const repository = repositories.find(
        (candidate) =>
          candidate.installationId === input.installationId &&
          candidate.id === input.repositoryId,
      )
      if (!repository) throw new ORPCError('FORBIDDEN', { message: 'Repository access was not granted.' })
      await db
        .insert(designGithubRepository)
        .values({
          designId: input.designId,
          userId: context.user.id,
          installationId: repository.installationId,
          repositoryId: repository.id,
          owner: repository.owner,
          name: repository.name,
          defaultBranch: repository.defaultBranch,
        })
        .onConflictDoUpdate({
          target: [designGithubRepository.designId, designGithubRepository.userId],
          set: {
            installationId: repository.installationId,
            repositoryId: repository.id,
            owner: repository.owner,
            name: repository.name,
            defaultBranch: repository.defaultBranch,
            updatedAt: new Date(),
          },
        })
      return {
        installationId: repository.installationId,
        id: repository.id,
        owner: repository.owner,
        name: repository.name,
        fullName: repository.fullName,
        defaultBranch: repository.defaultBranch,
      }
    } catch (error) {
      return githubProcedureError(error)
    }
  })

export const clearDesignGithubRepository = protectedProcedure
  .input(z.object({ designId: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const deleted = await db
      .delete(designGithubRepository)
      .where(
        and(
          eq(designGithubRepository.designId, input.designId),
          eq(designGithubRepository.userId, context.user.id),
        ),
      )
      .returning({ id: designGithubRepository.repositoryId })
    return { cleared: deleted.length > 0 }
  })

export const disconnectGithub = protectedProcedure.handler(async ({ context }) => {
  try {
    return await disconnectGitHub(context.user.id)
  } catch (error) {
    return githubProcedureError(error)
  }
})
