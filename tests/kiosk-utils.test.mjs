import test from 'node:test';
import assert from 'node:assert/strict';
import kioskUtils from '../kiosk-functions/kiosk-utils.js';

const {sanitizeKioskOrder} = kioskUtils;

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