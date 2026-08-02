/**
 * Push every indexable URL to IndexNow.
 *
 * Bing and Google both retired the `?sitemap=` ping endpoint, so a sitemap is
 * now only ever pulled on the crawler's own schedule. IndexNow is the push
 * channel that replaced it: one POST, consumed by Bing, Yandex, Seznam, and
 * Naver from a single submission.
 *
 * Ownership is proved by a key file served at the site root. That file has to
 * be live before a submission is accepted, so deploy first, then run this.
 *
 *   bun run --cwd apps/web indexnow           # submit
 *   bun run --cwd apps/web indexnow --dry-run # print what would be sent
 */
import { absoluteUrl, SITE_URL } from '../src/lib/seo.ts'
import { sitemapEntries } from '../src/lib/site-map.ts'

const KEY = 'b887542ef3a5467e43ae707dc0350ec3'
const ENDPOINT = 'https://api.indexnow.org/indexnow'

const host = new URL(SITE_URL).host
const urls = sitemapEntries().map((entry) => absoluteUrl(entry.path))
const keyLocation = `${SITE_URL}/${KEY}.txt`
const dryRun = process.argv.includes('--dry-run')

console.log(`${urls.length} URLs, host ${host}, key at ${keyLocation}`)

if (dryRun) {
  for (const url of urls) console.log(`  ${url}`)
  process.exit(0)
}

// The key file is what proves ownership; a submission with an unreachable one
// is rejected as 403, which is a confusing way to find out about a bad deploy.
const keyCheck = await fetch(keyLocation)
const served = keyCheck.ok ? (await keyCheck.text()).trim() : ''
if (served !== KEY) {
  console.error(`Key file not serving the key (${keyCheck.status}). Deploy first.`)
  process.exit(1)
}

const response = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host, key: KEY, keyLocation, urlList: urls }),
})

const body = await response.text()
console.log(`${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`)

// 200 accepted, 202 accepted but the key is still being validated.
process.exit(response.status === 200 || response.status === 202 ? 0 : 1)
