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
	const orderModes = ['dine_in', 'takeaway', 'delivery'];
	const paymentModes = ['cash', 'card_at_counter', 'pay_on_delivery', 'online_payment'];
	const orderMode = requestData.orderMode === undefined ? 'dine_in' : String(requestData.orderMode);
	const paymentMode = requestData.paymentMode === undefined ? 'cash' : String(requestData.paymentMode);
	if (!orderModes.includes(orderMode)) throw new Error('Choose dine-in, takeaway, or delivery.');
	if (!paymentModes.includes(paymentMode)) throw new Error('Choose a valid payment mode.');
	const deliveryAddress = String(requestData.deliveryAddress || '').replace(/[<>&]/g, '').trim().slice(0, 250);
	if (orderMode === 'dine_in' && !table) throw new Error('Enter a table number.');
	if (orderMode === 'delivery' && !deliveryAddress) throw new Error('Enter the delivery address.');
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
		orderMode,
		paymentMode,
		deliveryAddress,
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
	if (order.source !== 'kiosk' || order.requestType !== 'order' || !['new', 'accepted', 'preparing', 'ready', 'in_pos', 'paid', 'completed', 'rejected', 'cancelled', 'canceled'].includes(status)) {
		return null;
	}
	const createdAt = order.createdAt?.toDate?.() || new Date(order.createdAt || 0);
	const items = (Array.isArray(order.items) ? order.items : [])
		.slice(0, 20)
		.map((item) => ({
			name: String(item?.name || 'Menu item').replace(/[<>&]/g, '').trim().slice(0, 60),
			quantity: Number(item?.quantity)
		}))
		.filter((item) => item.name && Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 20);
	return {
		orderNumber: String(order.orderNumber || '').slice(0, 40),
		table: String(order.table || '').replace(/[<>&]/g, '').trim().slice(0, 40),
		orderMode: ['dine_in', 'takeaway', 'delivery'].includes(order.orderMode)
			? order.orderMode
			: (order.table ? 'dine_in' : 'takeaway'),
		paymentMode: ['cash', 'card_at_counter', 'pay_on_delivery', 'online_payment'].includes(order.paymentMode)
			? order.paymentMode
			: 'not_specified',
		items,
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

function getFirebaseStorageObjectPath(value = '', expectedBucketName = '') {
	if (typeof value !== 'string' || !value.trim() || !expectedBucketName) return null;
	try {
		if (value.startsWith('gs://')) {
			const match = value.match(/^gs:\/\/([^/]+)\/(.+)$/);
			return match && match[1] === expectedBucketName ? decodeURIComponent(match[2]) : null;
		}

		const url = new URL(value);
		if (url.protocol !== 'https:') return null;
		let bucketName = '';
		let encodedPath = '';
		if (url.hostname === 'firebasestorage.googleapis.com') {
			const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
			if (!match) return null;
			bucketName = decodeURIComponent(match[1]);
			encodedPath = match[2];
		} else if (url.hostname === 'storage.googleapis.com') {
			const match = url.pathname.match(/^\/([^/]+)\/(.+)$/);
			if (!match) return null;
			bucketName = decodeURIComponent(match[1]);
			encodedPath = match[2];
		} else {
			return null;
		}

		if (bucketName !== expectedBucketName) return null;
		const objectPath = decodeURIComponent(encodedPath);
		return objectPath && !objectPath.startsWith('/') ? objectPath : null;
	} catch (error) {
		return null;
	}
}

function isFirebaseStorageDownloadUrl(value = '', expectedBucketName = '') {
	if (typeof value !== 'string' || !expectedBucketName) return false;
	try {
		const url = new URL(value);
		if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com' || url.username || url.password) return false;
		const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/.+$/);
		return Boolean(match && decodeURIComponent(match[1]) === expectedBucketName && url.searchParams.get('token'));
	} catch (error) {
		return false;
	}
}

function buildFirebaseStorageDownloadUrl(bucketName = '', objectPath = '', token = '') {
	if (!bucketName || !objectPath || !token) return '';
	const encodedPath = encodeURIComponent(objectPath);
	const encodedToken = encodeURIComponent(token);
	return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucketName)}/o/${encodedPath}?alt=media&token=${encodedToken}`;
}

function isAuthorizedKioskTarget(auth = null, targetUid = '', masterAdminUid = '', masterAdminEmail = '') {
	if (!auth?.uid || typeof targetUid !== 'string' || !targetUid.trim() || targetUid.length > 128) return false;
	if (targetUid === auth.uid) return true;
	const email = String(auth.token?.email || '').trim().toLowerCase();
	return auth.uid === masterAdminUid || email === masterAdminEmail.toLowerCase();
}

module.exports = {sanitizeKioskOrder, sanitizeKioskDisplayOrder, sanitizeKioskImageMap, getFirebaseStorageObjectPath, isFirebaseStorageDownloadUrl, buildFirebaseStorageDownloadUrl, isAuthorizedKioskTarget};