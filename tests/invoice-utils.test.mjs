import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInvoiceListItems, mergeTransactionsPreservingDuplicates, deduplicateTransactions, getTransactionDuplicateKey, summarizeDebtInvoices, filterInvoiceRowsByStatus, calculateTotalExpenses } from '../invoice-utils.mjs';

test('filterInvoiceRowsByStatus separates paid and pending invoices', () => {
  const rows = [
    { balance: -50 },
    { balance: 0 },
    { balance: 25 }
  ];

  assert.deepEqual(filterInvoiceRowsByStatus(rows, 'pending').map(row => row.balance), [-50, 25]);
  assert.deepEqual(filterInvoiceRowsByStatus(rows, 'paid').map(row => row.balance), [0]);
  assert.deepEqual(filterInvoiceRowsByStatus(rows, 'all').map(row => row.balance), [-50, 0, 25]);
});

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

test('buildInvoiceListItems includes fully paid account invoices even without an invoice number', () => {
  const customer = {
    id: 'cust-2',
    name: 'Bob',
    balance: 0,
    lastTransactionDate: '2024-10-03T10:00:00.000Z'
  };

  const transactions = [
    {
      id: 'tx-3',
      date: '2024-10-03T10:00:00.000Z',
      customerId: 'cust-2',
      customerNameReal: 'Bob',
      total: 120,
      amountPaid: 120,
      paymentMethod: 'On Account'
    }
  ];

  const rows = buildInvoiceListItems({ customers: [customer], transactions });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].invoiceNumber, 'INV-UNKNOWN');
  assert.equal(rows[0].balance, 0);
});

test('calculateTotalExpenses sums expense records with flexible amount fields', () => {
  const expenses = [
    { amount: 15 },
    { total: 25 },
    { cost: 10 },
    { amount: '7.50' },
    { note: 'skip me' },
    null,
    { amount: -5 }
  ];

  assert.equal(calculateTotalExpenses(expenses), 52.5);
});

test('summarizeDebtInvoices matches pending invoice totals from transaction balances', () => {
  const customer = {
    id: 'cust-3',
    name: 'Carol',
    balance: 0,
    lastTransactionDate: '2024-10-05T10:00:00.000Z'
  };

  const transactions = [
    {
      id: 'tx-5',
      date: '2024-10-05T10:00:00.000Z',
      customerId: 'cust-3',
      customerNameReal: 'Carol',
      total: 120,
      amountPaid: 20,
      paymentMethod: 'On Account'
    },
    {
      id: 'tx-6',
      date: '2024-10-06T10:00:00.000Z',
      customerId: 'cust-3',
      customerNameReal: 'Carol',
      total: 80,
      amountPaid: 0,
      paymentMethod: 'On Account'
    }
  ];

  const summary = summarizeDebtInvoices({ customers: [customer], transactions });

  assert.equal(summary.pendingInvoices, 2);
  assert.equal(summary.outstandingDebt, 180);
});

test('buildInvoiceListItems excludes walk-in customer invoices', () => {
  const transactions = [
    {
      id: 'tx-4',
      date: '2024-10-04T10:00:00.000Z',
      customerNameReal: 'Walk-in Customer',
      total: 90,
      amountPaid: 0,
      paymentMethod: 'On Account'
    }
  ];

  const rows = buildInvoiceListItems({ customers: [], transactions });

  assert.equal(rows.length, 0);
});

test('buildInvoiceListItems excludes manually entered customer names without a system customer link', () => {
  const transactions = [
    {
      id: 'tx-5',
      date: '2024-10-05T10:00:00.000Z',
      customerNameReal: 'Jane',
      total: 60,
      amountPaid: 60,
      paymentMethod: 'On Account'
    }
  ];

  const rows = buildInvoiceListItems({ customers: [], transactions });

  assert.equal(rows.length, 0);
});

test('buildInvoiceListItems keeps a paid invoice number from the linked customer record', () => {
  const customer = {
    id: 'cust-3',
    name: 'Charlie',
    invoiceNumber: 'INV-0999',
    lastInvoiceNumber: 'INV-0999',
    balance: 0
  };

  const transactions = [
    {
      id: 'tx-6',
      date: '2024-10-06T10:00:00.000Z',
      customerId: 'cust-3',
      customerNameReal: 'Charlie',
      total: 80,
      amountPaid: 120,
      paymentMethod: 'Cash'
    }
  ];

  const rows = buildInvoiceListItems({ customers: [customer], transactions });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].invoiceNumber, 'INV-0999');
  assert.equal(rows[0].balance, 0);
});

