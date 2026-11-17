export const BUILT_IN_CUSTOMER_QUICK_MESSAGES = [
  {
    id: 'order_received',
    label: 'Order Received',
    text: 'We have received your order and are now preparing it with care. We will keep you updated shortly.'
  },
  {
    id: 'order_ready',
    label: 'Order Ready',
    text: 'Great news! Your order is now ready for collection. Please visit us at your convenience.'
  },
  {
    id: 'invoice_ready',
    label: 'Invoice Ready',
    text: 'Your invoice is now ready for review. Thank you for choosing us for your service.'
  },
  {
    id: 'payment_received',
    label: 'Payment Received',
    text: 'We have successfully received your payment. Thank you for your trust and continued support.'
  },
  {
    id: 'balance_due',
    label: 'Balance Due',
    text: 'This is a friendly reminder that your outstanding balance is {{balance}}. Please contact us if you need any assistance.'
  },
  {
    id: 'special_offer',
    label: 'Special Offer',
    text: 'We have a special offer just for you. Please reach out to us to discover more about this exclusive deal.'
  },
  {
    id: 'welcome',
    label: 'Welcome / General Care',
    text: 'Welcome to our business! We are delighted to assist you and look forward to serving you again.'
  }
];

export function resolveCustomerQuickMessage(templateId, customMessages = [], values = {}) {
  const normalizedId = String(templateId || '').trim();
  if (!normalizedId) return '';

  const builtInId = normalizedId.startsWith('builtin:')
    ? normalizedId.slice('builtin:'.length)
    : normalizedId;
  const builtInMessage = BUILT_IN_CUSTOMER_QUICK_MESSAGES.find(message => message.id === builtInId);
  const customId = normalizedId.startsWith('custom:')
    ? normalizedId.slice('custom:'.length)
    : normalizedId;
  const customMessage = (Array.isArray(customMessages) ? customMessages : [])
    .find(message => message && String(message.id || '') === customId);
  const template = builtInMessage?.text || customMessage?.text || '';

  return template.replace(/\{\{\s*(customerName|businessName|balance)\s*\}\}/g, (_, key) => {
    return String(values[key] ?? '');
  });
}
