import { decrypt, encrypt, generatePassword, hashToken } from '../../src/common/crypto';
import { base32Decode, base32Encode, hotp, verifyTotp } from '../../src/common/totp';
import { zDomainName, zLocalPart, zPassword } from '../../src/common/zod';
import { attachmentRisk, sanitizeEmailHtml } from '../../src/modules/webmail/sanitize';

const s = (html: string, allowRemoteImages = false) => sanitizeEmailHtml(html, { allowRemoteImages, cidMap: { 'logo@x': '/api/v1/webmail/m/blobs/b1?inline=1' } });

describe('email HTML sanitiser', () => {
  it('removes scripts, event handlers, forms, iframes and javascript: URLs', () => {
    const r = s('<p onclick="x()">Hi</p><script>alert(1)</script><iframe src="https://e.vil"></iframe><form action="https://e.vil"><input name=p></form><a href="javascript:alert(1)">x</a><style>body{}</style><object data="x"></object>');
    expect(r.html).not.toMatch(/script|onclick|iframe|<form|<input|javascript:|<style|<object/i);
    expect(r.html).toContain('<p>Hi</p>');
  });
  it('blocks remote images unless allowed, keeps safe inline images', () => {
    const r = s('<img src="https://t.example/p.gif"><img src="cid:logo@x"><img src="data:image/png;base64,AAAA"><img src="data:text/html;base64,AAAA">');
    expect(r.blockedRemoteImages).toBe(1);
    expect(r.html).not.toContain('t.example');
    expect(r.html).toContain('/api/v1/webmail/m/blobs/b1?inline=1');
    expect(r.html).toContain('data:image/png');
    expect(r.html).not.toContain('data:text/html');
    expect(s('<img src="https://t.example/p.gif">', true).html).toContain('t.example');
  });
  it('forces links to open safely and flags deceptive link text', () => {
    const r = s('<a href="https://evil.example/login">https://mybank.com</a> <a href="https://docs.example.com/a">docs.example.com</a>');
    expect(r.html).toContain('rel="noopener noreferrer nofollow"');
    expect(r.html).toContain('target="_blank"');
    expect(r.suspiciousLinks).toBe(1);
    expect(r.html).toContain('data-jimail-warning="Link text shows mybank.com but opens evil.example"');
  });
  it('drops dangerous CSS values', () => {
    const r = s('<p style="color: red; background: url(javascript:alert(1)); position: fixed">x</p>');
    expect(r.html).toContain('color:red');
    expect(r.html).not.toMatch(/position|javascript/);
  });
  it('flags dangerous attachments', () => {
    expect(attachmentRisk('invoice.pdf.exe', 'application/octet-stream')).toBe('dangerous');
    expect(attachmentRisk('macro.docm', 'application/vnd')).toBe('dangerous');
    expect(attachmentRisk('photo.jpg', 'image/jpeg')).toBe('safe');
  });
});

describe('TOTP (RFC 6238)', () => {
  // RFC 4226 Appendix D test vectors, secret "12345678901234567890"
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it('matches RFC 4226 HOTP vectors', () => {
    expect([0, 1, 2, 3, 9].map((c) => hotp(secret, c))).toEqual(['755224', '287082', '359152', '969429', '520489']);
  });
  it('base32 round-trips', () => {
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
  });
  it('accepts ±1 step and rejects others', () => {
    const t = 1_700_000_000_000;
    const code = hotp(secret, Math.floor(t / 30000));
    expect(verifyTotp(secret, code, t + 30000)).toBe(true);
    expect(verifyTotp(secret, code, t + 90000)).toBe(false);
    expect(verifyTotp(secret, 'abcdef', t)).toBe(false);
  });
});

describe('crypto helpers', () => {
  it('encrypts with authentication (tampering is detected)', () => {
    const c = encrypt('API_secret_value');
    expect(c).not.toContain('API_secret_value');
    expect(decrypt(c)).toBe('API_secret_value');
    const parts = c.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decrypt(parts.join('.'))).toThrow();
  });
  it('uses a random IV per encryption', () => {
    expect(encrypt('x')).not.toBe(encrypt('x'));
  });
  it('hashes tokens deterministically with the app secret', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });
  it('generates passwords that satisfy the password policy', () => {
    for (let i = 0; i < 50; i++) expect(zPassword.safeParse(generatePassword()).success).toBe(true);
  });
});

describe('input validation', () => {
  it('normalises and validates domain names', () => {
    expect(zDomainName.parse(' Example.COM. ')).toBe('example.com');
    for (const bad of ['localhost', '-bad.com', 'a..b.com', 'exa mple.com', 'x.c', 'http://x.com']) expect(zDomainName.safeParse(bad).success).toBe(false);
  });
  it('validates mailbox local parts', () => {
    expect(zLocalPart.parse('John.Doe')).toBe('john.doe');
    for (const bad of ['.john', 'john.', 'jo..hn', 'jo hn', 'a@b', '']) expect(zLocalPart.safeParse(bad).success).toBe(false);
  });
});
