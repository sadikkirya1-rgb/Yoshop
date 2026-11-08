import test from 'node:test';
import assert from 'node:assert/strict';
import kioskUtils from '../kiosk-functions/kiosk-utils.js';

const {sanitizeKioskOrder, sanitizeKioskDisplayOrder, sanitizeKioskImageMap, getFirebaseStorageObjectPath, isFirebaseStorageDownloadUrl, buildFirebaseStorageDownloadUrl, isAuthorizedKioskTarget} = kioskUtils;

test('sanitizeKioskOrder uses catalog prices and computes tax in cents', () => {
	const result = sanitizeKioskOrder({
		requestType: 'order',
		table: 'T4',
		customerName: 'Alex Customer',
		whatsappNumber: '+971 50 123 4567',
		waiterName: 'Sam',
		items: [{productId: 'dish-1', quantity: 2, notes: 'No onions'}]
	}, {
		'dish-1': {name: 'Burger', price: 12.99}
	}, 5);

	assert.deepEqual(result, {
		requestType: 'order',
		table: 'T4',
		customerName: 'Alex Customer',
		whatsappNumber: '+971 50 123 4567',
		waiterName: 'Sam',
		items: [{productId: 'dish-1', name: 'Burger', quantity: 2, unitPrice: 12.99, notes: 'No onions'}],
		subtotal: 25.98,
		tax: 1.3,
		total: 27.28
	});
});

test('sanitizeKioskOrder rejects items outside the published catalog and invalid quantities', () => {
	const customer = {table: 'T4', customerName: 'Alex', whatsappNumber: '+971501234567'};
	assert.throws(() => sanitizeKioskOrder({requestType: 'order', ...customer, items: [{productId: 'hidden', quantity: 1}]}, {}), /unavailable/);
	assert.throws(() => sanitizeKioskOrder({requestType: 'order', ...customer, items: [{productId: 'dish-1', quantity: 1}]}, {
		'dish-1': {name: 'Tea', price: 2, isAvailable: false}
	}), /unavailable/);
	assert.throws(() => sanitizeKioskOrder({requestType: 'order', ...customer, items: [{productId: 'dish-1', quantity: 0}]}, {
		'dish-1': {name: 'Tea', price: 2}
	}), /quantities/);
});

test('sanitizeKioskOrder creates an item-free attendant request', () => {
	assert.deepEqual(sanitizeKioskOrder({requestType: 'attendant', table: '<Bar & 2>', items: [{productId: 'dish-1'}]}, {}), {
		requestType: 'attendant', table: 'Bar  2', items: [], subtotal: 0, tax: 0, total: 0
	});
});

test('sanitizeKioskOrder excludes tax when kiosk tax is disabled', () => {
	const result = sanitizeKioskOrder({
		requestType: 'order',
		table: 'T4',
		customerName: 'Alex',
		whatsappNumber: '+971501234567',
		items: [{productId: 'dish-1', quantity: 2}]
	}, {
		'dish-1': {name: 'Tea', price: 2.5}
	}, 0);

	assert.equal(result.subtotal, 5);
	assert.equal(result.tax, 0);
	assert.equal(result.total, 5);
});

test('sanitizeKioskOrder requires a valid table, customer name, and WhatsApp number', () => {
	const catalog = {'dish-1': {name: 'Tea', price: 2}};
	const items = [{productId: 'dish-1', quantity: 1}];
	assert.throws(() => sanitizeKioskOrder({requestType: 'order', customerName: 'Alex', whatsappNumber: '+971501234567', items}, catalog), /table number/);
	assert.throws(() => sanitizeKioskOrder({requestType: 'order', table: 'T4', whatsappNumber: '+971501234567', items}, catalog), /customer name/);
	assert.throws(() => sanitizeKioskOrder({requestType: 'order', table: 'T4', customerName: 'Alex', whatsappNumber: 'abc', items}, catalog), /WhatsApp number/);
});

test('sanitizeKioskDisplayOrder includes only active public board fields', () => {
	const result = sanitizeKioskDisplayOrder({
		source: 'kiosk',
		requestType: 'order',
		orderNumber: '20261106-007',
		table: '<Patio & 2>',
		status: 'preparing',
		items: [{name: 'Burger', quantity: 2}, {name: '<Tea>', quantity: 1}],
		customerName: 'Private Customer',
		whatsappNumber: '+971501234567',
		createdAt: new Date('2026-11-06T15:00:00.000Z')
	});

	assert.deepEqual(result, {
		orderNumber: '20261106-007',
		table: 'Patio  2',
		items: [{name: 'Burger', quantity: 2}, {name: 'Tea', quantity: 1}],
		status: 'preparing',
		createdAt: '2026-11-06T15:00:00.000Z'
	});
	assert.equal(sanitizeKioskDisplayOrder({source: 'kiosk', requestType: 'attendant', status: 'new'}), null);
	assert.equal(sanitizeKioskDisplayOrder({source: 'kiosk', requestType: 'order', status: 'draft'}), null);
});

