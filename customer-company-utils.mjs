export function normalizeCompanyName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function getCustomerCompanyName(customer) {
  return String(customer?.companyName || '').trim().replace(/\s+/g, ' ');
}

export function groupCustomersByCompany(customers = []) {
  const groups = new Map();
  (Array.isArray(customers) ? customers : []).forEach(customer => {
    const name = getCustomerCompanyName(customer);
    const key = normalizeCompanyName(name);
    const group = groups.get(key) || { key, name, customers: [] };
    if (!group.name && name) group.name = name;
    group.customers.push(customer);
    groups.set(key, group);
  });
  return [...groups.values()].sort((a, b) => {
    if (!a.key) return 1;
    if (!b.key) return -1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}
