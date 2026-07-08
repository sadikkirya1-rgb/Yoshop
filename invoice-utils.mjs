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

export function buildInvoiceListItems({ customers = [], transactions = [] } = {}) {
  const customerList = Array.isArray(customers) ? customers : [];
  const txList = Array.isArray(transactions) ? transactions : [];

  return txList
    .filter(tx => tx && tx.invoiceNumber)
    .map(transaction => {
      const customer = customerList.find(customer => findMatchingCustomer(customer, transaction)) || null;
      const total = Number(transaction.total || 0);
      const amountPaid = transaction.amountPaid !== undefined
        ? Number(transaction.amountPaid)
        : total;
      const balance = transaction.balance !== undefined
        ? Number(transaction.balance)
        : (amountPaid - total);

      if (balance > 0) return null;

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
        balance,
        lastAdjustment: transaction.lastAdjustment || null,
        adjustments: Array.isArray(transaction.adjustments) ? transaction.adjustments : [],
        invoiceNumber: normalizeInvoiceNumber(transaction.invoiceNumber)
      };

      return {
        id: transaction.id || transaction.recordId || transaction.date || transaction.invoiceNumber,
        date: transaction.date || new Date().toISOString(),
        customer,
        customerName: previewData.customerName,
        invoiceNumber: previewData.invoiceNumber,
        total,
        amountPaid,
        balance,
        paymentMethod: transaction.paymentMethod || 'On Account',
        previewData,
        transaction
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}
