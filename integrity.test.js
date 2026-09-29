import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, fingerprint, sha256Blob } from './integrity.js';

test('fingerprint is stable across key order and ignores export timestamps', async () => {
  const a = { schema: 1, id: 'case', points: [{ id: 'BM1', code: 'BM1' }], route: { startId: 'BM1', startHeight: '10.000' }, setups: [{ bs: '1.000' }], lastModifiedAt: 'a', lastExportedAt: 'b' };
  const b = { lastExportedAt: 'later', setups: [{ bs: '1.000' }], route: { startHeight: '10.000', startId: 'BM1' }, points: [{ code: 'BM1', id: 'BM1' }], id: 'case', schema: 1, lastModifiedAt: 'later' };
  assert.equal(canonicalize({ z: 1, a: { y: 2, x: 3 } }), canonicalize({ a: { x: 3, y: 2 }, z: 1 }));
  assert.equal(await fingerprint(a), await fingerprint(b));
  b.setups[0].bs = '1.001';
  assert.notEqual(await fingerprint(a), await fingerprint(b));
  assert.notEqual(await fingerprint(a, [{ id: 'photo', sha256: 'a' }]), await fingerprint(a, [{ id: 'photo', sha256: 'b' }]));
  assert.equal((await sha256Blob(new Blob(['abc']))).length, 64);
});
