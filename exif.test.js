import test from 'node:test';
import assert from 'node:assert/strict';
import { captureTime, readExifDateTimeOriginal } from './exif.js';

function jpegWithDate() {
  const tiff = Buffer.alloc(64);
  tiff.write('II', 0, 'ascii');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8769, 10);
  tiff.writeUInt16LE(4, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(26, 18);
  tiff.writeUInt16LE(1, 26);
  tiff.writeUInt16LE(0x9003, 28);
  tiff.writeUInt16LE(2, 30);
  tiff.writeUInt32LE(20, 32);
  tiff.writeUInt32LE(44, 36);
  tiff.write('2026:09:29 11:02:03\0', 44, 'ascii');
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), length, payload, Buffer.from([0xff, 0xd9])]);
}

test('EXIF original capture time is read without inventing a timezone', async () => {
  const bytes = jpegWithDate();
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  assert.equal(readExifDateTimeOriginal(buffer), '2026-09-29T11:02:03');
  const result = await captureTime({ type: 'image/jpeg', arrayBuffer: async () => buffer, lastModified: Date.now() }, '2026-09-29T00:00:00.000Z');
  assert.deepEqual(result, { capturedAt: '2026-09-29T11:02:03', capturedAtSource: 'exif' });
});

test('missing or damaged EXIF uses file or import time without throwing', async () => {
  const noExif = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]).buffer;
  assert.equal(readExifDateTimeOriginal(noExif), null);
  assert.equal(readExifDateTimeOriginal(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0, 250]).buffer), null);
  assert.equal((await captureTime({ type: 'image/jpeg', arrayBuffer: async () => noExif, lastModified: Date.now() }, new Date().toISOString())).capturedAtSource, 'file');
  assert.equal((await captureTime({ type: 'image/png', arrayBuffer: async () => noExif }, new Date().toISOString())).capturedAtSource, 'import');
});
