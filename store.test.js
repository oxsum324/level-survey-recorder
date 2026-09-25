import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBackup } from './store.js';

const image = `data:image/png;base64,${Buffer.from('equipment-photo').toString('base64')}`;
const project = {
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
