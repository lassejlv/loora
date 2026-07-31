# `@loora/email`

Server-only transactional email for Loora, rendered with Email SDK and sent
through Cloudflare Email Sending.

## Configuration

Enable Email Sending for the Loora domain in Cloudflare, then set:

```env
CLOUDFLARE_EMAIL_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=
EMAIL_FROM="Loora <hello@loora.design>"
EMAIL_REPLY_TO=support@loora.design
```

The API token only needs Cloudflare's Email Sending permission.
`EMAIL_REPLY_TO` is optional.

## Local checks

Validate the adapter configuration without sending:

```bash
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_EMAIL_API_TOKEN" \
CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
bunx email-sdk doctor --adapter cloudflare
```

Validate a message without making a provider request:

```bash
bunx email-sdk send \
  --adapter cloudflare \
  --api-token "$CLOUDFLARE_EMAIL_API_TOKEN" \
  --account-id "$CLOUDFLARE_ACCOUNT_ID" \
  --from "$EMAIL_FROM" \
  --to you@example.com \
  --subject "Loora email smoke test" \
  --text "Cloudflare email is configured." \
  --dry-run
```

Do not remove `--dry-run` without choosing and approving a real test recipient.
