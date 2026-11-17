import test from 'node:test';
import assert from 'node:assert/strict';
import { getCustomerCompanyName, groupCustomersByCompany, normalizeCompanyName } from '../customer-company-utils.mjs';

test('company names normalize case and whitespace without merging similar names', () => {
  assert.equal(normalizeCompanyName('  Acme   Health Ltd '), 'acme health ltd');
  assert.notEqual(normalizeCompanyName('Acme Health Ltd'), normalizeCompanyName('Acme Healthcare Ltd'));
  assert.notEqual(normalizeCompanyName('Acme Ltd'), normalizeCompanyName('Acme Limited'));
});

test('customer companies group by normalized exact name and preserve a display name', () => {
  const groups = groupCustomersByCompany([
    { id: 'one', companyName: '  Acme Health Ltd ' },
    { id: 'two', companyName: 'acme   health LTD' },
    { id: 'three', companyName: 'Acme Healthcare Ltd' },
    { id: 'four', companyName: '' }
  ]);

  assert.deepEqual(groups.map(group => [group.key, group.name, group.customers.map(customer => customer.id)]), [
    ['acme health ltd', 'Acme Health Ltd', ['one', 'two']],
    ['acme healthcare ltd', 'Acme Healthcare Ltd', ['three']],
    ['', '', ['four']]
  ]);
  assert.equal(getCustomerCompanyName({ companyName: '  Acme   Health Ltd  ' }), 'Acme Health Ltd');
});
