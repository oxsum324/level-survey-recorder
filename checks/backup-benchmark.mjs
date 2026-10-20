import { makeBackup } from '../store.js';

const mode = process.argv[2];
if (!['old', 'parts'].includes(mode)) throw new Error('Use old or parts');
const media = new Map(Array.from({ length: 40 }, (_, i) => [`photo-${i}`, new Blob([Buffer.alloc(5 * 1024 * 1024, i)], { type: 'image/jpeg' })]));
const project = { schema: 1, name: '40 張各 5 MiB 假照片', mapMediaId: null, points: [], setups: [], route: {}, equipmentPhotos: [], photos: [...media.keys()].map(mediaId => ({ mediaId })) };
const exportedAt = '2026-10-20T00:00:00.000Z';
const dataUrl = async blob => `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;
global.gc?.();
const baselineRss = process.memoryUsage().rss;
const started = performance.now();
let output;
if (mode === 'old') {
  const entries = [];
  for (const [id, blob] of media) entries.push({ id, dataUrl: await dataUrl(blob) });
  output = new Blob([JSON.stringify({ format: 'level-survey-case.v1', exportedAt, project, media: entries })], { type: 'application/json' });
} else {
  output = await makeBackup(project, { exportedAt, load: async id => media.get(id), dataUrl });
}
console.log(JSON.stringify({ mode, photos: 40, inputBytes: 40 * 5 * 1024 * 1024, outputBytes: output.size,
  elapsedMs: Math.round(performance.now() - started), baselineRssMiB: +(baselineRss / 1024 ** 2).toFixed(1), peakRssMiB: +(process.resourceUsage().maxRSS / 1024).toFixed(1) }));