test('buildInvoiceListItems uses only transaction adjustments for the matching invoice date', () => {
  const customer = {
    id: 'cust-4',
    name: 'Dana',
    adjustments: [{ amount: 20, method: 'Cash', date: '2024-10-08T10:00:00.000Z' }],
    balance: -20
  };

  const transactions = [
    {
      id: 'tx-7',
      date: '2024-10-08T10:00:00.000Z',
      customerId: 'cust-4',
      customerNameReal: 'Dana',
      total: 100,
      amountPaid: 80,
      adjustments: [{ amount: 10, method: 'Mobile Money', date: '2024-10-08T10:00:00.000Z' }]
    }
  ];

  const rows = buildInvoiceListItems({ customers: [customer], transactions });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].previewData.adjustments.length, 1);
  assert.equal(rows[0].previewData.lastAdjustment.amount, 10);
  assert.equal(rows[0].previewData.lastAdjustment.method, 'Mobile Money');
});

test('buildInvoiceListItems ignores customer adjustments on later invoice dates', () => {
  const customer = {
    id: 'cust-5',
    name: 'Eve',
    adjustments: [{ amount: 2000, method: 'Cash', date: '2024-10-09T10:00:00.000Z' }],
    balance: -2000
  };

  const transactions = [
    {
      id: 'tx-8',
      date: '2024-10-08T10:00:00.000Z',
      customerId: 'cust-5',
      customerNameReal: 'Eve',
      total: 10000,
      amountPaid: 8000,
      balance: -2000
    },
    {
      id: 'tx-9',
      date: '2024-10-10T10:00:00.000Z',
      customerId: 'cust-5',
      customerNameReal: 'Eve',
      total: 10000,
      amountPaid: 8000,
      balance: -2000
    }
  ];

  const rows = buildInvoiceListItems({ customers: [customer], transactions });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].previewData.adjustments.length, 0);
  assert.equal(rows[1].previewData.adjustments.length, 0);
});

test('buildInvoiceListItems ignores customer adjustments entirely for invoice previews', () => {
  const customer = {
    id: 'cust-6',
    name: 'Frank',
    adjustments: [{ amount: 25, method: 'Cash', date: '2024-07-01T15:56:41.000Z' }],
    balance: -25
  };

  const transactions = [
    {
      id: 'tx-10',
      date: '2024-07-01T15:56:41.000Z',
      customerId: 'cust-6',
      customerNameReal: 'Frank',
      total: 100,
      amountPaid: 75
    },
    {
      id: 'tx-11',
      date: '2024-07-08T08:44:22.000Z',
      customerId: 'cust-6',
      customerNameReal: 'Frank',
      total: 100,
      amountPaid: 75
    }
  ];

  const rows = buildInvoiceListItems({ customers: [customer], transactions });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].previewData.adjustments.length, 0);
  assert.equal(rows[1].previewData.adjustments.length, 0);
  assert.equal(rows[1].previewData.lastAdjustment, null);
});

test('mergeTransactionsPreservingDuplicates keeps separate transactions that share a date', () => {
  const existing = [
    {
      id: 'tx-existing',
      date: '2024-10-06T10:00:00.000Z',
      customerId: 'cust-1',
      customerNameReal: 'Alice',
      invoiceNumber: 'INV-001',
      total: 100,
      amountPaid: 0
    }
  ];

  const incoming = [
    {
      id: 'tx-new',
      date: '2024-10-06T10:00:00.000Z',
      customerId: 'cust-1',
      customerNameReal: 'Alice',
      invoiceNumber: 'INV-002',
      total: 80,
      amountPaid: 80
    }
  ];

  const merged = mergeTransactionsPreservingDuplicates(existing, incoming);

  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map(tx => tx.invoiceNumber), ['INV-001', 'INV-002']);
});

