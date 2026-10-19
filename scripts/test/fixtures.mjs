// 测试夹具：在干净的小图里注入「模拟」GPS/设备信息。
// 坐标与设备名均为虚构值（12°34'56"N 65°43'21"E 位于海面）；不使用任何真实照片。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
export const clean = {
  jpeg: () => readFileSync(join(here, "fixtures/clean.jpg")),
  png: () => readFileSync(join(here, "fixtures/clean.png")),
  webp: () => readFileSync(join(here, "fixtures/clean.webp")),
};

export const FAKE = { make: "TestMakerCo", model: "QJ-FakeCam 9", lat: [12, 34, 56], lon: [65, 43, 21] };

// 构造 TIFF（小端）EXIF：IFD0 含 Make/Model/DateTime，GPS IFD 含纬度/经度
export function buildExifTiff() {
  const entries0 = [];
  const entriesGps = [];
  const ascii = (s) => Buffer.from(s + "\0", "latin1");
  const rationals = (arr) => {
    const b = Buffer.alloc(arr.length * 8);
    arr.forEach((v, i) => { b.writeUInt32LE(v, i * 8); b.writeUInt32LE(1, i * 8 + 4); });
    return b;
  };
  entries0.push([0x010f, 2, ascii(FAKE.make)]);
  entries0.push([0x0110, 2, ascii(FAKE.model)]);
  entries0.push([0x0132, 2, ascii("2026:10:13 12:34:56")]);
  entriesGps.push([0x0001, 2, ascii("N")]);
  entriesGps.push([0x0002, 5, rationals(FAKE.lat)]);
  entriesGps.push([0x0003, 2, ascii("E")]);
  entriesGps.push([0x0004, 5, rationals(FAKE.lon)]);

  const unit = { 2: 1, 4: 4, 5: 8 };
  // 布局：header(8) | IFD0 | IFD0 数据 | GPS IFD | GPS 数据
  const ifdSize = (n) => 2 + n * 12 + 4;
  const dataSize = (es) => es.reduce((s, [, , v]) => s + (v.length > 4 ? v.length + (v.length % 2) : 0), 0);
  const n0 = entries0.length + 1; // + GPS 指针
  const ifd0At = 8;
  const gpsAt = ifd0At + ifdSize(n0) + dataSize(entries0);
  const total = gpsAt + ifdSize(entriesGps.length) + dataSize(entriesGps);
  const out = Buffer.alloc(total);
  out.write("II", 0, "latin1");
  out.writeUInt16LE(42, 2);
  out.writeUInt32LE(ifd0At, 4);

  const writeIfd = (at, es, extra) => {
    const all = [...es.map(([tag, type, v]) => [tag, type, v.length / unit[type], v]), ...(extra || [])].sort((a, b) => a[0] - b[0]);
    out.writeUInt16LE(all.length, at);
    let dataAt = at + ifdSize(all.length);
    all.forEach(([tag, type, count, v], i) => {
      const e = at + 2 + i * 12;
      out.writeUInt16LE(tag, e);
      out.writeUInt16LE(type, e + 2);
      out.writeUInt32LE(count, e + 4);
      if (Buffer.isBuffer(v) && v.length > 4) {
        out.writeUInt32LE(dataAt, e + 8);
        v.copy(out, dataAt);
        dataAt += v.length + (v.length % 2);
      } else if (Buffer.isBuffer(v)) v.copy(out, e + 8);
      else out.writeUInt32LE(v, e + 8);
    });
    out.writeUInt32LE(0, at + 2 + all.length * 12);
  };
  writeIfd(ifd0At, entries0, [[0x8825, 4, 1, gpsAt]]);
  writeIfd(gpsAt, entriesGps);
  return out;
}

/** 在 JPEG 的 SOI 后插入 APP1 EXIF */
export function jpegWithGps(src = clean.jpeg()) {
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), buildExifTiff()]);
  const seg = Buffer.alloc(4);
  seg.writeUInt16BE(0xffe1, 0);
  seg.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([src.subarray(0, 2), seg, payload, src.subarray(2)]);
}

/** 简单 WebP（VP8）转为扩展格式 VP8X + EXIF 块 */
export function webpWithGps(src = clean.webp()) {
  const vp8 = src.subarray(12); // "VP8 " 块
  if (vp8.toString("latin1", 0, 4) !== "VP8 ") throw new Error("fixture 不是简单 VP8 WebP");
  const frame = vp8.subarray(8);
  const w = frame.readUInt16LE(6) & 0x3fff;
  const h = frame.readUInt16LE(8) & 0x3fff;
  const chunk = (fourcc, data) => {
    const head = Buffer.alloc(8);
    head.write(fourcc, 0, "latin1");
    head.writeUInt32LE(data.length, 4);
    return Buffer.concat([head, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const x = Buffer.alloc(10);
  x[0] = 0x08; // EXIF 标志
  x.writeUIntLE(w - 1, 4, 3);
  x.writeUIntLE(h - 1, 7, 3);
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), chunk("VP8X", x), vp8, chunk("EXIF", buildExifTiff())]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

/** PNG 加 tEXt（如截图工具写入的软件名/时间） */
export function pngWithText(src = clean.png()) {
  const data = Buffer.from("Comment\0taken at home", "latin1");
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write("tEXt", 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([src.subarray(0, 33), head, data, crc, src.subarray(33)]); // IHDR 之后
}

/** Synthetic RGB PNG for aspect-ratio boundary tests; no metadata or external tools. */
export function pngSized(width, height) {
  const chunk = (name, data) => {
    const body = Buffer.concat([Buffer.from(name), data]);
    const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([size, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height, 160);
  for (let y = 0; y < height; y++) pixels[y * (width * 3 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

export const fakeHeic = () => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic\0\0\0\0mif1heic", "latin1"), Buffer.alloc(64)]);
export const fakeMov = () => Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from("ftypqt  \0\0\0\0qt  ", "latin1"), Buffer.alloc(64)]);
export const fakeGif = () => Buffer.concat([Buffer.from("GIF89a", "latin1"), Buffer.alloc(64)]);
export const animatedWebp = () => {
  const anim = Buffer.concat([Buffer.from("ANIM", "latin1"), Buffer.from([6, 0, 0, 0]), Buffer.alloc(6)]);
  const x = Buffer.concat([Buffer.from("VP8X", "latin1"), Buffer.from([10, 0, 0, 0]), Buffer.from([0x02]), Buffer.alloc(9)]);
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), x, anim]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
};
