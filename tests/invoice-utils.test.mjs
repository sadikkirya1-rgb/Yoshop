import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInvoiceListItems } from '../invoice-utils.mjs';

test('buildInvoiceListItems keeps separate debt transactions for the same customer', () => {
  const customer = {
    id: 'cust-1',
    name: 'Alice',
    balance: -150,
    lastTransactionDate: '2024-10-02T10:00:00.000Z'
  };

  const transactions = [
    {
      id: 'tx-1',
      date: '2024-10-01T10:00:00.000Z',
      customerId: 'cust-1',
      customerNameReal: 'Alice',
      invoiceNumber: 'INV-001',
      total: 100,
      amountPaid: 50
    },
    {
      id: 'tx-2',
      date: '2024-10-02T10:00:00.000Z',
      customerId: 'cust-1',
      customerNameReal: 'Alice',
      invoiceNumber: 'INV-002',
      total: 80,
      amountPaid: 0
    }
  ];

  const rows = buildInvoiceListItems({ customers: [customer], transactions });

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.invoiceNumber).sort(), ['INV-001', 'INV-002']);
  assert.equal(rows[0].customer.id, 'cust-1');
  assert.deepEqual(rows.map(row => row.balance).sort((a, b) => a - b), [-80, -50]);
});
