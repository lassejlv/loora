import { z } from 'zod'
import {
  getGitHubRepositoryContextByName,
  GitHubIntegrationError,
  listGitHubRepositories,
  listRepositoryTree,
  readRepositoryFile,
  searchRepositoryCode,
  viewRepositoryImage,
  type GitHubRepositoryContext,
} from '@loora/auth/github'
import { createCanvasV2AgentTools } from './canvas-v2-tools'

export function createAgentBaseTools({
  userId,
  githubConnected,
  imageInputsEnabled,
}: {
  userId: string
  githubConnected: boolean
  imageInputsEnabled: boolean
}) {
  let repositoryToolCalls = 0
  let repositoryTextBytes = 0
  const repositoryContexts = new Map<string, GitHubRepositoryContext>()

  const resolveRepositoryContext = async (repository: string) => {
    const key = repository.trim().toLowerCase()
    const cached = repositoryContexts.get(key)
    if (cached) return cached
    const context = await getGitHubRepositoryContextByName(userId, repository)
    repositoryContexts.set(key, context)
    return context
  }

  const runRepositoryTool = async <T,>(
    operation: () => Promise<T>,
  ): Promise<T | { error: string; code?: string }> => {
    if (repositoryToolCalls >= 12) {
      return { error: 'Repository exploration limit reached for this turn.' }
    }
    repositoryToolCalls += 1
    try {
      const output = await operation()
      const record = output as Record<string, unknown>
      const textOutput = { ...record }
      if ('data' in textOutput) delete textOutput.data
      repositoryTextBytes += new TextEncoder().encode(JSON.stringify(textOutput)).length
      if (repositoryTextBytes > 1024 * 1024) {
        return { error: 'Repository text limit reached for this turn.' }
      }
      return output
    } catch (error) {
      if (error instanceof GitHubIntegrationError) {
        return { error: error.message, code: error.code }
      }
      return { error: 'The repository request failed.' }
    }
  }

  return {
    ...createCanvasV2AgentTools({ imageInputsEnabled }),
    askQuestion: {
      description:
        'Ask the user a question only when their request is genuinely ambiguous. Provide 2-4 short options.',
      inputSchema: z.object({
        question: z.string().min(1).max(1_000),
        options: z.array(z.string().min(1).max(200)).min(2).max(4),
      }),
    },
    ...(githubConnected
      ? {
          listGitHubRepositories: {
            description:
              'List the GitHub repositories this user has given Loora permission to read. Never invent repository names.',
            inputSchema: z.object({
              query: z.string().trim().max(100).optional(),
            }),
            execute: (input: { query?: string }) =>
              runRepositoryTool(async () => {
                const repositories = await listGitHubRepositories(userId)
                const query = input.query?.toLowerCase()
                const matches = query
                  ? repositories.filter((repository) =>
                      repository.fullName.toLowerCase().includes(query),
                    )
                  : repositories
                return {
                  repositories: matches.slice(0, 200).map((repository) => ({
                    fullName: repository.fullName,
                    private: repository.private,
                    archived: repository.archived,
                    defaultBranch: repository.defaultBranch,
                  })),
                  total: matches.length,
                  truncated: matches.length > 200,
                }
              }),
          },
          listRepositoryTree: {
            description:
              'List an accessible GitHub repository tree at a commit pinned for this turn.',
            inputSchema: z.object({
              repository: z.string().trim().min(1).max(200),
              pathPrefix: z.string().max(500).optional(),
              depth: z.number().int().min(1).max(6).optional(),
              includeGenerated: z.boolean().optional(),
            }),
            execute: (input: {
              repository: string
              pathPrefix?: string
              depth?: number
              includeGenerated?: boolean
            }) =>
              runRepositoryTool(async () =>
                listRepositoryTree(await resolveRepositoryContext(input.repository), input),
              ),
          },
          searchRepositoryCode: {
            description:
              'Search code only inside one accessible GitHub repository.',
            inputSchema: z.object({
              repository: z.string().trim().min(1).max(200),
              query: z.string().trim().min(1).max(200),
              pathPrefix: z.string().max(500).optional(),
              extension: z.string().max(16).optional(),
              limit: z.number().int().min(1).max(20).optional(),
            }),
            execute: (input: {
              repository: string
              query: string
              pathPrefix?: string
              extension?: string
              limit?: number
            }) =>
              runRepositoryTool(async () =>
                searchRepositoryCode(await resolveRepositoryContext(input.repository), input),
              ),
          },
          readRepositoryFile: {
            description:
              'Read a bounded range from one UTF-8 text file in an accessible repository.',
            inputSchema: z.object({
              repository: z.string().trim().min(1).max(200),
              path: z.string().min(1).max(500),
              startLine: z.number().int().min(1).optional(),
              endLine: z.number().int().min(1).optional(),
            }),
            execute: (input: {
              repository: string
              path: string
              startLine?: number
              endLine?: number
            }) =>
              runRepositoryTool(async () =>
                readRepositoryFile(await resolveRepositoryContext(input.repository), input),
              ),
          },
          ...(imageInputsEnabled
            ? {
                viewRepositoryImage: {
                  description:
                    'View a PNG, JPEG, WebP, or GIF from an accessible repository.',
                  inputSchema: z.object({
                    repository: z.string().trim().min(1).max(200),
                    path: z.string().min(1).max(500),
                  }),
                  execute: (input: { repository: string; path: string }) =>
                    runRepositoryTool(async () =>
                      viewRepositoryImage(
                        await resolveRepositoryContext(input.repository),
                        input,
                      ),
                    ),
                  toModelOutput: ({
                    output,
                  }: {
                    output: { data?: string; mediaType?: string; error?: string }
                  }) => {
                    if (output.error || !output.data || !output.mediaType) {
                      return {
                        type: 'text' as const,
                        value:
                          output.error ?? 'The repository image could not be read.',
                      }
                    }
                    return {
                      type: 'content' as const,
                      value: [
                        {
                          type: 'file' as const,
                          data: { type: 'data' as const, data: output.data },
                          mediaType: output.mediaType,
                        },
                      ],
                    }
                  },
                },
              }
            : {}),
        }
      : {}),
  }
}
