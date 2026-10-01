/* Minimal ZIP writer/reader (deflate via Node's zlib), no dependencies.
 * Used for the single-file .codeflow package: the kit writes it, the After Effects panel (CEP Node) reads it.
 * CommonJS so both `require` (panel) and `createRequire` (kit) can load it.
 */
'use strict';
var zlib = require('zlib');

var CRC_TABLE = (function () {
  var t = new Int32Array(256);
  for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) {
  var c = -1;
  for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// entries: [{ name: 'assets/a.png', data: Buffer }]  -> Buffer (zip)
function writeZip(entries) {
  var locals = [], centrals = [], offset = 0;
  entries.forEach(function (e) {
    var name = Buffer.from(e.name.split('\\').join('/'), 'utf8');
    var raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    var comp = zlib.deflateRawSync(raw, { level: 9 });
    var method = 8;
    if (comp.length >= raw.length) { comp = raw; method = 0; }   // already compressed (png/jpg/mp3): store
    var crc = crc32(raw);
    var lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);
    var ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + comp.length;
  });
  var cd = Buffer.concat(centrals);
  var end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(locals.concat([cd, end]));
}

// Buffer (zip) -> [{ name, data: Buffer }]
function readZip(buf) {
  var eocd = -1;
  for (var i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip / .codeflow file');
  var count = buf.readUInt16LE(eocd + 10), p = buf.readUInt32LE(eocd + 16), out = [];
  for (var n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt zip directory');
    var method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    var nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    var name = buf.toString('utf8', p + 46, p + 46 + nlen);
    var lnlen = buf.readUInt16LE(lo + 26), lxlen = buf.readUInt16LE(lo + 28);
    var start = lo + 30 + lnlen + lxlen, comp = buf.subarray(start, start + csize);
    var data = method === 0 ? Buffer.from(comp) : method === 8 ? zlib.inflateRawSync(comp) : null;
    if (!data) throw new Error('unsupported zip compression in ' + name);
    if (name.charAt(name.length - 1) !== '/') out.push({ name: name, data: data });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

module.exports = { writeZip: writeZip, readZip: readZip, crc32: crc32 };
