export function readExifDateTimeOriginal(buffer) {
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
    let cursor = 2;
    while (cursor + 4 <= view.byteLength) {
      if (view.getUint8(cursor++) !== 0xff) return null;
      while (cursor < view.byteLength && view.getUint8(cursor) === 0xff) cursor++;
      const marker = view.getUint8(cursor++);
      if (marker === 0xda || marker === 0xd9) return null;
      if (cursor + 2 > view.byteLength) return null;
      const length = view.getUint16(cursor);
      const start = cursor + 2;
      const end = cursor + length;
      if (length < 2 || end > view.byteLength) return null;
      if (marker === 0xe1 && length >= 8 && [0x45, 0x78, 0x69, 0x66, 0, 0].every((byte, index) => view.getUint8(start + index) === byte)) {
        const tiff = start + 6;
        const little = view.getUint16(tiff) === 0x4949;
        if (!little && view.getUint16(tiff) !== 0x4d4d) return null;
        const u16 = at => view.getUint16(at, little);
        const u32 = at => view.getUint32(at, little);
        if (u16(tiff + 2) !== 42) return null;
        const findTag = (ifdOffset, tag) => {
          const ifd = tiff + ifdOffset;
          if (ifd < tiff || ifd + 2 > end) return null;
          const count = u16(ifd);
          if (ifd + 2 + count * 12 > end) return null;
          for (let i = 0; i < count; i++) {
            const entry = ifd + 2 + i * 12;
            if (u16(entry) === tag) return entry;
          }
          return null;
        };
        const pointer = findTag(u32(tiff + 4), 0x8769);
        if (pointer === null || u16(pointer + 2) !== 4 || u32(pointer + 4) !== 1) return null;
        const entry = findTag(u32(pointer + 8), 0x9003);
        if (entry === null || u16(entry + 2) !== 2) return null;
        const count = u32(entry + 4);
        const at = count <= 4 ? entry + 8 : tiff + u32(entry + 8);
        if (count < 19 || at < tiff || at + count > end) return null;
        const value = Array.from({ length: 19 }, (_, index) => String.fromCharCode(view.getUint8(at + index))).join('');
        const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
        if (!match) return null;
        const [, year, month, day, hour, minute, second] = match;
        if (+month < 1 || +month > 12 || +day < 1 || +day > 31 || +hour > 23 || +minute > 59 || +second > 59) return null;
        return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
      }
      cursor = end;
    }
  } catch (_) { return null; }
  return null;
}

const localDateTime = date => {
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

export async function captureTime(file, addedAt) {
  const exif = file?.type === 'image/jpeg' ? readExifDateTimeOriginal(await file.arrayBuffer()) : null;
  if (exif) return { capturedAt: exif, capturedAtSource: 'exif' };
  if (Number.isFinite(file?.lastModified) && file.lastModified > 0) {
    return { capturedAt: localDateTime(new Date(file.lastModified)), capturedAtSource: 'file' };
  }
  return { capturedAt: localDateTime(new Date(addedAt)), capturedAtSource: 'import' };
}
