import assert from 'node:assert/strict';
import { test } from 'node:test';
import zlib from 'node:zlib';

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(entries: Array<{ name: string; content: string }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const rawBuf = Buffer.from(entry.content, 'utf8');
    const compressed = zlib.deflateRawSync(rawBuf);
    const sum = crc32(rawBuf);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(sum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(rawBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(rawBuf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);

    centralParts.push(central, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

function buildMinimalXlsx(sheets: Array<{ name: string; rows: Array<Array<string | number>> }>): ArrayBuffer {
  const xmlEscape = (v: string) =>
    v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const files: Array<{ name: string; content: string }> = [
    {
      name: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        sheets.map((_, idx) =>
          `<Override PartName="/xl/worksheets/sheet${idx + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
        ).join('') +
        `</Types>`,
    },
    {
      name: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      content: `<?xml version="1.0" encoding="UTF-8"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets>` +
        sheets.map((s, idx) => `<sheet name="${xmlEscape(s.name)}" sheetId="${idx + 1}" r:id="rId${idx + 1}"/>`).join('') +
        `</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheets.map((_, idx) =>
          `<Relationship Id="rId${idx + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${idx + 1}.xml"/>`
        ).join('') +
        `</Relationships>`,
    },
  ];

  sheets.forEach((sheet, idx) => {
    const rowsXml = sheet.rows.map((row, rIdx) => {
      const cells = row.map((val, cIdx) => {
        const ref = `${String.fromCharCode(65 + cIdx)}${rIdx + 1}`;
        if (typeof val === 'number') {
          return `<c r="${ref}"><v>${val}</v></c>`;
        }
        return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(String(val))}</t></is></c>`;
      }).join('');
      return `<row r="${rIdx + 1}">${cells}</row>`;
    }).join('');

    files.push({
      name: `xl/worksheets/sheet${idx + 1}.xml`,
      content: `<?xml version="1.0" encoding="UTF-8"?>` +
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`,
    });
  });

  const buf = createStoredZip(files);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

test('parseDelimitedText preserves literal hyphenated bib numbers and handles RFC-4180 quotes and caps', async () => {
  const { parseDelimitedText } = await import('../src/lib/spreadsheet');
  const csv = '\uFEFFFull Name,Race Bib Number,Distance\r\n"Dela Cruz, Juan",12-20-01,10K\r\n"Santos, ""Ana""",05-002,"5K\nFun Run"\r\n';
  const rows = parseDelimitedText(csv, { maxRows: 10 });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], ['Full Name', 'Race Bib Number', 'Distance']);
  assert.deepEqual(rows[1], ['Dela Cruz, Juan', '12-20-01', '10K']);
  assert.deepEqual(rows[2], ['Santos, "Ana"', '05-002', '5K\nFun Run']);

  const capped = parseDelimitedText('a,b\n1,2\n3,4\n5,6\n', { maxRows: 2 });
  assert.equal(capped.length, 2);
});

test('sheetRowsToObjects converts 2D rows while stripping prototype pollution keys', async () => {
  const { sheetRowsToObjects } = await import('../src/lib/spreadsheet');
  const objs = sheetRowsToObjects([
    ['Full Name', '__proto__', 'Race Bib Number', 'constructor', 'prototype'],
    ['Maria', 'evil1', '5-001', 'evil2', 'evil3'],
  ]);
  assert.equal(objs.length, 1);
  assert.equal(objs[0]['Full Name'], 'Maria');
  assert.equal(objs[0]['Race Bib Number'], '5-001');
  assert.equal(Object.hasOwn(objs[0], '__proto__'), false);
  assert.equal(Object.hasOwn(objs[0], 'constructor'), false);
  assert.equal(Object.hasOwn(objs[0], 'prototype'), false);
});

test('readSpreadsheetSheets parses CSV, TSV, multi-sheet .xlsx workbooks, and rejects legacy binary .xls', async () => {
  const { readSpreadsheetSheets } = await import('../src/lib/spreadsheet');

  const csvBuf = Buffer.from('Full Name,Bib\nJuan,12-20-01\n', 'utf8');
  const csvSheets = await readSpreadsheetSheets(csvBuf, 'roster.csv');
  assert.equal(csvSheets.length, 1);
  assert.equal(csvSheets[0].rows[1][1], '12-20-01');

  const tsvBuf = Buffer.from('Full Name\tBib\nAna\t10-009\n', 'utf8');
  const tsvSheets = await readSpreadsheetSheets(tsvBuf, 'roster.tsv');
  assert.equal(tsvSheets.length, 1);
  assert.deepEqual(tsvSheets[0].rows[1], ['Ana', '10-009']);

  const xlsxBuf = buildMinimalXlsx([
    { name: 'Summary', rows: [['Info'], ['Header Only']] },
    { name: 'Bib Assignment', rows: [['Full Name', 'Race Bib Number', 'Distance'], ['Pedro', '12-20-01', '10K']] },
  ]);
  const xlsxSheets = await readSpreadsheetSheets(xlsxBuf, 'race.xlsx');
  assert.equal(xlsxSheets.length, 2);
  assert.equal(xlsxSheets[1].sheet, 'Bib Assignment');
  assert.deepEqual(xlsxSheets[1].rows[1], ['Pedro', '12-20-01', '10K']);

  await assert.rejects(
    () => readSpreadsheetSheets(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]), 'old-roster.xls'),
    /\.xlsx or \.csv/i,
  );
});
