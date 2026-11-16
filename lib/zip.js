// Minimal .zip writing and reading (deflate via node:zlib, UTF-8 names, no zip64), for world exports and imports.
import zlib from "node:zlib";

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
export function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}

/** [{name, data: Buffer}] -> zip Buffer */
export function writeZip(entries, date = new Date()) {
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    const locals = [], centrals = [];
    let offset = 0;
    for (const { name, data } of entries) {
        const nameBuf = Buffer.from(name, "utf8");
        const deflated = zlib.deflateRawSync(data, { level: 9 });
        const store = deflated.length >= data.length;
        const body = store ? data : deflated;
        const crc = crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(store ? 0 : 8, 8);
        local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
        locals.push(local, nameBuf, body);
        const central = Buffer.alloc(46);
        // made by Unix (so unzip reads the names as UTF-8), needs 2.0, UTF-8 names
        central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE((3 << 8) | 30, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(store ? 0 : 8, 10); central.writeUInt16LE(dosTime, 12); central.writeUInt16LE(dosDate, 14); central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt32LE(0o100644 * 65536, 38); /* -rw-r--r-- */ central.writeUInt32LE(offset, 42);
        centrals.push(central, nameBuf);
        offset += 30 + nameBuf.length + body.length;
    }
    const dir = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, dir, end]);
}

/** zip Buffer -> [{name, data}] (files only) */
export function readZip(buf) {
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw Object.assign(new Error("Not a zip file"), { status: 400 });
    const count = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    const out = [];
    for (let n = 0; n < count; n++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) throw Object.assign(new Error("Broken zip file"), { status: 400 });
        const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
        const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
        const local = buf.readUInt32LE(p + 42);
        const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
        p += 46 + nameLen + extraLen + commentLen;
        if (name.endsWith("/")) continue;
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const body = buf.subarray(start, start + csize);
        if (method !== 0 && method !== 8) throw Object.assign(new Error(`Unsupported compression in ${name}`), { status: 400 });
        out.push({ name, data: method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body) });
    }
    return out;
}
