import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, fingerprint, sha256Blob } from './integrity.js';
import { readFileSync } from 'node:fs';

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

test('E3 historical V0.7.0 fingerprint survives adding empty optional identity fields', async () => {
  const old = JSON.parse(readFileSync(new URL('./checks/fixtures/v070-case.json', import.meta.url), 'utf8')).backup.project;
  const originalHash = 'bfb2bdd0fb104d15c61096f721b6e7d9a824bb7f0349fc1ddafdb253fefed6b6';
  assert.equal(await fingerprint(old), originalHash);
  assert.equal(await fingerprint({ ...old, householdNo: '', address: '', orgName: '' }), originalHash);
  const withoutExistingEmptyName = { ...old }; delete withoutExistingEmptyName.name;
  assert.notEqual(await fingerprint(withoutExistingEmptyName), originalHash);
});

test('E3 each populated identity field changes the evidence fingerprint', async () => {
  const project = { schema: 1, id: 'identity-test', householdNo: '', address: '', orgName: '' };
  const empty = await fingerprint(project);
  for (const [key, value] of [['householdNo', 'A-01'], ['address', '測試路 1 號'], ['orgName', '合成測試單位']]) {
    const filled = await fingerprint({ ...project, [key]: value });
    assert.notEqual(filled, empty, key);
    assert.notEqual(await fingerprint({ ...project, [key]: value + '2' }), filled, key);
    assert.equal(await fingerprint({ ...project, [key]: '' }), empty, key);
  }
});
