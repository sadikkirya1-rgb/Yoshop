export const DEFAULT_LOYALTY_SETTINGS = Object.freeze({
  loyaltyEnabled: false,
  loyaltyEarnPointsPerCurrency: 1,
  loyaltyPointsPerCurrency: 100,
  loyaltySilverSpendThreshold: 500,
  loyaltyGoldSpendThreshold: 1500
});

function finiteNonNegative(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function getLoyaltySummary(customer = {}, settings = {}) {
  const ledger = Array.isArray(customer.loyaltyLedger) ? customer.loyaltyLedger : [];
  const pointsBalance = ledger.reduce((sum, entry) => sum + (Number(entry?.pointsDelta) || 0), 0);
  const lifetimePaidSpend = ledger.reduce((sum, entry) => sum + (Number(entry?.paidSpendDelta) || 0), 0);
  const silverThreshold = finiteNonNegative(settings.loyaltySilverSpendThreshold, DEFAULT_LOYALTY_SETTINGS.loyaltySilverSpendThreshold);
  const goldThreshold = Math.max(
    silverThreshold,
    finiteNonNegative(settings.loyaltyGoldSpendThreshold, DEFAULT_LOYALTY_SETTINGS.loyaltyGoldSpendThreshold)
  );

  return {
    enabled: settings.loyaltyEnabled === true,
    pointsBalance: Math.max(0, Math.floor(pointsBalance)),
    lifetimePaidSpend: Math.max(0, lifetimePaidSpend),
    tier: settings.loyaltyEnabled !== true
      ? 'Not enrolled'
      : lifetimePaidSpend >= goldThreshold
        ? 'Gold'
        : lifetimePaidSpend >= silverThreshold
          ? 'Silver'
          : 'Bronze'
  };
}

export function calculateLoyaltyRedemption(customer = {}, requestedPoints = 0, amountDue = 0, settings = {}) {
  const pointsPerCurrency = Math.max(1, Math.floor(finiteNonNegative(
    settings.loyaltyPointsPerCurrency,
    DEFAULT_LOYALTY_SETTINGS.loyaltyPointsPerCurrency
  )));
  if (settings.loyaltyEnabled !== true) {
    return { points: 0, currencyDiscount: 0, availablePoints: getLoyaltySummary(customer, settings).pointsBalance };
  }

  const availablePoints = getLoyaltySummary(customer, settings).pointsBalance;
  const requested = Math.max(0, Math.floor(Number(requestedPoints) || 0));
  const due = finiteNonNegative(amountDue);
  const maxAffordablePoints = Math.floor(due * pointsPerCurrency);
  const points = Math.floor(Math.min(requested, availablePoints, maxAffordablePoints) / pointsPerCurrency) * pointsPerCurrency;

  return {
    points,
    currencyDiscount: points / pointsPerCurrency,
    availablePoints
  };
}

export function reconcileLoyaltyTransaction(customer = {}, transaction = {}, settings = {}) {
  if (!customer || !transaction || settings.loyaltyEnabled !== true) return { changed: false, customer };
  const customerId = customer.id || customer.recordId;
  const transactionCustomerId = transaction.customerId;
  const sourceId = String(transaction.id || transaction.recordId || transaction.invoiceNumber || '').trim();
  if (!customerId || !transactionCustomerId || String(customerId) !== String(transactionCustomerId) || !sourceId) {
    return { changed: false, customer };
  }

  const status = String(transaction.orderStatus || transaction.status || '').toLowerCase();
  const isEligible = status !== 'draft' && status !== 'canceled' && status !== 'cancelled';
  const total = finiteNonNegative(transaction.total ?? transaction.grandTotal ?? transaction.amount);
  const recordedPaid = transaction.amountPaid ?? transaction.totalPaid ?? transaction.paidAmount;
  const storedBalance = Number(transaction.balance);
  const paid = !isEligible
    ? 0
    : recordedPaid === undefined && Number.isFinite(storedBalance) && storedBalance < 0
      ? Math.max(0, Math.min(total, total + storedBalance))
      : Math.max(0, Math.min(total, finiteNonNegative(recordedPaid, total)));
  const earnRate = finiteNonNegative(settings.loyaltyEarnPointsPerCurrency, DEFAULT_LOYALTY_SETTINGS.loyaltyEarnPointsPerCurrency);
  const earnedPoints = Math.floor(paid * earnRate);
  const redemptionPoints = isEligible ? Math.max(0, Math.floor(Number(transaction.loyaltyRedeemedPoints) || 0)) : 0;
  const targetPoints = earnedPoints - redemptionPoints;
  const targetPaidSpend = paid;
  const ledger = Array.isArray(customer.loyaltyLedger) ? [...customer.loyaltyLedger] : [];
  const sourceEntries = ledger.filter(entry => String(entry?.sourceTransactionId || '') === sourceId);
  const currentPoints = sourceEntries.reduce((sum, entry) => sum + (Number(entry?.pointsDelta) || 0), 0);
  const currentPaidSpend = sourceEntries.reduce((sum, entry) => sum + (Number(entry?.paidSpendDelta) || 0), 0);
  const pointsDelta = targetPoints - currentPoints;
  const paidSpendDelta = targetPaidSpend - currentPaidSpend;

  if (pointsDelta === 0 && Math.abs(paidSpendDelta) < 0.000001) return { changed: false, customer };

  ledger.push({
    id: `loyalty-${sourceId}-${sourceEntries.length + 1}`,
    sourceTransactionId: sourceId,
    type: pointsDelta < 0 ? 'adjustment' : 'earn',
    pointsDelta,
    paidSpendDelta,
    createdAt: new Date().toISOString()
  });
  customer.loyaltyLedger = ledger;
  return { changed: true, customer, pointsDelta, paidSpendDelta };
}

export function reconcileLoyaltyPayment(customer = {}, paymentId = '', amount = 0, settings = {}) {
  if (!customer || settings.loyaltyEnabled !== true || !paymentId) return { changed: false, customer };
  const sourceId = `payment:${String(paymentId)}`;
  const paidAmount = finiteNonNegative(amount);
  const targetPoints = Math.floor(paidAmount * finiteNonNegative(
    settings.loyaltyEarnPointsPerCurrency,
    DEFAULT_LOYALTY_SETTINGS.loyaltyEarnPointsPerCurrency
  ));
  const ledger = Array.isArray(customer.loyaltyLedger) ? [...customer.loyaltyLedger] : [];
  const sourceEntries = ledger.filter(entry => String(entry?.sourceTransactionId || '') === sourceId);
  const currentPoints = sourceEntries.reduce((sum, entry) => sum + (Number(entry?.pointsDelta) || 0), 0);
  const currentPaidSpend = sourceEntries.reduce((sum, entry) => sum + (Number(entry?.paidSpendDelta) || 0), 0);
  const pointsDelta = targetPoints - currentPoints;
  const paidSpendDelta = paidAmount - currentPaidSpend;
  if (pointsDelta === 0 && Math.abs(paidSpendDelta) < 0.000001) return { changed: false, customer };

  ledger.push({
    id: `loyalty-${sourceId}-${sourceEntries.length + 1}`,
    sourceTransactionId: sourceId,
    type: pointsDelta < 0 ? 'adjustment' : 'earn',
    pointsDelta,
    paidSpendDelta,
    createdAt: new Date().toISOString()
  });
  customer.loyaltyLedger = ledger;
  return { changed: true, customer, pointsDelta, paidSpendDelta };
}