import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBackup, makeBackup, estimateBackupSize } from './store.js';

const image = `data:image/png;base64,${Buffer.from('equipment-photo').toString('base64')}`;
const project = {
  schema: 1,
  points: [{ id: 'bm1', code: 'BM1', type: 'BM' }],
  setups: [], photos: [], equipmentPhotos: [{ id: 'photo-1', mediaId: 'media-1', instrument: 'PENTAX AP-128' }],
  route: { startId: 'bm1', endId: 'bm1' },
};

test('backup restores the case equipment photo with its original media', () => {
  const restored = parseBackup(JSON.stringify({
    format: 'level-survey-case.v1', project,
    media: [{ id: 'media-1', dataUrl: image }],
  }));
  assert.equal(restored.project.equipmentPhotos[0].instrument, 'PENTAX AP-128');
  assert.equal(restored.media[0].id, 'media-1');
  assert.equal(restored.media[0].blob.type, 'image/png');
});

test('backup refuses an equipment photo whose original media is missing', () => {
  assert.throws(() => parseBackup(JSON.stringify({ format: 'level-survey-case.v1', project, media: [] })), /缺少圖面或照片原檔/);
});

test('existing V0.1 case backups without equipment photos remain readable', () => {
  const { equipmentPhotos, ...oldProject } = project;
  const restored = parseBackup(JSON.stringify({ format: 'level-survey-case.v1', project: oldProject, media: [] }));
  assert.equal(restored.media.length, 0);
});

for (const version of ['0.4.3', '0.5.0']) test(`V${version} backup keeps original readings and optional V0.6 fields absent`, () => {
  const old = {
    schema: 1, appVersion: version, id: `legacy-${version}`,
    points: [{ id: 'bm1', code: 'BM1', type: 'BM' }, { id: 's1', code: 'S1', type: 'S' }],
    route: { startId: 'bm1', endId: 'bm1', startHeight: '10.000' },
    setups: [{ bsPointId: 'bm1', bs: '1.000', intermediate: [{ pointId: 's1', value: '0.500' }], fsPointId: 'bm1', fs: '1.000', distance: '' }],
    photos: [], mapMediaId: null,
  };
  const restored = parseBackup(JSON.stringify({ format: 'level-survey-case.v1', project: old, media: [] }));
  assert.equal(restored.project.setups[0].intermediate[0].value, '0.500');
  assert.equal(restored.project.auditLog, undefined);
  assert.equal(restored.project.setups[0].bsAt, undefined);
});

test('L5 schema 2 and missing schema are rejected before a case can be replaced', () => {
  for (const schema of [2, undefined, null, '1']) {
    assert.throws(() => parseBackup(JSON.stringify({ format: 'level-survey-case.v1', project: { ...project, schema }, media: [] })),
      new RegExp(`此案件檔格式（schema ${String(schema)}）不受 V[0-9.]+ 支援`));
  }
});

test('L8 segmented output has the same parsed meaning as the original writer and can be imported', async () => {
  const target = { ...project, name: '中文案件', mapMediaId: 'map', photos: [{ mediaId: 'photo' }, { mediaId: 'map' }], equipmentPhotos: [{ mediaId: 'equipment' }] };
  const media = new Map(['map', 'photo', 'equipment'].map(id => [id, new Blob([id], { type: 'image/jpeg' })]));
  const dataUrl = async blob => `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;
  const load = async id => media.get(id);
  const exportedAt = '2026-10-20T00:00:00.000Z';
  const originalMedia = [];
  for (const [id, blob] of media) originalMedia.push({ id, dataUrl: await dataUrl(blob) });
  const original = JSON.parse(JSON.stringify({ format: 'level-survey-case.v1', exportedAt, project: target, media: originalMedia }));
  let estimated;
  const blob = await makeBackup(target, { load, dataUrl, exportedAt, onEstimate: bytes => estimated = bytes });
  assert.deepEqual(JSON.parse(await blob.text()), original);
  assert.equal(blob.size, estimated);
  assert.equal(await estimateBackupSize(target, { load, exportedAt }), blob.size);
  const restored = parseBackup(await blob.text());
  assert.equal(restored.media.length, 3);
  assert.equal(await restored.media[1].blob.text(), 'photo');
});

test('L8 estimation includes base64 expansion and missing media fails before export', async () => {
  const target = { ...project, equipmentPhotos: [{ mediaId: 'large' }] };
  assert.ok(await estimateBackupSize(target, { load: async () => ({ size: 80 * 1024 * 1024, type: 'image/jpeg' }) }) > 100 * 1024 * 1024);
  await assert.rejects(makeBackup(target, { load: async () => null }), /無法建立完整案件檔/);
});

const historicalCases = JSON.parse(readFileSync(new URL('./checks/fixtures/legacy-cases.json', import.meta.url), 'utf8'));
for (const { version, backup } of historicalCases) test(`historical V${version} defaults with original BS/FS/IS values remain importable`, () => {
  const restored = parseBackup(JSON.stringify(backup));
  assert.equal(restored.project.schema, 1);
  assert.deepEqual(restored.project.setups, backup.project.setups);
  assert.equal(restored.project.setups[0].bs, '1.000');
  assert.equal(restored.project.setups[0].fs, '1.000');
  assert.equal(restored.project.setups[0].intermediate[0].value, '0.500');
  assert.equal(restored.project.setups[0].bsAt, undefined);
});
