# Bukti Uji QA — TASK-006 (Sintetis / Development)

| Atribut | Nilai |
|---|---|
| Tanggal | 2026-11-13T16:42:57.415Z |
| Mesin / Runtime | win32 10.0.22631 (x64), Node v24.18.0 |
| Reviewer | David (pengganti Naazmi) |
| Perintah / Aksi | `node backend/qa/qa_runner.ts evidence --db C:\Users\USER\AppData\Local/Temp/pos-qa-final.sqlite` |
| Hasil Nyata | **PASS** |
| DB Path | `C:\Users\USER\AppData\Local/Temp/pos-qa-final.sqlite` |
| Schema user_version | 1 |
| PRAGMA integrity_check | `ok` |
| PRAGMA foreign_key_check | 0 pelanggaran |

## Snapshot Jumlah Baris SQLite
```json
{
  "users": 4,
  "categories": 3,
  "suppliers": 2,
  "products": 8,
  "product_barcodes": 8,
  "shifts": 2,
  "shift_closings": 1,
  "shift_closing_totals": 2,
  "checkout_attempts": 4,
  "sales": 3,
  "sale_items": 3,
  "payments": 3,
  "inventory_movements": 10,
  "audit_log": 2
}
```

## Snapshot Saldo Stok & Barcode Nol Awal
| ID | SKU | Barcode | Harga | On Hand |
|---|---|---|---|---|
| 1 | DEMO-001 | `0000000000017` | Rp3000 | 22 |
| 2 | DEMO-002 | `8991234567890` | Rp4000 | 12 |
| 3 | DEMO-003 | `0000000000034` | Rp5000 | 7 |
| 4 | DEMO-004 | `8999876543210` | Rp15000 | 5 |
| 5 | QA-STOK-0 | `0000000000058` | Rp2000 | 0 |
| 6 | QA-STOK-1 | `0000000000065` | Rp4500 | 1 |
| 7 | QA-STOK-10 | `0000000000072` | Rp7500 | 10 |
| 8 | QA-HARGA-UBAH | `0000000000089` | Rp6000 | 9 |

## Snapshot Shift (Nilai)
| shiftId | cashierId | closedAtMs | openingCashRp |
|---|---|---|---|
| 101 | 2 | 1762999200000 | 100000 |
| 102 | 3 | (aktif) | 100000 |

## Penutupan Shift (declared/variance)
| shiftId | declaredCashRp | varianceRp |
|---|---|---|
| 101 | 106000 | 0 |

## Rekap per Metode Pembayaran (shift closing)
| shiftId | methodCode | amountRp |
|---|---|---|
| 101 | CASH | Rp6000 |
| 101 | QRIS_MANUAL | Rp10000 |

## Checkout Attempt Belum Tersimpan (PREPARED)
| attemptKey | shiftId | hasSale |
|---|---|---|
| attempt-qa-prepared-1 | 102 | 0 |

## Pembayaran (metode, nominal, verifikasi QRIS)
| id | saleId | methodCode | amountRp | evidenceRef | verifiedBy |
|---|---|---|---|---|---|
| 1 | 201 | CASH | Rp6000 | - | - |
| 2 | 202 | QRIS_MANUAL | Rp5000 | DEMO-QRIS-REF-001 | 2 |
| 3 | 203 | QRIS_MANUAL | Rp5000 | DEMO-QRIS-REF-002 | 2 |

## Expected Values (Acuan Oracle)
```json
{
  "userVersion": 1,
  "counts": {
    "users": 4,
    "categories": 3,
    "suppliers": 2,
    "products": 8,
    "product_barcodes": 8,
    "shifts": 2,
    "shift_closings": 1,
    "shift_closing_totals": 2,
    "checkout_attempts": 4,
    "sales": 3,
    "sale_items": 3,
    "payments": 3,
    "inventory_movements": 10,
    "audit_log": 2
  },
  "stockBalances": [
    {
      "productId": 1,
      "sku": "DEMO-001",
      "barcode": "0000000000017",
      "priceRp": 3000,
      "onHand": 22
    },
    {
      "productId": 2,
      "sku": "DEMO-002",
      "barcode": "8991234567890",
      "priceRp": 4000,
      "onHand": 12
    },
    {
      "productId": 3,
      "sku": "DEMO-003",
      "barcode": "0000000000034",
      "priceRp": 5000,
      "onHand": 7
    },
    {
      "productId": 4,
      "sku": "DEMO-004",
      "barcode": "8999876543210",
      "priceRp": 15000,
      "onHand": 5
    },
    {
      "productId": 5,
      "sku": "QA-STOK-0",
      "barcode": "0000000000058",
      "priceRp": 2000,
      "onHand": 0
    },
    {
      "productId": 6,
      "sku": "QA-STOK-1",
      "barcode": "0000000000065",
      "priceRp": 4500,
      "onHand": 1
    },
    {
      "productId": 7,
      "sku": "QA-STOK-10",
      "barcode": "0000000000072",
      "priceRp": 7500,
      "onHand": 10
    },
    {
      "productId": 8,
      "sku": "QA-HARGA-UBAH",
      "barcode": "0000000000089",
      "priceRp": 6000,
      "onHand": 9
    }
  ],
  "shifts": {
    "closedShiftId": 101,
    "closedShiftOpeningCashRp": 100000,
    "closedShiftCashTotalRp": 6000,
    "closedShiftQrisTotalRp": 10000,
    "closedShiftDeclaredCashRp": 106000,
    "closedShiftVarianceRp": 0,
    "activeShiftId": 102,
    "activeShiftCashierId": 3
  },
  "preparedAttemptKey": "attempt-qa-prepared-1",
  "shiftClosingTotals": [
    {
      "shiftId": 101,
      "methodCode": "CASH",
      "amountRp": 6000
    },
    {
      "shiftId": 101,
      "methodCode": "QRIS_MANUAL",
      "amountRp": 10000
    }
  ],
  "closedShiftSummary": [
    {
      "shiftId": 101,
      "declaredCashRp": 106000,
      "varianceRp": 0
    }
  ],
  "preparedAttemptsWithoutSale": [
    {
      "attemptKey": "attempt-qa-prepared-1",
      "shiftId": 102,
      "hasSale": 0
    }
  ],
  "payments": [
    {
      "id": 1,
      "saleId": 201,
      "methodCode": "CASH",
      "amountRp": 6000,
      "evidenceRef": null,
      "verifiedBy": null
    },
    {
      "id": 2,
      "saleId": 202,
      "methodCode": "QRIS_MANUAL",
      "amountRp": 5000,
      "evidenceRef": "DEMO-QRIS-REF-001",
      "verifiedBy": 2
    },
    {
      "id": 3,
      "saleId": 203,
      "methodCode": "QRIS_MANUAL",
      "amountRp": 5000,
      "evidenceRef": "DEMO-QRIS-REF-002",
      "verifiedBy": 2
    }
  ]
}
```
