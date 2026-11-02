import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLoyaltyRedemption, getLoyaltySummary, reconcileLoyaltyPayment, reconcileLoyaltyTransaction } from '../loyalty-utils.mjs';

test('loyalty summary computes points and membership tier from paid ledger totals', () => {
  const customer = {
    loyaltyLedger: [
      { pointsDelta: 120, paidSpendDelta: 120 },
      { pointsDelta: 380, paidSpendDelta: 380 }
    ]
  };

  assert.deepEqual(getLoyaltySummary(customer, { loyaltyEnabled: true, loyaltySilverSpendThreshold: 500, loyaltyGoldSpendThreshold: 1500 }), {
    enabled: true,
    pointsBalance: 500,
    lifetimePaidSpend: 500,
    tier: 'Silver'
  });
});

test('loyalty redemption is limited by balance, invoice due, and whole-currency increments', () => {
  const customer = { loyaltyLedger: [{ pointsDelta: 275, paidSpendDelta: 100 }] };
  const settings = { loyaltyEnabled: true, loyaltyPointsPerCurrency: 100 };

  assert.deepEqual(calculateLoyaltyRedemption(customer, 1000, 5, settings), {
    points: 200,
    currencyDiscount: 2,
    availablePoints: 275
  });
  assert.equal(calculateLoyaltyRedemption(customer, 200, 1, settings).currencyDiscount, 1);
});

test('transaction reconciliation is idempotent and adjusts awards when payments change', () => {
  const customer = { id: 'customer-1', loyaltyLedger: [] };
  const transaction = { id: 'sale-1', customerId: 'customer-1', total: 100, amountPaid: 40 };
  const settings = { loyaltyEnabled: true, loyaltyEarnPointsPerCurrency: 1 };

  assert.equal(reconcileLoyaltyTransaction(customer, transaction, settings).changed, true);
  assert.equal(reconcileLoyaltyTransaction(customer, transaction, settings).changed, false);
  transaction.amountPaid = 80;
  assert.equal(reconcileLoyaltyTransaction(customer, transaction, settings).pointsDelta, 40);
  assert.deepEqual(getLoyaltySummary(customer, settings), {
    enabled: true,
    pointsBalance: 80,
    lifetimePaidSpend: 80,
    tier: 'Bronze'
  });
});

test('redeemed points are debited from the ledger while paid spend remains the collected amount', () => {
  const customer = { id: 'customer-1', loyaltyLedger: [{ pointsDelta: 500, paidSpendDelta: 500 }] };
  const transaction = {
    id: 'sale-redeem',
    customerId: 'customer-1',
    total: 100,
    amountPaid: 90,
    loyaltyRedeemedPoints: 100
  };

  reconcileLoyaltyTransaction(customer, transaction, { loyaltyEnabled: true, loyaltyEarnPointsPerCurrency: 1 });

  assert.deepEqual(getLoyaltySummary(customer, { loyaltyEnabled: true }), {
    enabled: true,
    pointsBalance: 490,
    lifetimePaidSpend: 590,
    tier: 'Silver'
  });
});

test('loyalty does not award points for drafts, canceled sales, or another customer', () => {
  const customer = { id: 'customer-1', loyaltyLedger: [] };
  const settings = { loyaltyEnabled: true };

  const sale = { id: 'sale-cancel', customerId: 'customer-1', total: 50, amountPaid: 50 };
  assert.equal(reconcileLoyaltyTransaction(customer, { id: 'draft', customerId: 'customer-1', total: 50, amountPaid: 50, status: 'draft' }, settings).changed, false);
  assert.equal(reconcileLoyaltyTransaction(customer, { id: 'other', customerId: 'customer-2', total: 50, amountPaid: 50 }, settings).changed, false);
  reconcileLoyaltyTransaction(customer, sale, settings);
  sale.status = 'canceled';
  reconcileLoyaltyTransaction(customer, sale, settings);
  assert.equal(getLoyaltySummary(customer, settings).pointsBalance, 0);
  assert.equal(getLoyaltySummary(customer, settings).lifetimePaidSpend, 0);
});

test('standalone customer receipts earn points once and can be reversed', () => {
  const customer = { id: 'customer-1', loyaltyLedger: [] };
  const settings = { loyaltyEnabled: true, loyaltyEarnPointsPerCurrency: 2 };

  assert.equal(reconcileLoyaltyPayment(customer, 'receipt-1', 30, settings).pointsDelta, 60);
  assert.equal(reconcileLoyaltyPayment(customer, 'receipt-1', 30, settings).changed, false);
  assert.equal(reconcileLoyaltyPayment(customer, 'receipt-1', 0, settings).pointsDelta, -60);
  assert.equal(getLoyaltySummary(customer, settings).pointsBalance, 0);
});