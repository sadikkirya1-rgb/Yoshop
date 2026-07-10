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

function getTransactionItemsSignature(transaction = {}) {
  const items = Array.isArray(transaction?.items) ? transaction.items : [];
  const normalizedItems = items
    .filter(Boolean)
    .map(item => {
      const name = typeof item?.name === 'string' ? item.name.trim().toLowerCase() : '';
      const qty = Number(item?.qty || 0);
      const price = Number(item?.price || item?.unitPrice || 0);
      const notes = typeof item?.notes === 'string' ? item.notes.trim().toLowerCase() : '';
      return `${name}|${qty}|${price}|${notes}`;
    })
    .sort()
    .join('~');

  return normalizedItems;
}

function getTransactionFallbackKey(transaction = {}) {
  const date = transaction.date;
  const total = Number(transaction.total || 0);
  const customer = transaction.customerId || transaction.customerNameReal || transaction.customerName || '';
  const amountPaid = Number(transaction.amountPaid || transaction.amount || 0);
  const paymentMethod = typeof transaction.paymentMethod === 'string' ? transaction.paymentMethod.trim().toLowerCase() : '';
  const tableNo = typeof transaction.tableNo === 'string' ? transaction.tableNo.trim().toLowerCase() : '';
  const itemsSignature = getTransactionItemsSignature(transaction);

  if (date && customer && Number.isFinite(total)) {
    return `fallback:${String(date)}|${String(customer)}|${String(total)}|${String(amountPaid)}|${paymentMethod}|${tableNo}|${itemsSignature}`;
  }

  return '';
}

export function getTransactionDuplicateKey(transaction = {}) {
  if (!transaction || typeof transaction !== 'object') return '';

  const invoiceKey = normalizeInvoiceNumber(transaction.invoiceNumber);
  if (invoiceKey) return `invoice:${invoiceKey}`;

  const id = transaction.id || transaction.recordId || transaction.transactionId;
  if (id) return `id:${String(id)}`;

  return getTransactionFallbackKey(transaction);
}

function getTransactionMatchKeys(transaction = {}) {
  if (!transaction || typeof transaction !== 'object') return [];

  const keys = [];
  const invoiceKey = normalizeInvoiceNumber(transaction.invoiceNumber);
  if (invoiceKey) keys.push(`invoice:${invoiceKey}`);

  const id = transaction.id || transaction.recordId || transaction.transactionId;
  if (id) keys.push(`id:${String(id)}`);

  const fallbackKey = getTransactionFallbackKey(transaction);
  if (fallbackKey) keys.push(fallbackKey);

  return keys;
}

export function deduplicateTransactions(transactions = []) {
  const source = Array.isArray(transactions) ? transactions : [];
  const deduped = [];

  source.forEach(transaction => {
    if (!transaction || typeof transaction !== 'object') return;

    const matchKeys = getTransactionMatchKeys(transaction);
    const existingIndex = matchKeys.length > 0
      ? deduped.findIndex(existing => {
          if (!existing || typeof existing !== 'object') return false;
          const existingKeys = getTransactionMatchKeys(existing);
          return matchKeys.some(key => existingKeys.includes(key));
        })
      : -1;

    if (existingIndex < 0) {
      deduped.push({ ...transaction, duplicateCount: 0 });
      return;
    }

    const currentRecord = deduped[existingIndex];
    const currentVersion = Number(transaction.version || 0);
    const existingVersion = Number(currentRecord.version || 0);
    const currentTime = Number(new Date(transaction.updatedAt || transaction.date || 0).getTime());
    const existingTime = Number(new Date(currentRecord.updatedAt || currentRecord.date || 0).getTime());
    const shouldReplace = currentVersion > existingVersion || (currentVersion === existingVersion && currentTime >= existingTime);
    const mergedRecord = shouldReplace ? { ...currentRecord, ...transaction } : { ...transaction, ...currentRecord };
    mergedRecord.duplicateCount = (currentRecord.duplicateCount || 0) + 1;
    deduped[existingIndex] = mergedRecord;
  });

  return deduped.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export function mergeTransactionsPreservingDuplicates(existingTransactions = [], incomingTransactions = []) {
  const merged = [];
  const allTransactions = [
    ...(Array.isArray(existingTransactions) ? existingTransactions : []),
    ...(Array.isArray(incomingTransactions) ? incomingTransactions : [])
  ];

  allTransactions.forEach(transaction => {
    if (!transaction || !transaction.date) return;

    const transactionMatchKeys = getTransactionMatchKeys(transaction);
    const existingIndex = merged.findIndex(existing => {
      if (!existing || !existing.date) return false;

      const existingMatchKeys = getTransactionMatchKeys(existing);
      const hasSharedKey = transactionMatchKeys.some(key => existingMatchKeys.includes(key));
      if (hasSharedKey) {
        return true;
      }

      const sameId = Boolean(existing.id && transaction.id && existing.id === transaction.id);
      const sameInvoiceNumber = Boolean(
        normalizeInvoiceNumber(existing.invoiceNumber) &&
        normalizeInvoiceNumber(transaction.invoiceNumber) &&
        normalizeInvoiceNumber(existing.invoiceNumber) === normalizeInvoiceNumber(transaction.invoiceNumber)
      );
      return sameId || sameInvoiceNumber;
    });

    if (existingIndex >= 0) {
      const existingRecord = merged[existingIndex];
      const currentVersion = Number(transaction.version || 0);
      const existingVersion = Number(existingRecord.version || 0);
      const currentTime = Number(new Date(transaction.updatedAt || transaction.date || 0).getTime());
      const existingTime = Number(new Date(existingRecord.updatedAt || existingRecord.date || 0).getTime());
      const shouldReplace = currentVersion > existingVersion || (currentVersion === existingVersion && currentTime >= existingTime);

      merged[existingIndex] = shouldReplace
        ? { ...existingRecord, ...transaction }
        : { ...transaction, ...existingRecord };
    } else {
      merged.push(transaction);
    }
  });

  return deduplicateTransactions(merged);
}

export function filterInvoiceRowsByStatus(rows = [], status = 'all') {
  const invoiceRows = Array.isArray(rows) ? rows : [];
  const normalizedStatus = String(status || 'all').toLowerCase();

  if (normalizedStatus === 'pending') {
    return invoiceRows.filter(row => Number(row?.balance || 0) !== 0);
  }

  if (normalizedStatus === 'paid') {
    return invoiceRows.filter(row => Number(row?.balance || 0) === 0);
  }

  return invoiceRows;
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

export function summarizeDebtInvoices({ customers = [], transactions = [] } = {}) {
  const invoiceRows = buildInvoiceListItems({ customers, transactions });
  const outstandingDebt = invoiceRows.reduce((sum, row) => {
    const balance = Number(row?.balance || 0);
    return sum + (balance < 0 ? Math.abs(balance) : 0);
  }, 0);
  const pendingInvoices = invoiceRows.filter(row => (Number(row?.balance || 0)) < 0).length;

  return { invoiceRows, outstandingDebt, pendingInvoices };
}
