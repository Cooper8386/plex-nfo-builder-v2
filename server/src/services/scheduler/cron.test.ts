import { expect, test } from 'vitest';
import { cronMatches, parseCron } from './cron.js';

test('cron accepts Sunday as either 0 or 7, including ranges and lists', () => {
  const sunday = new Date('2026-09-06T12:00:00Z'), monday = new Date('2026-09-07T12:00:00Z');
  for (const dow of ['0', '7', '5-7', '1,7']) expect(cronMatches(`0 12 * * ${dow}`, sunday)).toBe(true);
  expect(cronMatches('0 12 * * 7', monday)).toBe(false);
});

test('cron uses POSIX OR for restricted day-of-month and day-of-week', () => {
  expect(cronMatches('0 12 1 * 0', new Date('2026-09-01T12:00:00Z'))).toBe(true);
  expect(cronMatches('0 12 1 * 0', new Date('2026-09-06T12:00:00Z'))).toBe(true);
  expect(cronMatches('0 12 1 * 0', new Date('2026-09-07T12:00:00Z'))).toBe(false);
  expect(cronMatches('0 12 1-31 * 0', new Date('2026-09-07T12:00:00Z'))).toBe(true);
});

test('cron preserves wildcard day semantics for wildcard steps instead of guessing from set size', () => {
  expect(cronMatches('0 12 * * 0', new Date('2026-09-07T12:00:00Z'))).toBe(false);
  expect(cronMatches('0 12 */1 * 0', new Date('2026-09-07T12:00:00Z'))).toBe(false);
  expect(cronMatches('0 12 */2 * 0', new Date('2026-09-06T12:00:00Z'))).toBe(false);
  expect(cronMatches('0 12 */2 * 0', new Date('2026-09-13T12:00:00Z'))).toBe(true);
  expect(cronMatches('0 12 */2 * 0', new Date('2026-09-07T12:00:00Z'))).toBe(false);
  expect(cronMatches('0 12 15 * *', new Date('2026-09-15T12:00:00Z'))).toBe(true);
  expect(cronMatches('0 12 15 * *', new Date('2026-09-14T12:00:00Z'))).toBe(false);
});

test('cron interprets fields in UTC and supports numeric lists, ranges and steps', () => {
  expect(cronMatches('30 4 7 9 1', new Date('2026-09-06T23:30:59-05:00'))).toBe(true);
  expect(cronMatches('30 23 6 9 0', new Date('2026-09-06T23:30:00-05:00'))).toBe(false);
  const expression = '1-10/3,30 */6 * 1,3,9 1-5';
  expect(cronMatches(expression, new Date('2026-09-07T12:07:00Z'))).toBe(true);
  expect(cronMatches(expression, new Date('2026-09-07T12:08:00Z'))).toBe(false);
  expect(cronMatches(expression, new Date('2026-09-07T13:07:00Z'))).toBe(false);
  expect(cronMatches(expression, new Date('2026-10-07T12:07:00Z'))).toBe(false);
  expect(cronMatches('* * * * *', new Date('invalid'))).toBe(false);
});

test('cron rejects malformed fields, unsupported names, invalid bounds and zero steps', () => {
  for (const expression of ['', '* * * *', '* * * * * *', '60 * * * *', '* 24 * * *', '* * 0 * *', '* * 32 * *', '* * * 0 *', '* * * 13 *', '* * * * 8', '*/0 * * * *', '*/-1 * * * *', '10-2 * * * *', '-1 * * * *', '1,,2 * * * *', '1/2/3 * * * *', '1.5 * * * *', '+1 * * * *', '* * * * SUN', '* * * JAN *', '* * * * 7-1', '*/999999999999999999999 * * * *']) {
    expect(() => parseCron(expression), expression).toThrow(/cron/i);
  }
});
