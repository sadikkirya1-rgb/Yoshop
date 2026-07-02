import test from 'node:test';
import assert from 'node:assert/strict';
import { getCanonicalProductCatalog } from '../record-utils.mjs';

test('getCanonicalProductCatalog keeps only sellable products and removes duplicates', () => {
  const products = [
    { name: 'Tea', category: 'Drinks', price: 5, barcode: 'b1', version: 1, updatedAt: '2024-01-01T00:00:00.000Z' },
    { name: 'Tea', category: 'Drinks', price: 6, barcode: 'b1', version: 2, updatedAt: '2024-01-02T00:00:00.000Z' },
    { name: 'Ingredient', category: 'Stock', price: 0, recipe: [] },
    { name: 'Cake', category: 'Bakery', price: 8, version: 1, updatedAt: '2024-01-03T00:00:00.000Z' }
  ];

  const result = getCanonicalProductCatalog(products);

  assert.equal(result.length, 2);
  assert.deepEqual(result.map(item => item.name), ['Tea', 'Cake']);
  assert.equal(result[0].price, 6);
});

test('getCanonicalProductCatalog merges same-name stock and shop items into one record', () => {
  const products = [
    { name: 'Milk', category: null, costPrice: 2, stock: 10, unit: 'L', price: 3 },
    { name: 'Milk', category: 'Beverages', price: 4, barcode: 'milk-1', version: 1, updatedAt: '2024-01-01T00:00:00.000Z' }
  ];

  const result = getCanonicalProductCatalog(products);

  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Milk');
  assert.equal(result[0].stock, 10);
  assert.equal(result[0].price, 4);
});
