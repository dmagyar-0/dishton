// Unit tests for the storage-path ownership check. Run via `pnpm test:edge`.

import { assertEquals } from 'jsr:@std/assert';
import { isOwnedStoragePath } from './storage-path.ts';

const UID = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-8888-7777-6666-555555555555';

Deno.test('isOwnedStoragePath accepts the caller own prefix', () => {
  assertEquals(isOwnedStoragePath(`${UID}/abc.jpg`, UID), true);
  assertEquals(isOwnedStoragePath(`${UID}/nested/abc.jpg`, UID), true);
});

Deno.test('isOwnedStoragePath rejects another user prefix', () => {
  assertEquals(isOwnedStoragePath(`${OTHER}/abc.jpg`, UID), false);
});

Deno.test('isOwnedStoragePath rejects traversal and prefix tricks', () => {
  assertEquals(isOwnedStoragePath(`${UID}/../${OTHER}/x.jpg`, UID), false);
  assertEquals(isOwnedStoragePath(`${UID}`, UID), false); // no object, just the folder
  assertEquals(isOwnedStoragePath(`${UID}/`, UID), false); // empty object name
  assertEquals(isOwnedStoragePath(`${UID}suffix/x.jpg`, UID), false); // prefix without slash
  assertEquals(isOwnedStoragePath('/x.jpg', UID), false);
});
