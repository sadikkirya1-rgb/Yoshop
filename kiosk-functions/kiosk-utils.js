function sanitizeKioskOrder(requestData = {}, catalog = {}, taxRate = 0) {
	const requestType = requestData.requestType === 'attendant' ? 'attendant' : requestData.requestType === 'order' ? 'order' : '';
	if (!requestType) throw new Error('Unsupported request type.');

	const table = String(requestData.table || '').replace(/[<>&]/g, '').trim().slice(0, 40);
	if (requestType === 'attendant') {
		return {requestType, table, items: [], subtotal: 0, tax: 0, total: 0};
	}
	const customerName = String(requestData.customerName || '').replace(/[<>&]/g, '').trim().slice(0, 100);
	const whatsappNumber = String(requestData.whatsappNumber || '').trim().slice(0, 30);
	const waiterName = String(requestData.waiterName || '').replace(/[<>&]/g, '').trim().slice(0, 100);
	if (!table) throw new Error('Enter a table number.');
	if (!customerName) throw new Error('Enter the customer name.');
	if (!/^\+?[0-9\s().-]{7,30}$/.test(whatsappNumber) || whatsappNumber.replace(/\D/g, '').length < 7 || whatsappNumber.replace(/\D/g, '').length > 15) {
		throw new Error('Enter a valid WhatsApp number.');
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
		customerName,
		whatsappNumber,
		waiterName,
		items,
		subtotal: subtotalCents / 100,
		tax: taxCents / 100,
		total: (subtotalCents + taxCents) / 100
	};
}

function sanitizeKioskDisplayOrder(order = {}) {
	const status = String(order.status || '');
	if (order.source !== 'kiosk' || order.requestType !== 'order' || !['new', 'accepted', 'preparing', 'ready', 'in_pos'].includes(status)) {
		return null;
	}
	const createdAt = order.createdAt?.toDate?.() || new Date(order.createdAt || 0);
	return {
		orderNumber: String(order.orderNumber || '').slice(0, 40),
		table: String(order.table || '').replace(/[<>&]/g, '').trim().slice(0, 40),
		status,
		createdAt: Number.isNaN(createdAt.valueOf()) ? '' : createdAt.toISOString()
	};
}

function sanitizeKioskImageMap(imageMap = {}, selectedProductIds = []) {
	const selectedIds = new Set(selectedProductIds.map((id) => String(id || '').trim()).filter(Boolean));
	const result = {};
	Object.entries(imageMap).forEach(([productId, value]) => {
		const id = String(productId || '').trim();
		if (!selectedIds.has(id) || typeof value !== 'string' || value.length > 2048) return;
		try {
			const imageUrl = new URL(value);
			if (imageUrl.protocol === 'https:' && !imageUrl.username && !imageUrl.password) result[id] = imageUrl.href;
		} catch (error) {
			return;
		}
	});
	return result;
}

module.exports = {sanitizeKioskOrder, sanitizeKioskDisplayOrder, sanitizeKioskImageMap};