test('sanitizeKioskDisplayOrder exposes completed and cancelled kiosk orders', () => {
	for (const status of ['paid', 'completed', 'rejected', 'cancelled', 'canceled']) {
		assert.equal(sanitizeKioskDisplayOrder({
			source: 'kiosk',
			requestType: 'order',
			status,
			orderNumber: '20261108-001',
			createdAt: new Date('2026-11-08T10:00:00.000Z')
		})?.status, status);
	}
});

test('sanitizeKioskImageMap keeps secure image URLs only for selected products', () => {
	assert.deepEqual(sanitizeKioskImageMap({
		dish1: 'https://storage.example.com/dish1.jpg',
		dish2: 'http://storage.example.com/dish2.jpg',
		dish3: 'https://user:pass@storage.example.com/dish3.jpg',
		dish4: 'https://storage.example.com/dish4.jpg'
	}, ['dish1', 'dish2', 'dish3']), {
		dish1: 'https://storage.example.com/dish1.jpg'
	});
});

test('getFirebaseStorageObjectPath extracts encoded paths only from the configured bucket', () => {
	const bucket = 'yoshop-b502f.firebasestorage.app';
	assert.equal(getFirebaseStorageObjectPath('https://firebasestorage.googleapis.com/v0/b/yoshop-b502f.firebasestorage.app/o/shops%2Fshop-1%2Fdishes%2Fphoto.jpg?alt=media&token=abc', bucket), 'shops/shop-1/dishes/photo.jpg');
	assert.equal(getFirebaseStorageObjectPath('gs://yoshop-b502f.firebasestorage.app/users%2Fuser-1%2Fdishes%2Fphoto.jpg', bucket), 'users/user-1/dishes/photo.jpg');
	assert.equal(getFirebaseStorageObjectPath('https://storage.googleapis.com/yoshop-b502f.firebasestorage.app/shops/shop-1/photo.jpg', bucket), 'shops/shop-1/photo.jpg');
	assert.equal(getFirebaseStorageObjectPath('https://firebasestorage.googleapis.com/v0/b/other-bucket/o/photo.jpg', bucket), null);
	assert.equal(getFirebaseStorageObjectPath('https://images.example.com/photo.jpg', bucket), null);
});

test('isFirebaseStorageDownloadUrl preserves tokenized links only for the configured bucket', () => {
	const bucket = 'yoshop-b502f.firebasestorage.app';
	assert.equal(isFirebaseStorageDownloadUrl('https://firebasestorage.googleapis.com/v0/b/yoshop-b502f.firebasestorage.app/o/shops%2Fshop-1%2Fphoto.jpg?alt=media&token=abc', bucket), true);
	assert.equal(isFirebaseStorageDownloadUrl('https://firebasestorage.googleapis.com/v0/b/yoshop-b502f.firebasestorage.app/o/photo.jpg?alt=media', bucket), false);
	assert.equal(isFirebaseStorageDownloadUrl('https://firebasestorage.googleapis.com/v0/b/other-bucket/o/photo.jpg?token=abc', bucket), false);
	assert.equal(isFirebaseStorageDownloadUrl('http://firebasestorage.googleapis.com/v0/b/yoshop-b502f.firebasestorage.app/o/photo.jpg?token=abc', bucket), false);
});

test('buildFirebaseStorageDownloadUrl encodes the bucket, object path, and token', () => {
	assert.equal(
		buildFirebaseStorageDownloadUrl('yoshop-b502f.firebasestorage.app', 'shops/shop 1/dishes/a photo.jpg', 'token+/='),
		'https://firebasestorage.googleapis.com/v0/b/yoshop-b502f.firebasestorage.app/o/shops%2Fshop%201%2Fdishes%2Fa%20photo.jpg?alt=media&token=token%2B%2F%3D'
	);
	assert.equal(buildFirebaseStorageDownloadUrl('', 'photo.jpg', 'token'), '');
});

test('kiosk target access allows owners and the master app admin only', () => {
	const masterUid = 'master-admin';
	const masterEmail = 'admin@example.com';
	assert.equal(isAuthorizedKioskTarget({uid: 'business-1'}, 'business-1', masterUid, masterEmail), true);
	assert.equal(isAuthorizedKioskTarget({uid: masterUid}, 'business-1', masterUid, masterEmail), true);
	assert.equal(isAuthorizedKioskTarget({uid: 'admin-user', token: {email: 'ADMIN@example.com'}}, 'business-1', masterUid, masterEmail), true);
	assert.equal(isAuthorizedKioskTarget({uid: 'other-user', token: {email: 'other@example.com'}}, 'business-1', masterUid, masterEmail), false);
	assert.equal(isAuthorizedKioskTarget({uid: 'master-admin'}, '', masterUid, masterEmail), false);
});