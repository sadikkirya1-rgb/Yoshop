function normalizeEmailAddress(value = '') {
  return String(value || '').trim().toLowerCase();
}

export function isAppAdminRestrictedIdentity({ email = '', uid = '', configuredAdminEmails = [], masterAdminUid = null } = {}) {
  const normalizedEmail = normalizeEmailAddress(email);
  const emailList = Array.isArray(configuredAdminEmails)
    ? configuredAdminEmails.map((entry) => normalizeEmailAddress(entry)).filter(Boolean)
    : [];

  return Boolean(
    (uid && masterAdminUid && String(uid) === String(masterAdminUid)) ||
    normalizedEmail === 'sadikkirya@gmail.com' ||
    emailList.includes(normalizedEmail)
  );
}

export function getSubscriptionBucket({ userStatus = 'active', shopStatus = 'active', subscriptionExpires = null, now = new Date() } = {}) {
  const normalizedUserStatus = String(userStatus || 'active').trim().toLowerCase();
  const normalizedShopStatus = String(shopStatus || 'active').trim().toLowerCase();

  if (normalizedUserStatus === 'pending') return 'pending';
  if (normalizedShopStatus !== 'active') return 'suspended';

  if (!subscriptionExpires) {
    return 'active';
  }

  const expiryDate = new Date(subscriptionExpires);
  if (Number.isNaN(expiryDate.getTime())) return 'active';

  if (expiryDate < now) return 'expired';

  const remainingDays = (expiryDate - now) / (1000 * 60 * 60 * 24);
  if (remainingDays <= 14) return 'expiring-soon';

  return 'active';
}

export function getSubscriptionMeta({ userStatus = 'active', shopStatus = 'active', subscriptionExpires = null, now = new Date() } = {}) {
  const bucket = getSubscriptionBucket({ userStatus, shopStatus, subscriptionExpires, now });

  const labelMap = {
    active: 'Active',
    expired: 'Expired',
    'expiring-soon': 'Expiring Soon',
    pending: 'Pending',
    suspended: 'Suspended'
  };

  const classMap = {
    active: 'active',
    expired: 'deactivated',
    'expiring-soon': 'suspended',
    pending: 'suspended',
    suspended: 'suspended'
  };

  return {
    bucket,
    label: labelMap[bucket] || 'Active',
    className: classMap[bucket] || 'active'
  };
}
