import test from 'node:test';
import assert from 'node:assert/strict';
import kioskUtils from '../kiosk-functions/kiosk-utils.js';

const {sanitizeKioskOrder, sanitizeKioskDisplayOrder, sanitizeKioskImageMap, isAuthorizedKioskTarget} = kioskUtils;

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
		customerName: 'Private Customer',
		whatsappNumber: '+971501234567',
		createdAt: new Date('2026-11-06T15:00:00.000Z')
	});

	assert.deepEqual(result, {
		orderNumber: '20261106-007',
		table: 'Patio  2',
		status: 'preparing',
		createdAt: '2026-11-06T15:00:00.000Z'
	});
	assert.equal(sanitizeKioskDisplayOrder({source: 'kiosk', requestType: 'attendant', status: 'new'}), null);
	assert.equal(sanitizeKioskDisplayOrder({source: 'kiosk', requestType: 'order', status: 'paid'}), null);
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

test('kiosk target access allows owners and the master app admin only', () => {
	const masterUid = 'master-admin';
	const masterEmail = 'admin@example.com';
	assert.equal(isAuthorizedKioskTarget({uid: 'business-1'}, 'business-1', masterUid, masterEmail), true);
	assert.equal(isAuthorizedKioskTarget({uid: masterUid}, 'business-1', masterUid, masterEmail), true);
	assert.equal(isAuthorizedKioskTarget({uid: 'admin-user', token: {email: 'ADMIN@example.com'}}, 'business-1', masterUid, masterEmail), true);
	assert.equal(isAuthorizedKioskTarget({uid: 'other-user', token: {email: 'other@example.com'}}, 'business-1', masterUid, masterEmail), false);
	assert.equal(isAuthorizedKioskTarget({uid: 'master-admin'}, '', masterUid, masterEmail), false);
});