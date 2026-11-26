const ACTIONS: Record<string, string> = {
  'organization.created': 'created the organisation',
  'organization.updated': 'updated organisation settings',
  'domain.added': 'added a domain',
  'domain.verified': 'verified a domain',
  'domain.removed': 'removed a domain',
  'domain.catch_all_set': 'set a catch-all address',
  'mailbox.created': 'created a mailbox',
  'mailbox.updated': 'updated a mailbox',
  'mailbox.deleted': 'deleted a mailbox',
  'mailbox.suspended': 'suspended a mailbox',
  'mailbox.reactivated': 'reactivated a mailbox',
  'mailbox.password_reset': 'reset a mailbox password',
  'mailbox.forwarding_set': 'configured forwarding',
  'mailbox.bulk_import': 'imported mailboxes',
  'alias.created': 'added an alias',
  'alias.deleted': 'removed an alias',
  'member.invited': 'invited a team member',
  'member.joined': 'joined the organisation',
  'member.role_changed': 'changed a role',
  'member.removed': 'removed a member',
  'api_key.created': 'created an API key',
  'api_key.revoked': 'revoked an API key',
};

export function describeAction(a: { action: string; metadata?: any }) {
  const base = ACTIONS[a.action] ?? a.action.replace(/[._]/g, ' ');
  const detail = a.metadata?.address ?? a.metadata?.name ?? a.metadata?.email;
  return detail ? `${base}: ${detail}` : base;
}