test('mergeTransactionsPreservingDuplicates collapses duplicate invoices already present in the archive', () => {
  const existing = [
    {
      id: 'tx-existing',
      date: '2024-10-06T10:00:00.000Z',
      customerId: 'cust-1',
      customerNameReal: 'Alice',
      invoiceNumber: 'INV-001',
      total: 100,
      amountPaid: 0
    },
    {
      id: 'tx-duplicate',
      date: '2024-10-06T10:00:00.000Z',
      customerId: 'cust-1',
      customerNameReal: 'Alice',
      invoiceNumber: 'INV-001',
      total: 100,
      amountPaid: 0
    }
  ];

  const merged = mergeTransactionsPreservingDuplicates(existing, []);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].invoiceNumber, 'INV-001');
});

test('mergeTransactionsPreservingDuplicates collapses same-sale refreshes without invoice ids', () => {
  const existing = [
    {
      id: 'tx-local',
      date: '2024-10-06T10:00:00.000Z',
      customerId: 'cust-1',
      customerNameReal: 'Alice',
      total: 100,
      amountPaid: 100,
      paymentMethod: 'Cash',
      items: [{ name: 'Coffee', qty: 1, price: 100, notes: '' }]
    }
  ];

  const incoming = [
    {
      date: '2024-10-06T10:00:00.000Z',
      customerId: 'cust-1',
      customerNameReal: 'Alice',
      total: 100,
      amountPaid: 100,
      paymentMethod: 'Cash',
      items: [{ name: 'Coffee', qty: 1, price: 100, notes: '' }]
    }
  ];

  const merged = mergeTransactionsPreservingDuplicates(existing, incoming);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].total, 100);
  assert.equal(merged[0].paymentMethod, 'Cash');
});

test('deduplicateTransactions collapses same-sale refreshes without invoice ids', () => {
  const transactions = [
    {
      id: 'tx-local',
      date: '2024-10-06T10:00:00.000Z',
      customerId: 'cust-1',
      customerNameReal: 'Alice',
      total: 100,
      amountPaid: 100,
      paymentMethod: 'Cash',
      items: [{ name: 'Coffee', qty: 1, price: 100, notes: '' }]
    },
    {
      date: '2024-10-06T10:00:00.000Z',
      customerId: 'cust-1',
      customerNameReal: 'Alice',
      total: 100,
      amountPaid: 100,
      paymentMethod: 'Cash',
      items: [{ name: 'Coffee', qty: 1, price: 100, notes: '' }]
    }
  ];

  const deduped = deduplicateTransactions(transactions);

  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].total, 100);
});

test('getTransactionDuplicateKey keeps separate sales with different items even when the rest matches', () => {
  const firstSale = {
    date: '2024-10-06T10:00:00.000Z',
    customerId: 'cust-1',
    customerNameReal: 'Alice',
    total: 100,
    amountPaid: 100,
    paymentMethod: 'Cash',
    items: [{ name: 'Coffee', qty: 1, price: 100, notes: '' }]
  };

  const secondSale = {
    date: '2024-10-06T10:00:00.000Z',
    customerId: 'cust-1',
    customerNameReal: 'Alice',
    total: 100,
    amountPaid: 100,
    paymentMethod: 'Cash',
    items: [{ name: 'Tea', qty: 1, price: 100, notes: '' }]
  };

  assert.notEqual(getTransactionDuplicateKey(firstSale), getTransactionDuplicateKey(secondSale));
});

test('deduplicateTransactions removes repeated sales while preserving the latest record', () => {
  const transactions = [
    {
      id: 'tx-a',
      date: '2024-10-06T10:00:00.000Z',
      customerId: 'cust-1',
      customerNameReal: 'Alice',
      invoiceNumber: 'INV-001',
      total: 100,
      amountPaid: 0,
      synced: false
    },
    {
      id: 'tx-b',
      date: '2024-10-06T10:00:00.000Z',
      customerId: 'cust-1',
      customerNameReal: 'Alice',
      invoiceNumber: 'INV-001',
      total: 100,
      amountPaid: 0,
      synced: true
    },
    {
      id: 'tx-c',
      date: '2024-10-07T10:00:00.000Z',
      customerId: 'cust-2',
      customerNameReal: 'Bob',
      invoiceNumber: 'INV-002',
      total: 80,
      amountPaid: 80,
      synced: true
    }
  ];

  const deduped = deduplicateTransactions(transactions);

  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].invoiceNumber, 'INV-002');
  assert.equal(deduped[0].duplicateCount, 0);
  assert.equal(deduped[1].invoiceNumber, 'INV-001');
  assert.equal(deduped[1].duplicateCount, 1);
});
