function sanitizeKioskOrder(requestData = {}, catalog = {}, taxRate = 0) {
	const requestType = requestData.requestType === 'attendant' ? 'attendant' : requestData.requestType === 'order' ? 'order' : '';
	if (!requestType) throw new Error('Unsupported request type.');

	const table = String(requestData.table || '').replace(/[<>&]/g, '').trim().slice(0, 40);
	if (requestType === 'attendant') {
		return {requestType, table, items: [], subtotal: 0, tax: 0, total: 0};
	}

	if (!Array.isArray(requestData.items) || requestData.items.length < 1 || requestData.items.length > 20) {
		throw new Error('Choose between 1 and 20 menu items.');
	}

	const items = requestData.items.map((requestedItem) => {
		const productId = String(requestedItem?.productId || '').trim();
		const product = catalog[productId];
		const quantity = Number(requestedItem?.quantity);
		if (!product || product.deleted || product.isAvailable === false) throw new Error('A selected menu item is unavailable.');
		if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw new Error('Item quantities must be between 1 and 20.');

		const unitPrice = Number(product.price);
		if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('A menu item has an invalid price.');

		return {
			productId,
			name: String(product.name || 'Menu item').trim().slice(0, 100),
			quantity,
			unitPrice: Math.round(unitPrice * 100) / 100,
			notes: String(requestedItem?.notes || '').trim().slice(0, 200)
		};
	});

	const subtotalCents = items.reduce((total, item) => total + Math.round(item.unitPrice * 100) * item.quantity, 0);
	const normalizedTaxRate = Number.isFinite(Number(taxRate)) ? Math.min(30, Math.max(0, Number(taxRate))) : 0;
	const taxCents = Math.round(subtotalCents * normalizedTaxRate / 100);

	return {
		requestType,
		table,
		items,
		subtotal: subtotalCents / 100,
		tax: taxCents / 100,
		total: (subtotalCents + taxCents) / 100
	};
}

module.exports = {sanitizeKioskOrder};