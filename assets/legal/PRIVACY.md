# Privacy Policy

Effective date: 30 July 2026

Last updated: 30 July 2026

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
- Account, billing, settings, and legal-consent surfaces
- Design documents, branches/drafts, version history, and canvas transactions
- Asset uploads and object storage
- Handoff links and related asset access
- The remote MCP authorization and resource server flows when you use them
- Optional integrations you connect (for example Google sign-in, GitHub)
- Product analytics as configured in the application

It does not govern third-party sites or services that have their own policies (for example Polar's customer portal, Stripe's payment pages, GitHub, or MCP clients such as Claude or Cursor).

## 3. Personal Data We Collect

### Data you provide

- Account profile: name, email, password (stored hashed by our auth system), profile image if provided
- Legal consent records (acceptance of Terms and Privacy)
- Designs, branches/drafts, version history, and related canvas metadata
- Uploaded assets (images and similar media you upload)
- User preferences (for example keyboard shortcuts and UI preferences)
- Preview-access requests
- Support messages you send to us (for example by email)
- Billing-related selections you make in the product (plan checkout), which are completed with our payment provider

### Data collected automatically

- Session data: session tokens, approximate IP address, and user agent associated with signed-in sessions
- MCP usage metering (for example weekly MCP call counts used to enforce plan limits)
- Canvas realtime / presence signals when the editor is open (for collaborative awareness features)
- Application and infrastructure logs created in the ordinary operation of the Service
- Browser local storage used by the app for UI state (for example theme, panel layout, local document cache)
- Analytics events via Databuddy (page usage, web vitals, errors, interactions, hash changes, attribute tracking, and outgoing-link events as configured in our SDK)

### Data from third parties

- Google (when you sign in with Google): basic profile identifiers needed for authentication
- Polar (billing): customer, subscription, order, entitlement, and refund-related billing state needed to grant plan access
- GitHub (when connected): account identifiers and encrypted tokens/installation metadata needed for repository features
- MCP OAuth clients you authorize: client registration and consent records

### Agent and MCP-related data

When you authorize an external MCP client, we process design context, tool inputs/outputs, and related metadata needed to fulfill the tools you allow that client to use. Those clients may also receive content you choose to expose through the tools. Handoff payloads include design data and token-scoped asset URLs for the lifetime of the handoff.

We do not intentionally collect special-category (sensitive) data. Please do not upload sensitive personal data unless necessary for your design work.

## 4. How We Use Personal Data

| Purpose | Examples of data | Legal basis (GDPR) |
| --- | --- | --- |
| Provide the Service (accounts, canvas, sync, handoff, MCP) | Account, designs, assets, sessions, preferences | Contract (Art. 6(1)(b)) |
| Authenticate and secure accounts | Credentials, sessions, IP/UA, security logs | Contract; legitimate interests in securing the Service (Art. 6(1)(f)) |
| Process subscriptions, trials (if offered), and refunds | Billing entitlement, orders, plan state | Contract; legal obligation for tax/accounting records where applicable (Art. 6(1)(c)) |
| Enforce plan limits (including MCP call limits) | Usage metering, plan entitlements | Contract |
| Operate optional integrations and MCP clients you enable | OAuth tokens, client consent, related metadata | Contract; legitimate interests in providing requested integrations |
| Product analytics and reliability | Databuddy events, error/performance signals | Legitimate interests in understanding and improving the Service (Art. 6(1)(f)). Databuddy is cookieless, privacy-first analytics (no tracking cookies) |
| Preview-access administration | Email, request timestamps, admin flags | Legitimate interests in gating early access; contract once access is granted |
| Record legal agreements | Terms/privacy acceptance flags and timestamps | Contract; legitimate interests in demonstrating agreement |
| Respond to support and legal requests | Contact contents, account identifiers | Legitimate interests; legal obligation where applicable |

We do not sell personal data. We do not use personal data for third-party advertising networks.

## 5. Cookies, Local Storage, And Tracking

### Essential / functional

- Authentication and session cookies managed by Better Auth / the app session layer
- Short-lived OAuth flow cookies for GitHub connection flows
- Local storage / similar browser storage for editor state, theme, access caches, and similar functional preferences

These are needed to sign in and run the product.

### Analytics (Databuddy)

