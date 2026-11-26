import { expect, test } from '@playwright/test';
import { lastMailTo, setDns, tokenLink } from './helpers';

const run = Date.now().toString(36);
const owner = { name: 'Nora Owner', email: `nora-${run}@example.org`, password: 'NoraPassw0rd!x', org: `Northwind ${run}` };
const domain = `northwind-${run}.test`;
const shots = process.env.E2E_SHOTS;

test.describe.configure({ mode: 'serial' });

test('customer onboarding, domain setup, mailbox creation and webmail round-trip', async ({ page, browser }) => {
  // Register
  await page.goto('/register');
  await page.getByLabel('Your name').fill(owner.name);
  await page.getByLabel('Work email').fill(owner.email);
  await page.getByLabel('Company or organisation').fill(owner.org);
  await page.getByLabel('Password').fill(owner.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();

  // Verify email via the link that was "sent"
  const link = tokenLink(lastMailTo(owner.email).text);
  await page.goto(link.replace(/^https?:\/\/[^/]+/, ''));
  await expect(page.getByText('Your email address is verified')).toBeVisible();

  // Sign in → lands on the organisation dashboard
  await page.goto('/login');
  await page.getByLabel('Email address').fill(owner.email);
  await page.getByLabel('Password').fill(owner.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: owner.org })).toBeVisible();
  await expect(page.getByText('Connect your first domain')).toBeVisible();

  // Add domain
  await page.getByRole('link', { name: 'Add domain' }).first().click();
  await page.getByRole('button', { name: 'Add domain' }).click();
  await page.getByLabel('Domain name').fill(domain);
  await page.getByRole('dialog').getByRole('button', { name: 'Add domain' }).click();
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(domain) })).toBeVisible();

  // Ownership fails until the TXT record exists
  const txtValue = (await page.locator('code', { hasText: 'jimail-verification=' }).first().textContent())!.trim();
  await page.getByRole('button', { name: 'Verify ownership' }).click();
  await expect(page.getByText(/TXT record not found yet/).first()).toBeVisible();
  setDns(`_jimail.${domain}`, 'TXT', [txtValue]);
  await page.getByRole('button', { name: 'Verify ownership' }).click();
  await expect(page.getByText('Ownership verified. The domain is provisioned on the mail server.')).toBeVisible();
  await expect(page.getByText(/required records pass/)).toBeVisible();

  // Publish the mail records the UI shows, then re-check → ready
  const recs = await page.evaluate(async (d) => {
    const orgs = await (await fetch('/api/v1/orgs')).json();
    const list = await (await fetch(`/api/v1/orgs/${orgs[0].id}/domains`)).json();
    const dom = list.find((x: any) => x.name === d);
    return (await (await fetch(`/api/v1/orgs/${orgs[0].id}/domains/${dom.id}/records`)).json()).records;
  }, domain);
  const txt: Record<string, string[]> = {};
  for (const r of recs) {
    if (r.type === 'MX') setDns(r.host, 'MX', [{ exchange: r.value.replace(/\.$/, ''), priority: r.priority ?? 10 }]);
    if (r.type === 'TXT' && !r.host.startsWith('_jimail')) (txt[r.host] ??= []).push(r.value);
  }
  for (const [h, v] of Object.entries(txt)) setDns(h, 'TXT', v);
  await page.getByRole('button', { name: 'Re-check DNS' }).click();
  await expect(page.getByText('All required records pass. The domain is ready to send and receive mail.')).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/domain.png`, fullPage: true });

  // Create a mailbox with a generated password
  await page.getByRole('link', { name: 'Mailboxes' }).click();
  await page.getByRole('button', { name: 'New mailbox' }).click();
  const create = page.getByRole('dialog');
  await create.getByRole('textbox', { name: 'Address' }).fill('anna');
  await create.getByLabel('Display name').fill('Anna Andersen');
  await create.getByRole('button', { name: 'Create mailbox' }).click();
  await expect(page.getByText('Temporary password — shown once')).toBeVisible();
  const password = (await page.getByRole('dialog').locator('code').first().textContent())!.trim();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('cell', { name: new RegExp(`anna@${domain}`) })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/mailboxes.png` });

  // Mailbox user signs in to webmail in a separate browser context
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  const mail = await ctx.newPage();
  await mail.goto('/login');
  await mail.getByLabel('Email address').fill(`anna@${domain}`);
  await mail.getByLabel('Password').fill(password);
  await mail.getByRole('button', { name: 'Sign in' }).click();
  await expect(mail).toHaveURL(/\/mail\//);
  await expect(mail.getByRole('button', { name: 'Compose' }).first()).toBeVisible();

  // Compose to self with rich text, send, receive
  await mail.getByRole('button', { name: 'Compose' }).first().click();
  const dlg = mail.getByRole('dialog', { name: 'Compose message' });
  await dlg.getByLabel('To').fill(`anna@${domain}`);
  await dlg.getByLabel('To').press('Enter');
  await dlg.getByLabel('Subject').fill(`Welcome aboard ${run}`);
  await dlg.locator('.ProseMirror').click();
  await mail.keyboard.type('Hello from the JiMail end-to-end test.');
  await dlg.getByRole('button', { name: 'Send' }).click();
  await expect(mail.getByText('Message sent')).toBeVisible();

  await expect(async () => {
    await mail.getByRole('button', { name: 'Refresh' }).click();
    await expect(mail.getByText(`Welcome aboard ${run}`).first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await mail.getByText(`Welcome aboard ${run}`).first().click();
  const frame = mail.frameLocator('iframe[title="Message content"]');
  await expect(frame.getByText('Hello from the JiMail end-to-end test.')).toBeVisible();
  if (shots) await mail.screenshot({ path: `${shots}/webmail.png` });

  // Reply
  await mail.getByRole('button', { name: 'Reply', exact: true }).click();
  await mail.getByRole('dialog', { name: 'Compose message' }).getByRole('button', { name: 'Send' }).click();
  await expect(mail.getByText('Message sent')).toBeVisible();

  // Search
  await mail.getByLabel('Search mail').fill(`Welcome aboard ${run}`);
  await mail.getByLabel('Search mail').press('Enter');
  await expect(mail.getByText(/Search results \(\d+\)/)).toBeVisible();

  // Contacts
  await mail.getByRole('link', { name: 'Contacts' }).first().click();
  await mail.getByRole('button', { name: 'New contact' }).click();
  await mail.getByLabel('Name').fill('Ola Nordmann');
  await mail.getByLabel('Email').fill('ola@example.org');
  await mail.getByRole('button', { name: 'Save contact' }).click();
  await expect(mail.getByText('Ola Nordmann')).toBeVisible();
  await ctx.close();

  // Owner sees the activity in the audit log
  await page.getByRole('link', { name: 'Audit log' }).click();
  await expect(page.getByText('mailbox.created').first()).toBeVisible();
  await expect(page.getByText('domain.verified').first()).toBeVisible();
});
