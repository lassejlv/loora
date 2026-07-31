export {
  createEmailService,
  getEmailService,
  sendAccountVerificationEmail,
  sendPasswordResetEmail,
} from './service'
export type {
  AccountVerificationInput,
  EmailService,
  EmailServiceConfig,
  PasswordResetInput,
} from './service'
export {
  AccountVerificationEmail,
  type AccountVerificationEmailProps,
} from './templates/account-verification'
export { PasswordResetEmail, type PasswordResetEmailProps } from './templates/password-reset'
