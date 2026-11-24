type Cell = string | number | null | undefined;

function xml(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files: Record<string, string>): ArrayBuffer {
  const encoder = new TextEncoder();
  const entries = Object.entries(files).map(([name, text]) => ({ name: encoder.encode(name), data: encoder.encode(text) }));
  const size = entries.reduce((total, entry) => total + 30 + entry.name.length + entry.data.length + 46 + entry.name.length, 22);
  const buffer = new ArrayBuffer(size);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let offset = 0;
  const starts: number[] = [];
  for (const entry of entries) {
    starts.push(offset);
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 12, 33, true);
    view.setUint32(offset + 14, crc32(entry.data), true);
    view.setUint32(offset + 18, entry.data.length, true);
    view.setUint32(offset + 22, entry.data.length, true);
    view.setUint16(offset + 26, entry.name.length, true);
    bytes.set(entry.name, offset + 30);
    bytes.set(entry.data, offset + 30 + entry.name.length);
    offset += 30 + entry.name.length + entry.data.length;
  }
  const central = offset;
  entries.forEach((entry, index) => {
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 14, 33, true);
    view.setUint32(offset + 16, crc32(entry.data), true);
    view.setUint32(offset + 20, entry.data.length, true);
    view.setUint32(offset + 24, entry.data.length, true);
    view.setUint16(offset + 28, entry.name.length, true);
    view.setUint32(offset + 42, starts[index]!, true);
    bytes.set(entry.name, offset + 46);
    offset += 46 + entry.name.length;
  });
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 8, entries.length, true);
  view.setUint16(offset + 10, entries.length, true);
  view.setUint32(offset + 12, offset - central, true);
  view.setUint32(offset + 16, central, true);
  return buffer;
}

function colLetter(index: number): string {
  let n = index + 1;
  let result = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

export function buildExcelWorkbook(title: string, headers: string[], rows: Cell[][]): ArrayBuffer {
  const allRows: Cell[][] = [[title], headers, ...rows];
  const data = allRows
    .map((row, rowIndex) => {
      const rowNum = rowIndex + 1;
      const styleAttr = rowNum === 1 ? ` s="1"` : rowNum === 2 ? ` s="2"` : "";
      const cells = row
        .map((cell, colIndex) => {
          const ref = `${colLetter(colIndex)}${rowNum}`;
          if (typeof cell === "number" && Number.isFinite(cell)) {
            return `<c r="${ref}"${styleAttr} t="n"><v>${cell}</v></c>`;
          }
          return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${xml(String(cell ?? ""))}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowNum}">${cells}</row>`;
    })
    .join("");

  const colCount = Math.max(1, headers.length);
  const lastCol = colLetter(colCount - 1);
  let primaryDataRows = 0;
  for (const row of rows) {
    if (row.length === 0) break;
    primaryDataRows += 1;
  }
  const hasTable = headers.length > 0 && primaryDataRows > 0;
  const tableEndRow = 2 + primaryDataRows;
  const tableRef = `A2:${lastCol}${tableEndRow}`;

  const sheetViews =
    `<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;
  const sheetAutoFilter = !hasTable && headers.length > 0 ? `<autoFilter ref="A2:${lastCol}2"/>` : "";
  const sheetTableParts = hasTable ? `<tableParts count="1"><tablePart r:id="rId1"/></tableParts>` : "";

  const stylesXml =
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="3">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>` +
    `</cellXfs>` +
    `</styleSheet>`;

  const files: Record<string, string> = {
    "[Content_Types].xml":
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      (hasTable
        ? `<Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`
        : "") +
      `</Types>`,
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Penjualan" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels":
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`,
    "xl/styles.xml": stylesXml,
    "xl/worksheets/sheet1.xml":
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `${sheetViews}<sheetData>${data}</sheetData>${sheetAutoFilter}${sheetTableParts}</worksheet>`,
  };

  if (hasTable) {
    const usedNames = new Set<string>();
    const tableColumns = headers
      .map((header, index) => {
        const base = header.trim() || `Kolom ${index + 1}`;
        let name = base;
        let suffix = 2;
        while (usedNames.has(name.toLowerCase())) {
          name = `${base} ${suffix}`;
          suffix += 1;
        }
        usedNames.add(name.toLowerCase());
        return `<tableColumn id="${index + 1}" name="${xml(name)}"/>`;
      })
      .join("");
    files["xl/worksheets/_rels/sheet1.xml.rels"] =
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/></Relationships>`;
    files["xl/tables/table1.xml"] =
      `<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="TabelLaporan" displayName="TabelLaporan" ref="${tableRef}" totalsRowShown="0">` +
      `<autoFilter ref="${tableRef}"/>` +
      `<tableColumns count="${headers.length}">${tableColumns}</tableColumns>` +
      `<tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/>` +
      `</table>`;
  }

  return zip(files);
}
