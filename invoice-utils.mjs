function normalizeInvoiceNumber(invoiceNumber) {
  if (!invoiceNumber || typeof invoiceNumber !== 'string') return invoiceNumber;
  const trimmed = invoiceNumber.trim();
  return trimmed || null;
}

function findMatchingCustomer(customer, transaction) {
  if (!customer || !transaction) return null;
  const matchesCustomerId = customer?.id && transaction?.customerId && transaction.customerId === customer.id;
  const matchesCustomerName = transaction?.customerNameReal && customer?.name && transaction.customerNameReal === customer.name;
  const matchesLegacyCustomerName = transaction?.customerName && customer?.name && transaction.customerName === customer.name;
  return matchesCustomerId || matchesCustomerName || matchesLegacyCustomerName ? customer : null;
}

function getDateKey(dateValue) {
  if (!dateValue) return null;
  const parsedDate = new Date(dateValue);
  if (!Number.isFinite(parsedDate.getTime())) return null;
  return `${parsedDate.getFullYear()}-${String(parsedDate.getMonth() + 1).padStart(2, '0')}-${String(parsedDate.getDate()).padStart(2, '0')}`;
}

function getRelevantAdjustments(transaction = {}, customer = null) {
  const transactionAdjustments = Array.isArray(transaction.adjustments) ? transaction.adjustments.filter(Boolean) : [];
  if (transactionAdjustments.length > 0) {
    return transactionAdjustments;
  }

  const fallbackAdjustment = transaction?.lastAdjustment && typeof transaction.lastAdjustment === 'object'
    ? [transaction.lastAdjustment]
    : [];

  return fallbackAdjustment;
}

export function mergeTransactionsPreservingDuplicates(existingTransactions = [], incomingTransactions = []) {
  const merged = [...(Array.isArray(existingTransactions) ? existingTransactions : [])];
  const incoming = Array.isArray(incomingTransactions) ? incomingTransactions : [];

  incoming.forEach(transaction => {
    if (!transaction || !transaction.date) return;

    const existingIndex = merged.findIndex(existing => {
      if (!existing || !existing.date) return false;
      const sameId = Boolean(existing.id && transaction.id && existing.id === transaction.id);
      const sameInvoiceNumber = Boolean(
        existing.invoiceNumber && transaction.invoiceNumber &&
        normalizeInvoiceNumber(existing.invoiceNumber) &&
        normalizeInvoiceNumber(transaction.invoiceNumber) &&
        normalizeInvoiceNumber(existing.invoiceNumber) === normalizeInvoiceNumber(transaction.invoiceNumber)
      );
      return sameId || sameInvoiceNumber;
    });

    if (existingIndex >= 0) {
      merged[existingIndex] = { ...merged[existingIndex], ...transaction };
    } else {
      merged.push(transaction);
    }
  });

  return merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export function buildInvoiceListItems({ customers = [], transactions = [] } = {}) {
  const customerList = Array.isArray(customers) ? customers : [];
  const txList = Array.isArray(transactions) ? transactions : [];

  return txList
    .filter(tx => tx && (tx.invoiceNumber || tx.customerId || tx.customerNameReal || tx.customerName || tx.amountPaid !== undefined || tx.balance !== undefined))
    .map(transaction => {
      const customer = customerList.find(customer => findMatchingCustomer(customer, transaction)) || null;
      const total = Number(transaction.total || 0);
      const amountPaid = transaction.amountPaid !== undefined
        ? Number(transaction.amountPaid)
        : total;
      const balance = transaction.balance !== undefined
        ? Number(transaction.balance)
        : Math.min(0, amountPaid - total);

      const hasRealCustomer = Boolean(customer?.id || transaction.customerId);
      const shouldIncludeInvoice = hasRealCustomer && (balance <= 0 || transaction.amountPaid !== undefined);
      if (!shouldIncludeInvoice) return null;

      const mergedAdjustments = getRelevantAdjustments(transaction, customer);
      const lastAdjustment = mergedAdjustments.length > 0 ? mergedAdjustments[mergedAdjustments.length - 1] : (transaction.lastAdjustment || null);

      const adjustmentTotal = mergedAdjustments.reduce((sum, adj) => sum + (Number(adj?.amount) || 0), 0);
      const effectiveBalance = (() => {
        if (mergedAdjustments.length > 0) {
          return Math.min(0, amountPaid - total + adjustmentTotal);
        }

        const txnBalance = transaction.balance !== undefined ? Number(transaction.balance) : balance;
        const computedBalance = Number.isFinite(txnBalance) && txnBalance !== 0 ? txnBalance : (balance ?? 0);
        if (computedBalance !== 0) return computedBalance;
        return Math.min(0, amountPaid - total + adjustmentTotal);
      })();

      const normalizedBalance = Number.isFinite(effectiveBalance) ? effectiveBalance : 0;
      const previewData = {
        date: transaction.date || new Date().toISOString(),
        customerName: transaction.customerNameReal || transaction.customerName || customer?.name || 'Unknown Customer',
        customerNameReal: transaction.customerNameReal || transaction.customerName || customer?.name || 'Unknown Customer',
        customerContact: transaction.customerContact || transaction.contact || customer?.contact || customer?.phone || customer?.mobile || '',
        customerAddress: transaction.customerAddress || transaction.address || customer?.address || '',
        tableNo: transaction.tableNo || 'Customer Account',
        items: Array.isArray(transaction.items) && transaction.items.length > 0
          ? transaction.items
          : [{ name: 'Account Summary', qty: 1, price: total, notes: 'Transaction summary' }],
        total,
        subtotal: transaction.subtotal !== undefined ? Number(transaction.subtotal) : total,
        tax: transaction.tax !== undefined ? Number(transaction.tax) : 0,
        discount: transaction.discount || { amount: 0 },
        receiptType: 'customerDebtInvoice',
        paymentMethod: transaction.paymentMethod || 'On Account',
        customerId: transaction.customerId || customer?.id || null,
        note: balance < 0
          ? `Outstanding balance due for ${transaction.customerNameReal || transaction.customerName || customer?.name || 'customer account'}`
          : `Invoice paid in full for ${transaction.customerNameReal || transaction.customerName || customer?.name || 'customer account'}`,
        amountPaid,
        balance: normalizedBalance,
        lastAdjustment,
        adjustments: mergedAdjustments,
        invoiceNumber: normalizeInvoiceNumber(transaction.invoiceNumber)
          || normalizeInvoiceNumber(customer?.invoiceNumber)
          || normalizeInvoiceNumber(customer?.lastInvoiceNumber)
          || 'INV-UNKNOWN'
      };

      return {
        id: transaction.id || transaction.recordId || transaction.date || transaction.invoiceNumber,
        date: transaction.date || new Date().toISOString(),
        customer,
        customerName: previewData.customerName,
        invoiceNumber: previewData.invoiceNumber,
        total,
        amountPaid,
        balance: normalizedBalance,
        paymentMethod: transaction.paymentMethod || 'On Account',
        previewData,
        transaction
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}
