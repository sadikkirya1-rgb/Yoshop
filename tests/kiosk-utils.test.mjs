import test from 'node:test';
import assert from 'node:assert/strict';
import kioskUtils from '../kiosk-functions/kiosk-utils.js';

const {sanitizeKioskOrder} = kioskUtils;

test('sanitizeKioskOrder uses catalog prices and computes tax in cents', () => {
	const result = sanitizeKioskOrder({
		requestType: 'order',
		table: 'T4',
		items: [{productId: 'dish-1', quantity: 2, notes: 'No onions'}]
	}, {
		'dish-1': {name: 'Burger', price: 12.99}
	}, 5);

	assert.deepEqual(result, {
		requestType: 'order',
		table: 'T4',
		items: [{productId: 'dish-1', name: 'Burger', quantity: 2, unitPrice: 12.99, notes: 'No onions'}],
		subtotal: 25.98,
		tax: 1.3,
		total: 27.28
	});
});

test('sanitizeKioskOrder rejects items outside the published catalog and invalid quantities', () => {
	assert.throws(() => sanitizeKioskOrder({requestType: 'order', items: [{productId: 'hidden', quantity: 1}]}, {}), /unavailable/);
	assert.throws(() => sanitizeKioskOrder({requestType: 'order', items: [{productId: 'dish-1', quantity: 0}]}, {
		'dish-1': {name: 'Tea', price: 2}
	}), /quantities/);
});

test('sanitizeKioskOrder creates an item-free attendant request', () => {
	assert.deepEqual(sanitizeKioskOrder({requestType: 'attendant', table: '<Bar & 2>', items: [{productId: 'dish-1'}]}, {}), {
		requestType: 'attendant', table: 'Bar  2', items: [], subtotal: 0, tax: 0, total: 0
	});
});