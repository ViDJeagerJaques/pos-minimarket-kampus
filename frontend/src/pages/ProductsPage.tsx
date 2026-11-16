import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../api/errors";
import type {
  CatalogProduct,
  CategorySummary,
  PosDataSource,
  SessionUser,
  SupplierSummary,
} from "../api/types";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MoneyText } from "../components/MoneyText";
import { StatusMessage, type StatusTone } from "../components/StatusMessage";

interface ProductsPageProps {
  dataSource: PosDataSource;
  currentUser: SessionUser;
  /** Dipanggil saat backend menjawab 401: App wajib membersihkan sesi dan kembali ke login. */
  onSessionExpired: () => void;
}

type Status = { tone: StatusTone; text: string };

type EditState = {
  product: CatalogProduct;
  name: string;
  price: string;
  categoryId: string;
  newBarcode: string;
};

type Confirmation =
  | { kind: "toggle"; product: CatalogProduct; nextActive: boolean }
  | { kind: "remove-barcode"; product: CatalogProduct; barcode: string }
  | { kind: "create-product" };

const MAX_PRODUCTS = 100;

/** Pisahkan input barcode menjadi string; JANGAN memakai Number agar nol awal tetap. */
export function parseBarcodeInput(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of raw.split(/[\n,;]+/)) {
    const value = part.trim();
    if (value.length === 0 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function parsePrice(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function sortProducts(products: CatalogProduct[]): CatalogProduct[] {
  return [...products].sort((left, right) => left.sku.localeCompare(right.sku, "id"));
}

/**
 * Katalog ADMIN (TASK-012): kategori, supplier, produk, barcode, dan harga.
 * Otorisasi sesungguhnya tetap di backend; menyembunyikan menu bukan izin
 * (DEC-014). CASHIER yang memanggil endpoint tulis menerima 403.
 * Halaman ini TIDAK membuat penjualan, pembayaran, atau mutasi stok; keranjang
 * kasir tetap draft lokal di `domain/cart.ts`.
 */
export function ProductsPage({ dataSource, currentUser, onSessionExpired }: ProductsPageProps) {
  const [categories, setCategories] = useState<CategorySummary[] | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierSummary[] | null>(null);
  const [products, setProducts] = useState<CatalogProduct[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [appliedQuery, setAppliedQuery] = useState("");

  const [status, setStatus] = useState<Status | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyProductId, setBusyProductId] = useState<number | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);

  // Form produk baru.
  const [newSku, setNewSku] = useState("");
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newCategoryId, setNewCategoryId] = useState("");
  const [newSupplierIds, setNewSupplierIds] = useState<number[]>([]);
  const [newBarcodes, setNewBarcodes] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [supplierName, setSupplierName] = useState("");

  const submitLockRef = useRef(false);
  const listSeqRef = useRef(0);

  const skuId = useId();
  const nameId = useId();
  const priceId = useId();
  const categoryId = useId();
  const supplierId = useId();
  const barcodeId = useId();
  const searchId = useId();

  const handleActionError = useCallback(
    (error: unknown, fallback: string) => {
      if (error instanceof ApiError && error.isSessionExpired) {
        onSessionExpired();
        return;
      }
      setStatus({ tone: "danger", text: error instanceof ApiError ? error.message : fallback });
    },
    [onSessionExpired],
  );

  useEffect(() => {
    let isActive = true;
    const seq = ++listSeqRef.current;
    setIsLoading(true);
    Promise.all([
      dataSource.listCategories(),
      dataSource.listSuppliers(),
      dataSource.listCatalogProducts({
        query: appliedQuery || undefined,
        includeInactive: true,
        limit: MAX_PRODUCTS,
      }),
    ])
      .then(([categoryRows, supplierRows, productRows]) => {
        if (!isActive || seq !== listSeqRef.current) return;
        setCategories(categoryRows);
        setSuppliers(supplierRows);
        setProducts(sortProducts(productRows));
        setLoadError(null);
        setNewCategoryId((previous) =>
          previous === "" && categoryRows[0] ? String(categoryRows[0].id) : previous,
        );
      })
      .catch((error: unknown) => {
        if (!isActive || seq !== listSeqRef.current) return;
        if (error instanceof ApiError && error.isSessionExpired) {
          onSessionExpired();
          return;
        }
        setLoadError(error instanceof ApiError ? error.message : "Katalog gagal dimuat.");
      })
      .finally(() => {
        if (isActive && seq === listSeqRef.current) setIsLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [dataSource, reloadKey, appliedQuery, onSessionExpired]);

  function invalidatePendingReadsAndRefresh(): void {
    listSeqRef.current += 1;
    setReloadKey((previous) => previous + 1);
  }

  function replaceProduct(updated: CatalogProduct): void {
    setProducts((previous) =>
      previous === null
        ? previous
        : sortProducts(previous.map((item) => (item.id === updated.id ? updated : item))),
    );
    setEdit((previous) =>
      previous !== null && previous.product.id === updated.id
        ? { ...previous, product: updated }
        : previous,
    );
  }

  async function handleCreateProduct(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitLockRef.current) return;
    const sku = newSku.trim();
    const name = newName.trim();
    const priceRp = parsePrice(newPrice);
    const categoryIdNumber = Number(newCategoryId);
    if (sku.length === 0 || name.length === 0) {
      setStatus({ tone: "danger", text: "SKU dan nama produk wajib diisi." });
      return;
    }
    if (priceRp === null) {
      setStatus({ tone: "danger", text: "Harga harus bilangan rupiah bulat dan tidak negatif." });
      return;
    }
    if (!Number.isSafeInteger(categoryIdNumber) || categoryIdNumber <= 0) {
      setStatus({ tone: "danger", text: "Pilih kategori produk terlebih dahulu." });
      return;
    }
    setConfirmation({ kind: "create-product" });
  }

  async function confirmCreateProduct(): Promise<void> {
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setIsSubmitting(true);
    try {
      const created = await dataSource.createProduct({
        categoryId: Number(newCategoryId),
        sku: newSku.trim(),
        name: newName.trim(),
        priceRp: parsePrice(newPrice) ?? 0,
        barcodes: parseBarcodeInput(newBarcodes),
        supplierIds: newSupplierIds,
      });
      setProducts((previous) => sortProducts([...(previous ?? []), created]));
      invalidatePendingReadsAndRefresh();
      setNewSku("");
      setNewName("");
      setNewPrice("");
      setNewSupplierIds([]);
      setNewBarcodes("");
      setStatus({
        tone: "success",
        text: `Produk "${created.sku}" tersimpan. Barcode disimpan sebagai teks: ${
          created.barcodes.length > 0 ? created.barcodes.join(", ") : "belum ada"
        }.`,
      });
      setConfirmation(null);
    } catch (error) {
      setConfirmation(null);
      handleActionError(error, "Produk gagal disimpan.");
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function handleSaveEdit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (edit === null || submitLockRef.current) return;
    const priceRp = parsePrice(edit.price);
    if (edit.name.trim().length === 0) {
      setStatus({ tone: "danger", text: "Nama produk wajib diisi." });
      return;
    }
    if (priceRp === null) {
      setStatus({ tone: "danger", text: "Harga harus bilangan rupiah bulat dan tidak negatif." });
      return;
    }
    const nextCategoryId = Number(edit.categoryId);
    if (!Number.isSafeInteger(nextCategoryId) || nextCategoryId <= 0) {
      setStatus({ tone: "danger", text: "Kategori tidak valid." });
      return;
    }
    submitLockRef.current = true;
    setIsSubmitting(true);
    setBusyProductId(edit.product.id);
    try {
      const updated = await dataSource.updateProduct(edit.product.id, {
        name: edit.name.trim(),
        priceRp,
        categoryId: nextCategoryId,
      });
      replaceProduct(updated);
      invalidatePendingReadsAndRefresh();
      setEdit(null);
      setStatus({ tone: "success", text: `Produk "${updated.sku}" diperbarui.` });
    } catch (error) {
      handleActionError(error, "Perubahan produk gagal disimpan.");
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
      setBusyProductId(null);
    }
  }

  async function handleAddBarcode(): Promise<void> {
    if (edit === null || submitLockRef.current) return;
    const barcode = edit.newBarcode.trim();
    if (barcode.length === 0) {
      setStatus({ tone: "danger", text: "Barcode wajib diisi." });
      return;
    }
    submitLockRef.current = true;
    setBusyProductId(edit.product.id);
    try {
      // Dikirim sebagai string; jangan konversi ke angka agar nol awal aman.
      const updated = await dataSource.addBarcode(edit.product.id, barcode);
      replaceProduct(updated);
      invalidatePendingReadsAndRefresh();
      setEdit((previous) => (previous === null ? previous : { ...previous, newBarcode: "" }));
      setStatus({ tone: "success", text: `Barcode "${barcode}" ditambahkan ke ${updated.sku}.` });
    } catch (error) {
      handleActionError(error, "Barcode gagal ditambahkan.");
    } finally {
      submitLockRef.current = false;
      setBusyProductId(null);
    }
  }

  async function handleCreateCategory(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const name = categoryName.trim();
    if (name.length === 0 || submitLockRef.current) return;
    submitLockRef.current = true;
    setIsSubmitting(true);
    try {
      const created = await dataSource.createCategory(name);
      setCategories((previous) => [...(previous ?? []), created]);
      invalidatePendingReadsAndRefresh();
      setCategoryName("");
      setNewCategoryId((previous) => (previous === "" ? String(created.id) : previous));
      setStatus({ tone: "success", text: `Kategori "${created.name}" dibuat.` });
    } catch (error) {
      handleActionError(error, "Kategori gagal dibuat.");
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function handleCreateSupplier(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const name = supplierName.trim();
    if (name.length === 0 || submitLockRef.current) return;
    submitLockRef.current = true;
    setIsSubmitting(true);
    try {
      const created = await dataSource.createSupplier(name);
      setSuppliers((previous) => [...(previous ?? []), created]);
      invalidatePendingReadsAndRefresh();
      setSupplierName("");
      setStatus({ tone: "success", text: `Supplier "${created.name}" dibuat.` });
    } catch (error) {
      handleActionError(error, "Supplier gagal dibuat.");
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function confirmToggle(): Promise<void> {
    if (confirmation?.kind !== "toggle") return;
    const { product, nextActive } = confirmation;
    setBusyProductId(product.id);
    try {
      const updated = await dataSource.updateProduct(product.id, { active: nextActive });
      replaceProduct(updated);
      invalidatePendingReadsAndRefresh();
      setStatus({
        tone: "success",
        text: `Produk "${updated.sku}" ${updated.active ? "diaktifkan" : "dinonaktifkan"}.`,
      });
      setConfirmation(null);
    } catch (error) {
      setConfirmation(null);
      handleActionError(error, "Status produk gagal diubah.");
    } finally {
      setBusyProductId(null);
    }
  }

  async function confirmRemoveBarcode(): Promise<void> {
    if (confirmation?.kind !== "remove-barcode") return;
    const { product, barcode } = confirmation;
    setBusyProductId(product.id);
    try {
      const updated = await dataSource.removeBarcode(product.id, barcode);
      replaceProduct(updated);
      invalidatePendingReadsAndRefresh();
      setStatus({ tone: "success", text: `Barcode "${barcode}" dihapus dari ${updated.sku}.` });
      setConfirmation(null);
    } catch (error) {
      setConfirmation(null);
      handleActionError(error, "Barcode gagal dihapus.");
    } finally {
      setBusyProductId(null);
    }
  }

  function handleConfirm(): void {
    if (confirmation === null) return;
    if (confirmation.kind === "create-product") {
      void confirmCreateProduct();
      return;
    }
    if (confirmation.kind === "toggle") {
      void confirmToggle();
      return;
    }
    void confirmRemoveBarcode();
  }

  function toggleSupplier(idValue: number): void {
    setNewSupplierIds((previous) =>
      previous.includes(idValue)
        ? previous.filter((item) => item !== idValue)
        : [...previous, idValue],
    );
  }

  const canCreateProduct = categories !== null && categories.length > 0;

  return (
    <section className="panel" aria-labelledby="products-title" aria-busy={isLoading}>
      <h1 id="products-title" className="page-title">
        Barang/Stok <span className="chip chip--warning">ADMIN · katalog</span>
      </h1>
      <p className="muted">
        Masuk sebagai <strong>{currentUser.username}</strong>. Backend memeriksa role ADMIN pada
        setiap perubahan; CASHIER yang memanggil endpoint tulis menerima <strong>403</strong>.
        Halaman ini tidak membuat penjualan atau mutasi stok.
      </p>
      {dataSource.catalogMode === "DEMO" && (
        <StatusMessage
          tone="warning"
          text="Mode DEMO menampilkan katalog sintetis. Simpan produk/kategori/supplier memerlukan backend lokal dan tidak menyamar sebagai sukses."
        />
      )}

      <div className="catalog-grid">
        <form className="catalog-form" onSubmit={handleCreateCategory} aria-label="Buat kategori">
          <h2 className="section-title">Kategori</h2>
          <label htmlFor={`${categoryId}-new`} className="field-label">
            Nama kategori baru
          </label>
          <input
            id={`${categoryId}-new`}
            className="input"
            type="text"
            maxLength={120}
            value={categoryName}
            onChange={(event) => setCategoryName(event.target.value)}
            disabled={isSubmitting}
          />
          <Button type="submit" disabled={isSubmitting || categoryName.trim().length === 0}>
            Tambah kategori
          </Button>
          <ul className="catalog-list" aria-label="Daftar kategori">
            {(categories ?? []).map((item) => (
              <li key={item.id}>{item.name}</li>
            ))}
          </ul>
        </form>

        <form className="catalog-form" onSubmit={handleCreateSupplier} aria-label="Buat supplier">
          <h2 className="section-title">Supplier</h2>
          <label htmlFor={`${supplierId}-new`} className="field-label">
            Nama supplier baru
          </label>
          <input
            id={`${supplierId}-new`}
            className="input"
            type="text"
            maxLength={120}
            value={supplierName}
            onChange={(event) => setSupplierName(event.target.value)}
            disabled={isSubmitting}
          />
          <Button type="submit" disabled={isSubmitting || supplierName.trim().length === 0}>
            Tambah supplier
          </Button>
          <ul className="catalog-list" aria-label="Daftar supplier">
            {(suppliers ?? []).map((item) => (
              <li key={item.id}>{item.name}</li>
            ))}
          </ul>
        </form>
      </div>

      <form className="product-form" onSubmit={handleCreateProduct} aria-label="Buat produk" noValidate>
        <h2 className="section-title">Produk baru</h2>
        {!canCreateProduct && !isLoading && (
          <p className="muted">Buat minimal satu kategori sebelum menambah produk.</p>
        )}
        <div className="form-grid">
          <div>
            <label htmlFor={skuId} className="field-label">
              SKU
            </label>
            <input
              id={skuId}
              className="input"
              type="text"
              maxLength={64}
              autoComplete="off"
              value={newSku}
              onChange={(event) => setNewSku(event.target.value)}
              disabled={isSubmitting || !canCreateProduct}
              required
            />
          </div>
          <div>
            <label htmlFor={nameId} className="field-label">
              Nama produk
            </label>
            <input
              id={nameId}
              className="input"
              type="text"
              maxLength={120}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              disabled={isSubmitting || !canCreateProduct}
              required
            />
          </div>
          <div>
            <label htmlFor={priceId} className="field-label">
              Harga (Rp)
            </label>
            <input
              id={priceId}
              className="input"
              type="text"
              inputMode="numeric"
              value={newPrice}
              onChange={(event) => setNewPrice(event.target.value)}
              disabled={isSubmitting || !canCreateProduct}
              required
            />
          </div>
          <div>
            <label htmlFor={categoryId} className="field-label">
              Kategori
            </label>
            <select
              id={categoryId}
              className="input"
              value={newCategoryId}
              onChange={(event) => setNewCategoryId(event.target.value)}
              disabled={isSubmitting || !canCreateProduct}
              required
            >
              <option value="">Pilih kategori…</option>
              {(categories ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <fieldset className="catalog-fieldset" disabled={isSubmitting || !canCreateProduct}>
          <legend className="field-label">Supplier (opsional)</legend>
          {(suppliers ?? []).length === 0 && <span className="muted">Belum ada supplier.</span>}
          {(suppliers ?? []).map((item) => (
            <label key={item.id} className="checkbox-row">
              <input
                type="checkbox"
                checked={newSupplierIds.includes(item.id)}
                onChange={() => toggleSupplier(item.id)}
              />
              {item.name}
            </label>
          ))}
        </fieldset>
        <div>
          <label htmlFor={barcodeId} className="field-label">
            Barcode (satu per baris)
          </label>
          <textarea
            id={barcodeId}
            className="input"
            rows={3}
            value={newBarcodes}
            onChange={(event) => setNewBarcodes(event.target.value)}
            disabled={isSubmitting || !canCreateProduct}
            placeholder="Contoh: 000123"
          />
          <p className="muted">
            Barcode disimpan sebagai teks. Nol di depan tidak diubah menjadi angka.
          </p>
        </div>
        <Button
          type="submit"
          variant="primary"
          disabled={isSubmitting || !canCreateProduct}
        >
          {isSubmitting ? "Menyimpan…" : "Simpan produk"}
        </Button>
      </form>

      {status && <StatusMessage tone={status.tone} text={status.text} />}

      {edit && (
        <form className="product-form" onSubmit={handleSaveEdit} aria-label="Ubah produk">
          <h2 className="section-title">Ubah produk {edit.product.sku}</h2>
          <div className="form-grid">
            <div>
              <label htmlFor={`${nameId}-edit`} className="field-label">
                Nama produk
              </label>
              <input
                id={`${nameId}-edit`}
                className="input"
                type="text"
                maxLength={120}
                value={edit.name}
                onChange={(event) => setEdit({ ...edit, name: event.target.value })}
                disabled={isSubmitting}
              />
            </div>
            <div>
              <label htmlFor={`${priceId}-edit`} className="field-label">
                Harga (Rp)
              </label>
              <input
                id={`${priceId}-edit`}
                className="input"
                type="text"
                inputMode="numeric"
                value={edit.price}
                onChange={(event) => setEdit({ ...edit, price: event.target.value })}
                disabled={isSubmitting}
              />
            </div>
            <div>
              <label htmlFor={`${categoryId}-edit`} className="field-label">
                Kategori
              </label>
              <select
                id={`${categoryId}-edit`}
                className="input"
                value={edit.categoryId}
                onChange={(event) => setEdit({ ...edit, categoryId: event.target.value })}
                disabled={isSubmitting}
              >
                {(categories ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="catalog-barcodes">
            <h3 className="section-title">Barcode</h3>
            <ul className="catalog-list" aria-label="Barcode produk">
              {edit.product.barcodes.length === 0 && <li className="muted">Belum ada barcode.</li>}
              {edit.product.barcodes.map((barcode) => (
                <li key={barcode}>
                  <code>{barcode}</code>{" "}
                  <Button
                    variant="destructive"
                    aria-label={`Hapus barcode ${barcode}`}
                    disabled={busyProductId !== null}
                    onClick={() =>
                      setConfirmation({
                        kind: "remove-barcode",
                        product: edit.product,
                        barcode,
                      })
                    }
                  >
                    Hapus
                  </Button>
                </li>
              ))}
            </ul>
            <label htmlFor={`${barcodeId}-add`} className="field-label">
              Barcode baru
            </label>
            <input
              id={`${barcodeId}-add`}
              className="input"
              type="text"
              maxLength={64}
              value={edit.newBarcode}
              onChange={(event) => setEdit({ ...edit, newBarcode: event.target.value })}
              disabled={busyProductId !== null}
              placeholder="000123"
            />
            <Button
              variant="secondary"
              aria-label={`Tambah barcode ${edit.product.sku}`}
              disabled={busyProductId !== null || edit.newBarcode.trim().length === 0}
              onClick={() => void handleAddBarcode()}
            >
              Tambah barcode
            </Button>
          </div>
          <div className="dialog__actions">
            <Button type="submit" variant="primary" disabled={isSubmitting}>
              {isSubmitting ? "Menyimpan…" : "Simpan perubahan"}
            </Button>
            <Button
              variant="secondary"
              disabled={isSubmitting}
              onClick={(event) => {
                event.preventDefault();
                setEdit(null);
              }}
            >
              Batal ubah
            </Button>
          </div>
        </form>
      )}

      <h2 className="section-title">Daftar barang</h2>
      <form
        className="catalog-search"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setAppliedQuery(String(data.get("query") ?? ""));
        }}
        role="search"
        aria-label="Cari produk admin"
      >
        <label htmlFor={searchId} className="field-label">
          Cari produk
        </label>
        <input id={searchId} className="input" type="search" name="query" maxLength={80} />
        <Button type="submit">Cari</Button>
        <Button
          variant="secondary"
          onClick={() => {
            setAppliedQuery("");
            const form = document.getElementById(searchId)?.closest("form");
            if (form instanceof HTMLFormElement) {
              form.reset();
            }
          }}
        >
          Tampilkan semua
        </Button>
      </form>

      {loadError && (
        <div className="account-load-error">
          <p className="field-error" role="alert">
            {loadError}
          </p>
          <Button variant="secondary" onClick={() => setReloadKey((value) => value + 1)}>
            Coba lagi
          </Button>
        </div>
      )}
      {!loadError && products === null && <p className="muted">Memuat katalog…</p>}
      {!loadError && products !== null && products.length === 0 && (
        <p className="muted">Belum ada produk yang cocok.</p>
      )}
      {!loadError && products !== null && products.length > 0 && (
        <div className="table-wrap">
          <table className="table" aria-label="Daftar barang">
            <thead>
              <tr>
                <th scope="col">SKU</th>
                <th scope="col">Nama</th>
                <th scope="col">Kategori</th>
                <th scope="col" className="num">
                  Harga
                </th>
                <th scope="col" className="num">
                  Stok
                </th>
                <th scope="col">Status</th>
                <th scope="col">Barcode</th>
                <th scope="col">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>
                    <code>{product.sku}</code>
                  </td>
                  <td>{product.name}</td>
                  <td>{product.categoryName}</td>
                  <td className="num">
                    <MoneyText amountRp={product.priceRp} />
                  </td>
                  <td className="num">{product.stockOnHand}</td>
                  <td>
                    {product.active ? (
                      <span className="badge badge--ok">Aktif</span>
                    ) : (
                      <span className="badge">Nonaktif</span>
                    )}
                  </td>
                  <td>
                    {product.barcodes.length === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      <span className="barcode-cell">{product.barcodes.join(", ")}</span>
                    )}
                  </td>
                  <td>
                    <div className="table-actions">
                      <Button
                        variant="secondary"
                        aria-label={`Ubah ${product.sku}`}
                        disabled={busyProductId !== null || isSubmitting}
                        onClick={() =>
                          setEdit({
                            product,
                            name: product.name,
                            price: String(product.priceRp),
                            categoryId: String(product.categoryId),
                            newBarcode: "",
                          })
                        }
                      >
                        Ubah
                      </Button>
                      <Button
                        variant={product.active ? "destructive" : "primary"}
                        aria-label={`${product.active ? "Nonaktifkan" : "Aktifkan"} ${product.sku}`}
                        disabled={busyProductId !== null || isSubmitting}
                        onClick={() => setConfirmation({ kind: "toggle", product, nextActive: !product.active })}
                      >
                        {product.active ? "Nonaktifkan" : "Aktifkan"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmation?.kind === "create-product" && (
        <ConfirmDialog
          title="Simpan produk baru?"
          message={`Produk "${newSku.trim()}" akan disimpan dengan harga Rp ${parsePrice(newPrice) ?? 0}. Barcode dikirim sebagai teks: ${
            parseBarcodeInput(newBarcodes).join(", ") || "(tanpa barcode)"
          }.`}
          confirmLabel="Ya, simpan produk"
          cancelLabel="Batal"
          onConfirm={handleConfirm}
          onCancel={() => setConfirmation(null)}
        />
      )}
      {confirmation?.kind === "toggle" && (
        <ConfirmDialog
          title={confirmation.nextActive ? "Aktifkan produk?" : "Nonaktifkan produk?"}
          message={
            confirmation.nextActive
              ? `Produk "${confirmation.product.sku}" akan tampil kembali pada pencarian kasir.`
              : `Produk "${confirmation.product.sku}" tidak akan muncul pada pencarian/scan kasir. Riwayat transaksi lama tidak dihapus.`
          }
          confirmLabel={confirmation.nextActive ? "Ya, aktifkan" : "Ya, nonaktifkan"}
          cancelLabel="Batal"
          destructive={!confirmation.nextActive}
          onConfirm={handleConfirm}
          onCancel={() => setConfirmation(null)}
        />
      )}
      {confirmation?.kind === "remove-barcode" && (
        <ConfirmDialog
          title="Hapus barcode?"
          message={`Barcode "${confirmation.barcode}" akan dihapus dari ${confirmation.product.sku}. Barcode ini tidak lagi dapat dipakai untuk scan.`}
          confirmLabel="Ya, hapus barcode"
          cancelLabel="Batal"
          destructive
          onConfirm={handleConfirm}
          onCancel={() => setConfirmation(null)}
        />
      )}
    </section>
  );
}
