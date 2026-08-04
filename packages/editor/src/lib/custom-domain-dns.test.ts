import { describe, expect, it } from 'vitest'
import {
  dnsRecordsClipboardText,
  dnsZoneFile,
  providerDnsRecordName,
  type CustomDomainDnsRecord,
} from './custom-domain-dns'

const records: CustomDomainDnsRecord[] = [
  {
    type: 'CNAME',
    name: 'test.unploy.dev',
    value: 'cname.loora.design',
    required: true,
  },
  {
    type: 'TXT',
    name: '_acme-challenge.test.unploy.dev',
    value: 'validation-token',
    required: true,
  },
]

describe('custom-domain DNS instructions', () => {
  it('uses names relative to the DNS provider zone', () => {
    expect(providerDnsRecordName('test.unploy.dev', 'unploy.dev')).toBe('test')
    expect(
      providerDnsRecordName(
        '_acme-challenge.test.unploy.dev',
        'unploy.dev',
      ),
    ).toBe('_acme-challenge.test')
    expect(providerDnsRecordName('unploy.dev', 'unploy.dev')).toBe('@')
  })

  it('copies provider-ready host names instead of full names', () => {
    expect(dnsRecordsClipboardText(records, 'unploy.dev')).toBe(
      'CNAME  test  cname.loora.design\nTXT  _acme-challenge.test  validation-token',
    )
  })

  it('downloads a valid zone file without duplicated domain suffixes', () => {
    const file = dnsZoneFile(records, 'unploy.dev')
    expect(file).toContain('$ORIGIN unploy.dev.')
    expect(file).toContain('test\t3600\tIN\tCNAME\tcname.loora.design.')
    expect(file).toContain(
      '_acme-challenge.test\t3600\tIN\tTXT\t"validation-token"',
    )
    expect(file).not.toContain('test.unploy.dev.unploy.dev')
  })
})
