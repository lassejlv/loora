# Terms of Service

Effective date: 30 July 2026

Last updated: 30 July 2026

These Terms of Service ("Terms") govern your access to and use of Loora, available at [https://loora.design](https://loora.design) and related services such as the remote MCP endpoint at [https://mcp.loora.design](https://mcp.loora.design) (together, the "Service"), operated by Lasse Vestergaard ("we", "us", or "our").

This document is a professional draft for owner and counsel review. It is not legal advice.

## 1. The Service

Loora is a canvas-based design tool. You can create and arrange structured UI on an infinite canvas, save designs with version history, work on branches/drafts, upload assets, export designs (for example HTML/CSS, React/TSX, JSON, or PNG), create time-limited handoff links, and optionally connect integrations (for example GitHub).

A remote MCP server may expose Loora canvas capabilities to compatible AI clients (for example Claude or Cursor) when you authorize them. There is no requirement to use MCP; the editor works on its own.

Features, plans, limits, and integrations may change over time. Some features may require preview access, an active plan, or a connected third-party account. Current plan details are described at [https://loora.design/pricing](https://loora.design/pricing) and in the product billing UI.

## 2. Eligibility And Authority

You must be at least 16 years old to use the Service.

If you use the Service on behalf of an organization, you represent that you have authority to bind that organization to these Terms, and "you" includes that organization.

## 3. Accounts

You may create an account with email and password or through supported sign-in providers (such as Google, when enabled).

You agree to provide accurate account information, keep your credentials secure, and notify us promptly of unauthorized use. You are responsible for activity under your account.

Access may be gated by preview access approval, acceptance of these Terms and the Privacy Policy, and/or an active plan, as configured for the Service. We may suspend or terminate accounts that violate these Terms, create risk, or remain unpaid where a paid plan is required.

You can delete your account from Loora settings. Deletion removes your production account data from the Service as described in our Privacy Policy, subject to records we must retain for legal or billing reasons.

## 4. Acceptable Use

You may use the Service only for lawful purposes and in accordance with these Terms. You agree not to:

- Use the Service for illegal, harmful, deceptive, harassing, or rights-infringing activity.
- Upload or generate content you do not have rights to use, or that violates applicable law.
- Attempt to disrupt, overload, reverse engineer (except where mandatory law permits), scrape, or bypass access controls, usage limits, rate limits (including MCP call limits), or security measures.
- Probe, scan, or attack the Service or other users' systems without authorization.
- Distribute malware, spam, or credential-theft material.
- Misuse MCP clients, handoffs, or other agent tooling to produce or distribute abusive, fraudulent, or infringing material, or to access designs or accounts you are not authorized to use.
- Share account credentials or allow others to use your account in a way that circumvents plan limits.
- Use the Service in a manner that infringes intellectual property, privacy, or other rights of third parties.

We may remove content, revoke handoff links, restrict features (including MCP access), or suspend accounts where we reasonably believe these rules are violated.

## 5. User Content And Data

You retain ownership of the designs, assets, prompts, tool inputs, and other materials you submit to the Service ("User Content").

You grant us a limited, worldwide, non-exclusive license to host, store, process, transmit, display, back up, and otherwise use User Content solely as needed to operate, secure, and improve the Service, including to provide sync, exports, handoff links you create, MCP access you authorize, and integrations you enable.

You are responsible for User Content and for ensuring you have the rights and permissions needed to submit it and to share it through handoffs, MCP clients, exports, or connected third-party services.

If you create a handoff link (or any other shareable link the product offers), content exposed by that link may be accessible to anyone with the link until the link expires or is revoked. Handoff tokens currently expire after 7 days by default. Do not share links to content you do not intend to make available. External AI clients you authorize via MCP may receive design context and related data needed to perform the tools you allow.

Exports are one-way. Exported code or assets are not automatically re-imported as an editable source of truth in the editor.

## 6. Plans, Payments, Trials, And Refunds

### Plans

Loora currently offers:

- **Free** — $0 per month, with plan limits described at [https://loora.design/pricing](https://loora.design/pricing) (for example design file count, asset storage, weekly MCP call limits, and version history depth).
- **Pro** — currently $20 per month, or $200 per year (two months free relative to the monthly rate), with higher or unlimited limits and additional capabilities as described on the pricing page and in the product.

A legacy **Studio** plan may still appear for existing subscribers and is treated as a legacy entitlement; it is not the primary offering for new customers.

Plan details, limits, and pricing are billed in USD (or as shown at checkout), may change from time to time, and control access to capacity (files, storage, history, branches, MCP calls, and any agent-related or image features enabled on that plan). Loora does not sell prepaid AI credits as a product path.

### Trials

We may offer a free trial for Pro from time to time. If a trial is available, it will be shown at checkout or in the billing UI, including its length and what happens when it ends. Unless canceled according to the billing portal rules, a trial that converts to a paid subscription renews under the selected plan.

### Billing and cancellation

Paid subscriptions renew for the selected period (monthly or yearly) unless canceled. You can manage, change, or cancel your subscription from Billing in Loora settings (or the Polar customer portal where linked). Cancellation takes effect according to the billing provider's and portal's rules (typically at the end of the then-current period when cancel-at-period-end is selected).

Payments are processed by our billing provider, **Polar** (Polar Software, Inc.), which acts as merchant of record for applicable transactions. Taxes (including VAT where applicable), invoices, payment methods, and customer portal features are handled through Polar and its payment partners (including Stripe) where applicable. Failed payments may result in loss of paid access until resolved.

By completing checkout you may also be subject to Polar's buyer or merchant terms and the payment processor's terms, as presented at checkout.

### Refunds

You may cancel anytime.

Except where mandatory consumer law requires otherwise, fees for a billing period already started are generally non-refundable, including when you cancel mid-period and retain access until period end. Refund eligibility for a specific charge may also depend on Polar's payment and refund processes.

Nothing in these Terms limits non-waivable consumer rights under Danish or EU law.

## 7. Third-Party Services

The Service relies on and may integrate with third-party providers, including (without limitation):

- Hosting and infrastructure (Railway), with primary application hosting in the EU (Netherlands / eu-west) as currently configured
- Database (Neon), with primary database hosting in the EU (Germany / eu-central) as currently configured
- Object storage for assets (Railway buckets powered by Tigris, S3-compatible)
- Realtime messaging (Redis on Railway)
- Authentication and identity (Better Auth in our stack; Google sign-in when enabled)
- Billing and merchant of record (Polar; payment processing via Polar's partners such as Stripe)
- Analytics (Databuddy)
- Optional integrations (GitHub)
- MCP clients and OAuth clients you authorize

Third-party services are governed by their own terms and privacy policies. We are not responsible for third-party services we do not control. Enabling an integration or authorizing an MCP client authorizes us to exchange data with that provider or client as needed to provide the connected feature.

## 8. Service Changes, Availability, And Support

We aim to keep the Service available and useful, but we do not guarantee uninterrupted or error-free operation, specific uptime, or particular support response times. Features may be added, changed, or discontinued.

Support is available at [support@loora.design](mailto:support@loora.design). We will use reasonable efforts to respond, without guaranteeing response times.

## 9. Intellectual Property

The Service—including software, branding, documentation, and UI not comprising your User Content—is owned by us or our licensors. These Terms do not transfer ownership of the Service to you.

Open-source components are licensed under their respective licenses (see the project LICENSE and dependency licenses).

If you provide feedback or suggestions about the Service, you grant us a perpetual, royalty-free license to use that feedback to improve the Service without obligation to you.

## 10. Privacy

Our collection and use of personal data is described in the [Privacy Policy](/privacy). By using the Service, you acknowledge that policy.

## 11. Termination

You may stop using the Service and cancel your subscription or delete your account at any time through the product controls or by contacting support.

We may suspend or terminate access if you breach these Terms, create legal or security risk, fail to pay, or if we discontinue the Service.

Upon account deletion, we delete your production account data from the Service as described in the Privacy Policy. Billing and tax records may be retained as required by law or by our payment provider. Shared links you created stop working when revoked, expired, or when underlying content is deleted. Cached or backup copies may persist for a limited period until rotated in the ordinary course of operations.

## 12. Disclaimers

To the fullest extent permitted by applicable law, the Service is provided "as is" and "as available", without warranties of any kind, whether express, implied, or statutory, including implied warranties of merchantability, fitness for a particular purpose, and non-infringement.

Output from external AI clients you connect via MCP, and any AI- or image-related features the Service offers, may be inaccurate, incomplete, or unsuitable for your purpose. You are responsible for reviewing and validating designs and code before use in production or with end users.

Some jurisdictions do not allow certain disclaimers. Where mandatory consumer protections apply (including under Danish or EU law), those protections remain unaffected.

## 13. Limitation Of Liability

To the fullest extent permitted by applicable law, we are not liable for indirect, incidental, special, consequential, or punitive damages, or for lost profits, lost revenue, lost data, or business interruption, arising out of or related to the Service or these Terms, whether based in contract, tort, or otherwise.

Our total aggregate liability arising out of or related to the Service or these Terms is limited to the greater of (a) the fees you paid to us for the Service in the twelve (12) months before the claim arose, or (b) EUR 50, except where mandatory law requires a higher minimum.

Nothing in these Terms excludes or limits liability that cannot be excluded or limited under Danish law, including liability for death or personal injury caused by negligence where such exclusion is not permitted, or other non-waivable rights.

## 14. Indemnity

You agree to indemnify and hold us harmless from claims, damages, losses, and expenses (including reasonable legal fees) arising out of your User Content, your misuse of the Service, MCP clients, or handoffs, your violation of these Terms, or your infringement of third-party rights, except to the extent caused by our willful misconduct or as limited by mandatory law.

## 15. Governing Law And Disputes

These Terms are governed by the laws of Denmark, without regard to conflict-of-law rules that would require another jurisdiction's law.

Courts of Denmark have jurisdiction over disputes arising out of or relating to these Terms or the Service, subject to any mandatory consumer venue rights that apply to you.

## 16. Changes To These Terms

We may update these Terms from time to time. We will post the updated Terms with a revised effective date. Material changes may also be communicated by email or in-product notice when appropriate. Continued use of the Service after the effective date of updated Terms constitutes acceptance of the changes, except where mandatory law requires additional consent.

## 17. Contact

Questions about these Terms: [support@loora.design](mailto:support@loora.design)
