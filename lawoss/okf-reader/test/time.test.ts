import { test, expect } from 'bun:test';
import { today, okfRefreshInterval } from '../src/index.ts';
test('calendar day changes at local midnight rather than UTC midnight', () => {
  expect(today(new Date(2026, 9, 18, 23, 59, 59))).toBe('2026-10-18');
  expect(today(new Date(2026, 9, 19, 0, 0, 0))).toBe('2026-10-19');
});
test('refresh budget covers fast reads and backs off for a large practice', () => {
  expect(okfRefreshInterval(10)).toBe(15000);
  expect(okfRefreshInterval(3000)).toBe(30000);
  expect(okfRefreshInterval(30000)).toBe(120000);
});
