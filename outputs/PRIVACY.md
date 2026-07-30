# Privacy Policy

Effective date: 24 July 2026

This Privacy Policy explains how Lasse Vestergaard ("we", "us", or "our") collects, uses, shares, and protects personal data when you use Loora at [https://loora.design](https://loora.design) and related services such as [https://mcp.loora.design](https://mcp.loora.design) (the "Service").

This document is a professional draft for owner and counsel review. It is not legal advice.

## 1. Who We Are

- Product: Loora
- Controller / operator: Lasse Vestergaard
- Website: [https://loora.design](https://loora.design)
- Contact: [support@loora.design](mailto:support@loora.design)
- Establishment: Denmark

We have not appointed a separate DPO or EU representative. Contact us at the email above for privacy requests.

## 2. Scope

This policy covers:

- The Loora web application and APIs
- Account, billing, and settings surfaces
- AI agent chat and related processing
- Asset uploads and design storage
- Publish pages and handoff links
- The remote MCP authorization and resource server flows when you use them
- Optional integrations you connect (Google sign-in, GitHub, ChatGPT)

It does not govern third-party sites or services that have their own policies (for example Polar’s customer portal, GitHub, or OpenAI / ChatGPT).

## 3. Personal Data We Collect

### Data you provide

- Account profile: name, email, password (stored hashed by our auth system), profile image if provided
- Designs and version history (canvas elements and related metadata)
- Agent chat messages, titles, and related chat metadata
- Uploaded assets (images and similar media you upload)
- User preferences (for example keyboard shortcuts and custom agent system prompt)
- Preview-access requests
- Support messages you send to us (for example by email)
- Billing-related selections you make in the product (plan checkout, top-ups), which are completed with our payment provider

### Data collected automatically

- Session data: session tokens, approximate IP address, and user agent associated with signed-in sessions
- Usage and metering data for AI requests (model, token counts, cost/credit units, timestamps)
- Publish-link metadata and aggregate publish egress counters used for limits
- Application and infrastructure logs created in the ordinary operation of the Service
- Browser local storage used by the app for UI state (for example theme, panel layout, local document cache, model selection)
- Analytics events via Databuddy (page usage, web vitals, errors, interactions, and similar product analytics as configured)

### Data from third parties

- Google (when you sign in with Google): basic profile identifiers needed for authentication
- Polar (billing): customer, subscription, order, meter, and refund-related billing state needed to grant access and credits
- GitHub (when connected): account identifiers and encrypted tokens/installation metadata needed for repository features
- ChatGPT / Login with ChatGPT (when connected): session material needed to run models on your connected account
- MCP OAuth clients you authorize: client registration and consent records

### AI-related data

When you use Loora-managed AI or ChatGPT-backed models, we process prompts, design context, selection context, tool inputs/outputs, and—when vision features are used—canvas or element snapshots needed to fulfill the request. Outputs may be stored in your design chat history.

We do not intentionally collect special-category (sensitive) data. Please do not upload sensitive personal data unless necessary for your design work.

## 4. How We Use Personal Data

| Purpose | Examples of data | Legal basis (GDPR) |
| --- | --- | --- |
| Provide the Service (accounts, canvas, sync, publish, handoff, MCP) | Account, designs, assets, sessions, preferences | Contract (Art. 6(1)(b)) |
| Authenticate and secure accounts | Credentials, sessions, IP/UA, security logs | Contract; legitimate interests in securing the Service (Art. 6(1)(f)) |
| Process subscriptions, trials, credits, and refunds | Billing entitlement, orders, usage/credits | Contract; legal obligation for tax/accounting records where applicable (Art. 6(1)(c)) |
| Provide AI features | Prompts, design context, snapshots, model/usage metadata | Contract |
| Operate optional integrations you enable | OAuth tokens and related metadata | Contract; legitimate interests in providing requested integrations |
| Product analytics and reliability | Databuddy events, error/performance signals | Legitimate interests in understanding and improving the Service (Art. 6(1)(f)). TODO(confirm): whether counsel wants an explicit consent banner despite Databuddy’s cookie-less positioning |
| Preview-access administration | Email, request timestamps, admin flags | Legitimate interests in gating early access; contract once access is granted |
| Respond to support and legal requests | Contact contents, account identifiers | Legitimate interests; legal obligation where applicable |

We do not sell personal data. We do not use personal data for third-party advertising networks.

## 5. Cookies, Local Storage, And Tracking

### Essential / functional

- Authentication and session cookies managed by Better Auth / the app session layer
- Short-lived OAuth flow cookies for GitHub connection flows
- Local storage / similar browser storage for editor state, theme, access caches, and similar functional preferences

These are needed to sign in and run the product.

### Analytics

We use Databuddy for product analytics. According to Databuddy’s documentation, it is designed to operate without tracking cookies and to use anonymous / aggregated analytics (including localStorage for technical continuity rather than advertising cookies). Loora currently enables web vitals, error, hash-change, attribute, outgoing-link, and interaction tracking in the Databuddy SDK configuration.

TODO(confirm): final counsel position on ePrivacy / cookie-banner requirements for Databuddy and any other similar technologies in the production deployment.

### Marketing cookies

We do not currently operate a separate marketing cookie stack in the application.

You can clear cookies and site data in your browser settings. Blocking essential cookies may prevent sign-in.

## 6. Sharing And Processors

We share personal data with service providers that process it on our behalf or as independent controllers where they provide their own service to you:

| Category | Provider (examples) | Role |
| --- | --- | --- |
| Application hosting | Railway | Hosts the web/MCP application |
| Database | Neon | Stores application data in Postgres |
| Object storage | S3-compatible storage (when configured) | Stores uploaded assets |
| Authentication | Better Auth (self-hosted in our stack); Google (sign-in) | Account/session; identity provider |
| Payments | Polar | Subscriptions, checkouts, customer portal, meters, refunds |
| Analytics | Databuddy | Product analytics |
| AI (Loora-managed) | Wafer | Model inference for included AI credits |
| AI (user-connected) | OpenAI / ChatGPT | Inference on your connected ChatGPT account |
| Integrations | GitHub | Optional repository features |
| Email / support | Your messages to support@loora.design | Support correspondence |

Providers only receive what is needed for their function. Public publish/handoff links intentionally make the linked design content available to anyone who has the link.

We may also disclose data if required by law, to protect rights and safety, or in connection with a business transfer (with appropriate notice where required).

## 7. International Transfers

Some providers may process data in the EU/EEA and/or other countries.

TODO(confirm): exact primary hosting and subprocessors’ processing regions for Railway, S3-compatible asset storage, Wafer, Databuddy, Polar, and Google/GitHub/OpenAI, and the transfer safeguards relied on (for example EU Standard Contractual Clauses or adequacy decisions).

Where international transfers occur, we take steps appropriate to the provider relationship and applicable law. Contact us if you need current subprocessor transfer details.

## 8. Retention

- **Account and content data** (profile, designs, chats, assets, preferences, sessions, integration tokens, usage rows cascading from your account): retained while your account is active. When you delete your account in Settings, we delete production account data from the Service (including deleting stored asset objects where applicable). Related rows cascade with the account delete.
- **Billing / tax records**: subscription and payment records may be retained by us and/or Polar as required for accounting, tax, dispute, and legal obligations, even after account deletion.
- **Publish links**: currently expire after 12 hours (or sooner if deleted).
- **Handoff tokens**: currently expire after 7 days.
- **Backups and logs**: may persist for a limited period until ordinary rotation/expiry. We do not promise a specific backup purge day count.
- **Analytics**: retained according to Databuddy’s retention settings and practices. TODO(confirm): configured Databuddy retention period for the Loora project.

If you cancel a subscription but keep your account, your account content remains until you delete it or we close the account under the Terms.

## 9. Your Rights And Choices

If you are in the EEA/UK/Switzerland or otherwise protected by similar laws, you may have rights to:

- Access your personal data
- Rectify inaccurate data
- Erase data (including by deleting your account in Settings)
- Restrict or object to certain processing
- Data portability for data you provided
- Withdraw consent where processing is based on consent
- Lodge a complaint with a supervisory authority

In Denmark, the supervisory authority is Datatilsynet ([https://www.datatilsynet.dk](https://www.datatilsynet.dk)).

To exercise rights, email [support@loora.design](mailto:support@loora.design). You can also delete designs, chats, assets, integrations, and your full account from the product where those controls exist.

Export: you can export designs from the product’s export features. TODO(confirm): whether a dedicated full-account personal-data export endpoint should be offered beyond existing design/asset export tools.

## 10. Security

We use reasonable technical and organizational measures appropriate to the nature of the Service, including access controls, authenticated APIs, encrypted transport in normal deployments, hashing of passwords by the auth stack, and encryption of certain third-party integration tokens at rest where implemented.

No method of transmission or storage is completely secure. We do not claim specific certifications (for example SOC 2 or ISO 27001) in this policy.

## 11. Children

The Service is not directed to children under 16. We do not knowingly collect personal data from children under 16. If you believe a child has provided personal data, contact us and we will take appropriate steps to delete it.

## 12. AI Features

Loora processes your prompts, design context, and (when enabled for the model) visual snapshots to generate or edit designs.

- **Loora-managed models** are routed through our AI provider (currently Wafer). Provider credentials stay on our servers; they are not exposed to the browser.
- **ChatGPT-backed models** run through your connected ChatGPT account. Those requests are subject to OpenAI / ChatGPT terms and privacy practices in addition to this policy.
- Tool results and chat history are stored in your Loora design chats so you can continue work.
- We use AI to provide the product features you request. We do not use your content to make solely automated legal or similarly significant decisions about you.

TODO(confirm): whether Wafer and any upstream model hosts use customer content for training, and what retention they apply—do not assume “no training” until verified in provider terms/DPA.

## 13. Changes To This Policy

We may update this Privacy Policy from time to time. We will post the updated policy with a revised effective date. Material changes may also be communicated by email or in-product notice when appropriate.

## 14. Contact

Privacy and data-protection requests: [support@loora.design](mailto:support@loora.design)