We use [Databuddy](https://www.databuddy.cc) for product analytics. Databuddy is **cookieless**: it does not set tracking cookies and does not sell visitor data for advertising.

According to Databuddy's published materials:

- **Anonymous / aggregated analytics.** IP addresses are hashed (with a rotating salt) for visitor counting; coarse location (for example country/region/city) may be derived, then the raw IP is discarded. Databuddy does not identify named individuals.
- **No tracking cookies.** Analytics do not rely on advertising or tracking cookies. Optional local anonymous identifiers may use browser storage mechanisms other than cookies (for example localStorage) solely for anonymous continuity, not for cross-site advertising profiles.
- **What Loora enables.** Our app configures Databuddy with web vitals, errors, hash-change tracking, attribute tracking, outgoing links, and interactions.
- **Where Databuddy processes data.** Analytics databases are hosted in the EU (Hetzner, Germany per Databuddy's data policy), with additional partners for CDN/script delivery (Bunny.net), application hosting (Railway), dashboard hosting (Vercel), and ops tooling.
- **Retention.** Most analytics data is retained while the Databuddy project/account is active; performance metrics are deleted after one year. Deleting the Databuddy project/account removes analytics data from their systems per their policy.

Because Databuddy is cookieless and does not use tracking cookies for advertising, we do not show a separate cookie consent banner solely for Databuddy analytics. Essential cookies for sign-in and the product still apply as described above.

You can clear site data (including localStorage) in your browser settings, which removes local analytics identifiers as well as app UI state. Blocking essential cookies may prevent sign-in.

### Marketing cookies

We do not currently operate a separate marketing cookie stack in the application.

## 6. Sharing And Processors

We share personal data with service providers that process it on our behalf or as independent controllers where they provide their own service to you:

| Category | Provider (examples) | Role |
| --- | --- | --- |
| Application hosting | Railway | Hosts the web and MCP application (primary region: EU-West / Amsterdam) |
| Database | Neon | Stores application data in Postgres (primary region: EU-Central / Frankfurt) |
| Object storage | Railway buckets (S3-compatible), powered by [Tigris](https://www.tigrisdata.com/) | Stores uploaded assets. Tigris is a globally distributed object store; objects may be stored or cached outside a single EU region depending on access patterns |
| Realtime | Redis on Railway | Canvas realtime events, presence, and related pub/sub (same Railway project / EU-West deployment as the app) |
| Authentication | Better Auth (self-hosted in our stack); Google (sign-in when enabled) | Account/session; identity provider |
| Payments / merchant of record | Polar (Polar Software, Inc.) | Subscriptions, checkouts, customer portal, plan entitlements, tax handling as MoR |
| Payment processing (via Polar) | Stripe and other Polar payment partners | Card payments and related billing data under Polar's stack |
| Analytics | Databuddy | Privacy-oriented product analytics (see §5); analytics data stored under Databuddy's EU-oriented infrastructure per their data policy |
| Integrations | GitHub | Optional repository features |
| MCP clients you authorize | Client of your choice (for example Claude, Cursor) | Design tools and context you allow |
| Email / support | Your messages to support@loora.design | Support correspondence |

### Polar and payments

For paid plans, Polar acts as merchant of record for applicable transactions. Polar processes customer and billing data to complete checkout, collect tax where applicable, manage subscriptions, and grant access. Polar's own privacy policy, data processing addendum, and sub-processor list apply to Polar's processing. Polar's public materials indicate that several of its infrastructure and payment sub-processors (including Stripe) process data primarily in the United States and other locations outside the EEA. Card payment details are collected by the payment stack; Loora does not store full payment card numbers.

Providers only receive what is needed for their function. Handoff links intentionally make the linked design content available to anyone who has the link until expiry or revocation.

We may also disclose data if required by law, to protect rights and safety, or in connection with a business transfer (with appropriate notice where required).

## 7. International Transfers

### Primary application data (Loora-controlled infrastructure)

As currently configured:

- Application hosting runs on **Railway in EU-West (Amsterdam, Netherlands)**.
- **Redis** for realtime/presence runs on **Railway** in the same deployment footprint (EU-West).
- The primary database runs on **Neon in EU-Central (Frankfurt, Germany)**.
- **Uploaded assets** are stored in **Railway buckets**, which use **Tigris** ([tigrisdata.com](https://www.tigrisdata.com/)) as the underlying globally distributed S3-compatible object store. Asset objects may therefore be stored or served from locations outside a single EU region; we do not claim strict EU-only residency for all asset blobs.

### Analytics

Databuddy states that analytics databases are hosted in the EU (Hetzner, Germany) with additional subprocessors for CDN, app hosting, and dashboard (see §5). Coarse location may be derived from IP before the IP is discarded under Databuddy's described process.

### Billing and identity providers

Some providers process data outside the EEA, including:

- **Polar and its sub-processors** (including Stripe and other partners listed by Polar), which primarily process payment and customer billing data in the **United States** and other non-EEA locations. Polar's DPA incorporates Standard Contractual Clauses (SCCs) for applicable EEA/UK transfers.
- **Google** (when you use Google sign-in) and **GitHub** (when connected), which may process authentication and integration data in the United States and other countries.
- **MCP clients** you authorize, which process design context under that client's terms wherever that client operates.
- **Tigris** (via Railway buckets), which may store or replicate asset objects globally.

Where international transfers occur, we rely on appropriate safeguards available for the provider relationship and applicable law (for example EU Standard Contractual Clauses, adequacy decisions, or the provider's published transfer mechanisms). Contact us if you need current subprocessor transfer details we can share.

We do **not** claim that all personal data remains exclusively in the EU while Polar, Stripe, OAuth providers, Tigris-backed asset storage, or external MCP clients are in use.

## 8. Retention

- **Account and content data** (profile, designs, branches, assets, preferences, sessions, integration tokens, MCP usage rows cascading from your account, legal consent flags): retained while your account is active. When you delete your account in Settings, we delete production account data from the Service (including deleting stored asset objects where applicable). Related rows cascade with the account delete.
- **Billing / tax records**: subscription and payment records may be retained by us and/or Polar as required for accounting, tax, dispute, and legal obligations, even after account deletion.
- **Handoff tokens**: currently expire after 7 days by default (or sooner if revoked).
- **Backups and logs**: may persist for a limited period until ordinary rotation/expiry. We do not promise a specific backup purge day count.
- **Analytics (Databuddy)**: per Databuddy's published data policy, most analytics data is retained for as long as the Databuddy project/account remains active; performance metrics are deleted after one year. Removing the Databuddy project/account is the path to purge analytics from their systems. Loora does not currently offer an in-product control to wipe Databuddy history independently of that.

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

To exercise rights, email [support@loora.design](mailto:support@loora.design). You can also delete designs, assets, integrations, and your full account from the product where those controls exist.

Export: you can export designs from the product's export features. For other personal-data export requests, email [support@loora.design](mailto:support@loora.design) and we will help you obtain a reasonable copy of the account data we hold about you.

## 10. Security

We use reasonable technical and organizational measures appropriate to the nature of the Service, including access controls, authenticated APIs, encrypted transport in normal deployments, hashing of passwords by the auth stack, and encryption of certain third-party integration tokens at rest where implemented.

No method of transmission or storage is completely secure. We do not claim specific certifications (for example SOC 2 or ISO 27001) in this policy.

## 11. Children

The Service is not directed to children under 16. We do not knowingly collect personal data from children under 16. If you believe a child has provided personal data, contact us and we will take appropriate steps to delete it.

## 12. Agents, MCP, And Related Processing

Loora is designed so you can bring your own agent via MCP or handoff:

- When you authorize an MCP client, tool calls may read or mutate your designs using the same transaction path as the editor. The client receives the design context needed for those tools.
- Handoff links package design data and token-scoped asset URLs for temporary access by a recipient or agent workflow.
- Any image generation or other AI-related features enabled on a plan process only what is needed to fulfill the request you initiate, under the providers configured for that feature at the time.

We use these capabilities to provide the product features you request. We do not use your content to make solely automated legal or similarly significant decisions about you.

External AI clients and model providers are governed by their own terms and privacy practices. Do not send sensitive personal data to agents unless necessary.

If Loora later offers first-party model inference through a specific provider, we will update this policy to describe that provider and any material data-handling details.

## 13. Changes To This Policy

We may update this Privacy Policy from time to time. We will post the updated policy with a revised effective date. Material changes may also be communicated by email or in-product notice when appropriate.

## 14. Contact

Privacy and data-protection requests: [support@loora.design](mailto:support@loora.design)
