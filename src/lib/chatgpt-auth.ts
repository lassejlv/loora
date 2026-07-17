import { createChatGPTHandler } from '@opencoredev/loginwithchatgpt-server'

// Dev note: without LWC_SECRET the secret is ephemeral - restarts log everyone out.
export const chatgptAuth = createChatGPTHandler({
  secret: process.env.LWC_SECRET,
})
