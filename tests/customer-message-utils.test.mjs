import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILT_IN_CUSTOMER_QUICK_MESSAGES, resolveCustomerQuickMessage } from '../customer-message-utils.mjs';

test('built-in customer quick messages retain all existing templates', () => {
  assert.deepEqual(BUILT_IN_CUSTOMER_QUICK_MESSAGES.map(message => message.id), [
    'order_received',
    'order_ready',
    'invoice_ready',
    'payment_received',
    'balance_due',
    'special_offer',
    'welcome'
  ]);
  assert.match(resolveCustomerQuickMessage('builtin:balance_due', [], { balance: 'UGX 1,000' }), /UGX 1,000/);
});

test('custom customer quick messages resolve supported placeholders', () => {
  const result = resolveCustomerQuickMessage('custom:reminder', [{
    id: 'reminder',
    text: 'Hello {{customerName}}, {{businessName}} records a balance of {{balance}}.'
  }], {
    customerName: 'Alex',
    businessName: 'YoShop',
    balance: 'UGX 500'
  });

  assert.equal(result, 'Hello Alex, YoShop records a balance of UGX 500.');
});

test('unknown customer quick messages resolve to an empty message', () => {
  assert.equal(resolveCustomerQuickMessage('custom:missing', []), '');
});
