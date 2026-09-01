// fix-zip-sep.js: in-place patch zip entry-name separators from backslash to slash.
// .NET ZipFile on Windows writes '\\' separators; zip spec wants '/'. Same-byte-length
// replacement inside the name field only (safe: offsets/CRC untouched, no recompression).
const fs = require('fs');
const zip = process.argv[2];
if (!zip) { console.log('usage: node fix-zip-sep.js <zip>'); process.exit(1); }
const buf = fs.readFileSync(zip);
function u16(o) { return buf.readUInt16LE(o); }
function u32(o) { return buf.readUInt32LE(o); }
// find EOCD (no comment or small comment)
let eocd = -1;
for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
  if (u32(i) === 0x06054b50) { eocd = i; break; }
}
if (eocd < 0) { console.log('[skip] EOCD not found'); process.exit(1); }
const cdSize = u32(eocd + 12);
const cdOff = u32(eocd + 16);
if (cdOff === 0xffffffff || cdSize === 0xffffffff) { console.log('[skip] zip64 not supported by patcher'); process.exit(1); }
let pos = cdOff, patched = 0, entries = 0;
const end = cdOff + cdSize;
while (pos + 46 <= end) {
  if (u32(pos) !== 0x02014b50) break;
  const nameLen = u16(pos + 28);
  const extraLen = u16(pos + 30);
  const commentLen = u16(pos + 32);
  const localOff = u32(pos + 42);
  const namePos = pos + 46;
  for (let j = namePos; j < namePos + nameLen; j++) {
    if (buf[j] === 0x5c) { buf[j] = 0x2f; patched++; }
  }
  if (localOff + 30 <= buf.length && u32(localOff) === 0x04034b50) {
    const ln2 = u16(localOff + 26);
    const le2 = u16(localOff + 28);
    if (ln2 === nameLen) {
      const lnPos = localOff + 30;
      for (let j = lnPos; j < lnPos + nameLen; j++) {
        if (buf[j] === 0x5c) { buf[j] = 0x2f; patched++; }
      }
    }
  }
  entries++;
  pos += 46 + nameLen + extraLen + commentLen;
}
if (patched > 0) { fs.writeFileSync(zip, buf); }
console.log('zip-sep: entries=' + entries + ' backslashes-replaced=' + patched + (patched > 0 ? ' (written)' : ' (no change)'));
