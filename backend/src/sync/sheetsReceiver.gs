function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Formatting is best-effort and never affects transaction acknowledgement.
function formatSalesSheet(sheet) {
  try {
    var lastRow = sheet.getLastRow();
    sheet.getRange(1, 1, 1, 6).setBackground("#267349").setFontColor("#ffffff").setFontWeight("bold");
    sheet.setFrozenRows(1);
    var dataRows = Math.max(0, lastRow - 1);
    if (dataRows) {
      var backgrounds = [];
      for (var i = 0; i < dataRows; i++) backgrounds.push(Array(6).fill(i % 2 ? "#f1f8f3" : "#ffffff"));
      sheet.getRange(2, 1, dataRows, 6).setBackgrounds(backgrounds);
    }
    var availableRows = Math.max(1, sheet.getMaxRows() - 1);
    sheet.getRange(2, 1, availableRows, 1).setNumberFormat("dd/MM/yyyy HH:mm:ss");
    sheet.getRange(2, 4, availableRows, 1).setNumberFormat('"Rp" #,##0');
    sheet.getRange(2, 6, availableRows, 1).setWrap(true);
    if (!sheet.getFilter()) sheet.getRange(1, 1, sheet.getMaxRows(), 6).createFilter();
    sheet.autoResizeColumns(1, 6);
    for (var col = 1; col <= 6; col++) if (sheet.getColumnWidth(col) > 360) sheet.setColumnWidth(col, 360);
  } catch (_) { /* A format error must not change the saved sale result. */ }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    var raw = e && e.postData && e.postData.contents;
    if (typeof raw !== "string" || raw.length > 65536) return jsonResponse({ ok: false });
    var body = JSON.parse(raw);
    var properties = PropertiesService.getScriptProperties();
    var expectedSecret = properties.getProperty("WEBHOOK_SECRET") || "";
    if (!expectedSecret || !body || typeof body !== "object" || Array.isArray(body) || body.secret !== expectedSecret) return jsonResponse({ ok: false });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return jsonResponse({ ok: false });
    var sheet = ss.getSheetByName("Penjualan");
    if (!sheet || sheet.getLastRow() < 1) return jsonResponse({ ok: false });
    var headers = sheet.getRange(1, 1, 1, 6).getValues()[0];
    var expectedHeaders = ["Waktu", "No Struk", "Kasir", "Total Rp", "Metode", "Barang"];
    if (expectedHeaders.some(function(value, index) { return String(headers[index]).trim() !== value; })) return jsonResponse({ ok: false });
    if (body.operation === "ping") return jsonResponse({ ok: true, operation: "ping" });
    var saleNo = typeof body.saleNo === "string" ? body.saleNo.trim() : "";
    var modern = body.operation === "sale";
    if (!saleNo || saleNo.length > 160 || (body.operation !== undefined && !modern) || typeof body.cashier !== "string" || !body.cashier.trim() || body.cashier.length > 160 || !Number.isSafeInteger(body.totalRp) || body.totalRp < 0 || ["CASH", "QRIS_MANUAL"].indexOf(body.method) === -1 || !Number.isSafeInteger(body.committedAtMs) || body.committedAtMs < 0 || typeof body.items !== "string" || body.items.length > 30000) return jsonResponse({ ok: false });
    if (modern && (typeof body.databaseNamespace !== "string" || !/^[A-Za-z0-9_-]{16,100}$/.test(body.databaseNamespace) || typeof body.attemptKey !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(body.attemptKey))) return jsonResponse({ ok: false });
    lock.waitLock(15000); locked = true;
    if (modern) {
      var namespace = properties.getProperty("DATABASE_NAMESPACE");
      if (namespace && namespace !== body.databaseNamespace) return jsonResponse({ ok: false, error: "namespace berbeda" });
      if (!namespace) properties.setProperty("DATABASE_NAMESPACE", body.databaseNamespace);
    }
    var safe = function(value) { return typeof value === "string" && /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? "'" + value : value; };
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var rows = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i][1]).trim() === saleNo || String(rows[i][1]).trim() === safe(saleNo)) {
          if (!modern) { formatSalesSheet(sheet); return jsonResponse({ ok: true, duplicate: true }); }
          var time = rows[i][0] instanceof Date ? rows[i][0].getTime() : new Date(rows[i][0]).getTime();
          var sameText = function(stored, raw) { return String(stored) === raw || String(stored) === safe(raw); };
          // Apps Script reads Sheets date cells at second precision. Compare at
          // that precision while still rejecting differences in all other fields.
          var same = Math.floor(time / 1000) === Math.floor(body.committedAtMs / 1000) && sameText(rows[i][2], body.cashier) && Number(rows[i][3]) === body.totalRp && String(rows[i][4]) === body.method && sameText(rows[i][5], body.items);
          if (same) formatSalesSheet(sheet);
          return jsonResponse(same ? { ok: true, duplicate: true } : { ok: false, error: "nomor struk sudah digunakan" });
        }
      }
    }
    sheet.appendRow([new Date(body.committedAtMs), safe(saleNo), safe(body.cashier), body.totalRp, body.method, safe(body.items)]);
    SpreadsheetApp.flush();
    formatSalesSheet(sheet);
    return jsonResponse({ ok: true, duplicate: false });
  } catch (_) { return jsonResponse({ ok: false }); }
  finally { if (locked) { try { lock.releaseLock(); } catch (_) {} } }
}
