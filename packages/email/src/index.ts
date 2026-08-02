export {
  createEmailService,
  getEmailService,
  sendAccountVerificationEmail,
  sendDesignInvitationEmail,
  sendPasswordResetEmail,
  sendTwoFactorOTPEmail,
} from './service'
export type {
  AccountVerificationInput,
  DesignInvitationInput,
  EmailService,
  EmailServiceConfig,
  PasswordResetInput,
  TwoFactorOtpInput,
} from './service'
export {
  AccountVerificationEmail,
  type AccountVerificationEmailProps,
} from './templates/account-verification'
export {
  DesignInvitationEmail,
  type DesignInvitationEmailProps,
} from './templates/design-invitation'
export { PasswordResetEmail, type PasswordResetEmailProps } from './templates/password-reset'
export { TwoFactorOtpEmail, type TwoFactorOtpEmailProps } from './templates/two-factor-otp'
