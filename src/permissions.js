/**
 * Four fixed roles rather than a permission matrix. At three to five staff a
 * matrix is mostly extra ways to misconfigure something, and these map onto
 * jobs people actually have.
 *
 * The boundaries that matter are money, guest documents and destruction — not
 * pages. A front-desk person needs a guest's phone number to call them about a
 * late arrival but has no business seeing the nightly rate, and those sit on
 * the same screen. So `money.view` is checked where amounts are rendered, not
 * only where routes are mounted.
 */

export const ACTIONS = [
  'bookings.view',
  'bookings.create',
  'bookings.edit',
  'bookings.delete',
  'payments.record',
  'payments.refund',
  'money.view',
  'records.view',
  'records.upload',
  'records.delete',
  'records.sensitive',
  'enquiries.view',
  'enquiries.edit',
  'reports.view',
  'setup.manage',
  'referrals.manage',
  'users.manage',
  'settings.manage'
];

export const ROLES = {
  owner: {
    label: 'Owner',
    hint: 'Everything, including staff accounts, refunds and settings.',
    can: ACTIONS
  },
  manager: {
    label: 'Manager',
    hint: 'Runs the place day to day. Takes payments, but cannot refund or delete.',
    can: [
      'bookings.view',
      'bookings.create',
      'bookings.edit',
      'payments.record',
      'money.view',
      'records.view',
      'records.upload',
      'records.sensitive',
      'enquiries.view',
      'enquiries.edit',
      'reports.view',
      'referrals.manage'
    ]
  },
  frontdesk: {
    label: 'Front desk',
    hint: 'Checks guests in and out and takes bookings. Does not see money.',
    can: [
      'bookings.view',
      'bookings.create',
      'bookings.edit',
      'records.view',
      'records.upload',
      'enquiries.view',
      'enquiries.edit'
    ]
  },
  viewer: {
    label: 'Viewer',
    hint: 'Read-only, for a bookkeeper. Sees figures, changes nothing.',
    can: ['bookings.view', 'money.view', 'records.view', 'enquiries.view', 'reports.view']
  }
};

export const ROLE_KEYS = Object.keys(ROLES);

export const can = (user, action) => Boolean(user && ROLES[user.role]?.can.includes(action));

/**
 * Renders an amount only to someone allowed to see money. Front desk gets a
 * placeholder rather than a blank, so the column still reads as deliberate.
 */
export const money = (user, formatted) => (can(user, 'money.view') ? formatted : '—');
