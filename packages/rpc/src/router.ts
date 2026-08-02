/**
 * The oRPC surface. Every namespace lives in its own module beside this one, so
 * this file is only the assembly: what a client can call, on one screen.
 */
import {
  deleteDesign,
  getDesign,
  listDesigns,
  listDesignsSharedWithMe,
  saveDesign,
} from './designs'
import {
  getDesignShare,
  inviteDesignCollaborator,
  leaveDesignShare,
  revokeDesignCollaborator,
  setDesignCollaboratorRole,
  setDesignLinkAccess,
} from './share'
import {
  applyCanvasTransactions,
  createCanvasDesign,
  getCanvas,
  renameCanvasDesign,
} from './canvas-procedures'
import {
  applyDraft,
  closeDraft,
  compareDraft,
  createDraft,
  getDraft,
  listDrafts,
  proposeDraft,
  renameDraft,
  reopenDraft,
  saveDraft,
} from './branches'
import { createDesignHandoff } from './handoff-procedures'
import {
  commitCanvasVersion,
  commitVersion,
  compareCanvasVersion,
  compareVersion,
  importVersions,
  listVersions,
  restoreCanvasVersion,
} from './versions'
import {
  deleteAsset,
  listAssets,
  uploadAsset,
} from './assets'
import {
  bindDesignGithubRepository,
  clearDesignGithubRepository,
  disconnectGithub,
  getDesignGithubRepository,
  getGithubStatus,
  listGithubRepositories,
  refreshGithub,
} from './github-procedures'
import {
  listMcpSessions,
  revokeMcpSession,
} from './mcp-procedures'
import {
  acceptLegal,
  deleteAccount,
  getAuthConfig,
  getLegalConsent,
  getPreviewAccess,
  requestPreviewAccess,
} from './account'
import {
  createSubscriptionCheckout,
  getCurrentBilling,
  getCurrentMcpUsage,
  refreshCurrentBilling,
} from './billing-procedures'
import {
  adminOverview,
  approvePendingPreviewAccess,
  deleteUserAccount,
  listRecentDesigns,
  listUsersWithUsage,
  refreshUserBilling,
  resetUserMcpUsage,
  revokeDesignLinks,
  revokeUserMcpAccess,
  revokeUserSessions,
  setUserAdmin,
  setUserMcpLimit,
  setUserPreviewAccess,
} from './admin'
import {
  getPreferences,
  savePreferences,
} from './preferences'

export type { ORPCContext } from './procedures'

export const appRouter = {
  auth: {
    config: getAuthConfig,
    legalConsent: getLegalConsent,
    acceptLegal,
    previewAccess: getPreviewAccess,
    requestPreviewAccess,
    deleteAccount,
  },
  preferences: {
    get: getPreferences,
    save: savePreferences,
  },
  billing: {
    status: getCurrentBilling,
    refresh: refreshCurrentBilling,
    checkout: createSubscriptionCheckout,
    mcpUsage: getCurrentMcpUsage,
  },
  design: {
    list: listDesigns,
    listShared: listDesignsSharedWithMe,
    get: getDesign,
    save: saveDesign,
    delete: deleteDesign,
  },
  share: {
    get: getDesignShare,
    setLinkAccess: setDesignLinkAccess,
    invite: inviteDesignCollaborator,
    setRole: setDesignCollaboratorRole,
    revoke: revokeDesignCollaborator,
    leave: leaveDesignShare,
  },
  canvas: {
    create: createCanvasDesign,
    get: getCanvas,
    rename: renameCanvasDesign,
    applyTransactions: applyCanvasTransactions,
  },
  draft: {
    list: listDrafts,
    create: createDraft,
    get: getDraft,
    save: saveDraft,
    rename: renameDraft,
    propose: proposeDraft,
    reopen: reopenDraft,
    compare: compareDraft,
    apply: applyDraft,
    close: closeDraft,
  },
  handoff: {
    create: createDesignHandoff,
  },
  history: {
    list: listVersions,
    compare: compareVersion,
    import: importVersions,
    commit: commitVersion,
    commitCanvas: commitCanvasVersion,
    compareCanvas: compareCanvasVersion,
    restoreCanvas: restoreCanvasVersion,
  },
  asset: {
    list: listAssets,
    upload: uploadAsset,
    delete: deleteAsset,
  },
  github: {
    status: getGithubStatus,
    repositories: listGithubRepositories,
    refresh: refreshGithub,
    binding: getDesignGithubRepository,
    bind: bindDesignGithubRepository,
    clear: clearDesignGithubRepository,
    disconnect: disconnectGithub,
  },
  mcp: {
    sessions: listMcpSessions,
    revoke: revokeMcpSession,
  },
  admin: {
    overview: adminOverview,
    listUsers: listUsersWithUsage,
    setPreviewAccess: setUserPreviewAccess,
    approvePendingPreviewAccess,
    setAdmin: setUserAdmin,
    refreshBilling: refreshUserBilling,
    setMcpLimit: setUserMcpLimit,
    resetMcpUsage: resetUserMcpUsage,
    revokeSessions: revokeUserSessions,
    revokeMcpAccess: revokeUserMcpAccess,
    deleteUser: deleteUserAccount,
    listDesigns: listRecentDesigns,
    revokeDesignLinks,
  },
}
