import { parseZoneFile } from '../../src/modules/domains/dns';
import { categorize } from '../../src/modules/delivery/delivery.service';

describe('zone file parser', () => {
  const zone = `v1-ed25519-20261126._domainkey.acme.test. IN TXT "v=DKIM1; k=ed25519; h=sha256; p=jnap="
v1-rsa-20261126._domainkey.acme.test. IN TXT (
    "v=DKIM1; k=rsa; h=sha256; p=MIIB"
    "2u6B"
)
acme.test. IN TXT "v=spf1 mx -all"
acme.test. IN MX 10 mail.jimail.test.
_dmarc.acme.test. IN TXT "v=DMARC1; p=reject; rua=mailto:postmaster@acme.test" ; trailing comment
_submissions._tcp.acme.test. IN SRV 0 1 465 mail.jimail.test.
autoconfig.acme.test. IN CNAME mail.jimail.test.`;
  const recs = parseZoneFile(zone);
  it('keeps semicolons inside quoted TXT values', () => {
    expect(recs[0].value).toBe('v=DKIM1; k=ed25519; h=sha256; p=jnap=');
    expect(recs.find((r) => r.host === '_dmarc.acme.test')!.value).toBe('v=DMARC1; p=reject; rua=mailto:postmaster@acme.test');
  });
  it('joins multi-line, multi-string records', () => {
    expect(recs[1].value).toBe('v=DKIM1; k=rsa; h=sha256; p=MIIB2u6B');
  });
  it('parses MX, SRV and CNAME', () => {
    expect(recs.find((r) => r.type === 'MX')!.value).toBe('10 mail.jimail.test.');
    expect(recs.find((r) => r.type === 'SRV')!.value).toBe('0 1 465 mail.jimail.test.');
    expect(recs.find((r) => r.type === 'CNAME')!.host).toBe('autoconfig.acme.test');
    expect(recs).toHaveLength(7);
  });
});

describe('delivery event categorisation', () => {
  it('maps Stalwart events to delivery categories', () => {
    expect(categorize('delivery.delivered')).toEqual({ category: 'delivered', direction: 'OUTBOUND' });
    expect(categorize('delivery.dsn-perm-fail')?.category).toBe('bounce');
    expect(categorize('delivery.dsn-temp-fail')?.category).toBe('temp_fail');
    expect(categorize('message-ingest.spam')).toEqual({ category: 'spam', direction: 'INBOUND' });
    expect(categorize('smtp.connection-start')).toBeNull();
  });
});
