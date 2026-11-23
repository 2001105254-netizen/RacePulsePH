import { MAX_ROSTER_ROWS, MAX_ROSTER_SHEETS, stripUnsafeKeys } from './security';

export interface SpreadsheetSheet {
  sheet: string;
  rows: unknown[][];
}

export interface DelimitedParseOptions {
  delimiter?: string;
  maxRows?: number;
  maxCols?: number;
}

export interface SpreadsheetReadOptions {
  maxSheets?: number;
  maxRows?: number;
}

const UNSAFE_HEADERS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * RFC-4180 delimited text parser preserving literal strings (e.g., bib `12-20-01`)
 * without automatic date coercion.
 */
export function parseDelimitedText(
  rawText: string,
  { delimiter, maxRows = MAX_ROSTER_ROWS + 1, maxCols = 64 }: DelimitedParseOptions = {},
): string[][] {
  const text = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;
  if (!text.length) return [];

  const sep = delimiter || (text.slice(0, 1024).includes('\t') && !text.slice(0, 1024).includes(',') ? '\t' : ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field.length === 0) {
      inQuotes = true;
      continue;
    }

    if (ch === sep) {
      if (row.length < maxCols) {
        row.push(field);
      }
      field = '';
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') {
        i += 1;
      }
      if (row.length < maxCols) {
        row.push(field);
      }
      rows.push(row);
      if (rows.length >= maxRows) {
        return rows;
      }
      row = [];
      field = '';
      continue;
    }

    field += ch;
  }

  if (field.length > 0 || row.length > 0) {
    if (row.length < maxCols) {
      row.push(field);
    }
    rows.push(row);
  }

  return rows.slice(0, maxRows);
}

export function sheetRowsToObjects(
  rows: unknown[][],
  { maxRows = MAX_ROSTER_ROWS }: { maxRows?: number } = {},
): Record<string, unknown>[] {
  if (!rows.length) return [];
  const headers = (rows[0] || []).map((cell) => String(cell ?? '').trim());
  const out: Record<string, unknown>[] = [];

  for (const rawRow of rows.slice(1, maxRows + 1)) {
    const hasContent = rawRow.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '');
    if (!hasContent) continue;

    const record: Record<string, unknown> = {};
    headers.forEach((header, idx) => {
      if (!header || UNSAFE_HEADERS.has(header)) return;
      const cell = idx < rawRow.length ? rawRow[idx] : '';
      record[header] = cell === null || cell === undefined ? '' : cell;
    });
    out.push(stripUnsafeKeys(record));
  }

  return out;
}

async function toArrayBuffer(input: Blob | ArrayBuffer | Uint8Array): Promise<ArrayBuffer> {
  if (input instanceof ArrayBuffer) return input;
  if (ArrayBuffer.isView(input)) {
    const copy = new Uint8Array(input.byteLength);
    copy.set(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
    return copy.buffer;
  }
  return input.arrayBuffer();
}

export async function readSpreadsheetSheets(
  input: File | Blob | ArrayBuffer | Uint8Array,
  fileName: string,
  { maxSheets = MAX_ROSTER_SHEETS, maxRows = MAX_ROSTER_ROWS + 1 }: SpreadsheetReadOptions = {},
): Promise<SpreadsheetSheet[]> {
  if (/\.xls$/i.test(fileName)) {
    throw new Error('Legacy binary .xls files are not supported. Save legacy .xls files as .xlsx or .csv before importing.');
  }

  const buffer = await toArrayBuffer(input);

  if (/\.(csv|tsv)$/i.test(fileName)) {
    const text = new TextDecoder('utf-8').decode(buffer);
    const delimiter = /\.tsv$/i.test(fileName) ? '\t' : ',';
    const rows = stripUnsafeKeys(parseDelimitedText(text, { delimiter, maxRows }));
    return rows.length > 0 ? [{ sheet: 'Roster', rows }] : [];
  }

  const { default: readXlsxFile } = await import('read-excel-file/universal');
  const rawSheets = await readXlsxFile(buffer);
  return rawSheets.slice(0, maxSheets).map((entry) => ({
    sheet: String(entry.sheet || 'Sheet1'),
    rows: stripUnsafeKeys(
      (entry.data || [])
        .slice(0, maxRows)
        .map((r) => r.map((cell) => (cell === null || cell === undefined ? '' : cell))),
    ),
  }));
}
