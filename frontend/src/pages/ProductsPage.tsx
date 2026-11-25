import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../api/errors";
import type {
  CatalogProduct,
  CategorySummary,
  PosDataSource,
  SessionUser,
  SupplierSummary,
} from "../api/types";
import {
  IconAlertTriangle,
  IconCheckCircle,
  IconChevronLeft,
  IconChevronRight,
  IconEdit,
  IconLayers,
  IconPackage,
  IconPlus,
  IconPrinter,
  IconRotateCcw,
  IconSearch,
  IconTag,
  IconTrash,
  IconTruck,
  IconX,
  IconXCircle,
} from "../components/AdminIcons";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MoneyText } from "../components/MoneyText";
import { StatusMessage, type StatusTone } from "../components/StatusMessage";
import { DEMO_LOW_STOCK_THRESHOLD, StockBadge } from "../components/StockBadge";
import { buildPriceTags, buildPriceTagsPdfBlob } from "../domain/priceTags";

interface ProductsPageProps {
  dataSource: PosDataSource;
  currentUser: SessionUser;
  /** Dipanggil saat backend menjawab 401: App wajib membersihkan sesi dan kembali ke login. */
  onSessionExpired: () => void;
  /**
   * "list" = halaman Barang/Stok (katalog & saldo stok).
   * "manage" = halaman Daftar Barang (input produk, kategori, supplier, tag harga).
   * "all" = gabungan untuk pengujian unit terisolasi.
   */
  view?: "all" | "manage" | "list";
  onNavigateToCreate?: () => void;
}

type Status = { tone: StatusTone; text: string };
type MasterTab = "product" | "category" | "supplier" | "tags";

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

function truncateToCodeUnits(text: string, maxUnits: number): string {
  let result = "";
  for (const char of text) {
    if (result.length + char.length > maxUnits) break;
    result += char;
  }
  return result;
}

/**
 * Katalog ADMIN:
 * - view="list" -> Barang/Stok (tabel katalog, filter, saldo stok, ubah produk & barcode).
 * - view="manage" -> Daftar Barang (tab Tambah Barang, Kategori, Supplier, Tag Harga).
 */
export function ProductsPage({
  dataSource,
  currentUser: _currentUser,
  onSessionExpired,
  view = "all",
  onNavigateToCreate,
}: ProductsPageProps) {
  const [categories, setCategories] = useState<CategorySummary[] | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierSummary[] | null>(null);
  const [products, setProducts] = useState<CatalogProduct[] | null>(null);
  const [fullProducts, setFullProducts] = useState<CatalogProduct[] | null>(null);
  const [categoryPageLoading, setCategoryPageLoading] = useState(false);
  const [categoryPageError, setCategoryPageError] = useState<string | null>(null);
  const [categoryReloadKey, setCategoryReloadKey] = useState(0);
  const [allActiveProducts, setAllActiveProducts] = useState<CatalogProduct[] | null>(null);
  const [tagLoadError, setTagLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [appliedQuery, setAppliedQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [listCategoryId, setListCategoryId] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [stockFilter, setStockFilter] = useState<"all" | "safe" | "low" | "empty">("all");
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState<number>(25);

  const [masterTab, setMasterTab] = useState<MasterTab>("product");
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
  const [supplierFilter, setSupplierFilter] = useState("");
  const [newBarcodes, setNewBarcodes] = useState("");
  const [barcodeDraft, setBarcodeDraft] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [tagCategoryId, setTagCategoryId] = useState<string>("all");
  const [excludedTagProductIds, setExcludedTagProductIds] = useState<number[]>([]);

  const submitLockRef = useRef(false);
  const listSeqRef = useRef(0);

  const skuId = useId();
  const nameId = useId();
  const priceId = useId();
  const categoryId = useId();
  const supplierId = useId();
  const barcodeId = useId();
  const searchId = useId();
  const categoryDropdownId = useId();
  const statusFilterId = useId();
  const stockFilterId = useId();

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
    setFullProducts(null);
    setAllActiveProducts(null);
    setTagLoadError(null);
    Promise.all([
      dataSource.listCategories(),
      dataSource.listSuppliers(),
      dataSource.listCatalogProducts({
        query: appliedQuery || undefined,
        includeInactive: true,
        limit: MAX_PRODUCTS,
      }),
    ])
      .then(async ([categoryRows, supplierRows, productRows]) => {
        if (!isActive || seq !== listSeqRef.current) return;
        setCategories(categoryRows);
        setSuppliers(supplierRows);
        const sortedRows = sortProducts(productRows);
        setProducts(sortedRows);
        setLoadError(null);
        setNewCategoryId((previous) =>
          previous === "" && categoryRows[0] ? String(categoryRows[0].id) : previous,
        );
        try {
          if (appliedQuery === "" && productRows.length < MAX_PRODUCTS) {
            setAllActiveProducts(sortedRows.filter((item) => item.active));
          } else {
            const collected: CatalogProduct[] = [];
            const seenIds = new Set<number>();
            let offset = 0;
            while (true) {
              const page = await dataSource.listCatalogProducts({
                includeInactive: false,
                limit: MAX_PRODUCTS,
                offset,
              });
              if (!isActive || seq !== listSeqRef.current) return;
              let added = 0;
              for (const item of page) {
                if (!seenIds.has(item.id)) {
                  seenIds.add(item.id);
                  collected.push(item);
                  added += 1;
                }
              }
              if (page.length < MAX_PRODUCTS || added === 0) break;
              offset += MAX_PRODUCTS;
            }
            setAllActiveProducts(sortProducts(collected));
          }
          setTagLoadError(null);
        } catch (error: unknown) {
          if (!isActive || seq !== listSeqRef.current) return;
          if (error instanceof ApiError && error.isSessionExpired) {
            onSessionExpired();
            return;
          }
          setAllActiveProducts(null);
          setTagLoadError(error instanceof ApiError ? error.message : "Batch tag harga gagal dimuat.");
        }
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

  const needsFullPagination =
    listCategoryId !== "all" || statusFilter !== "all" || stockFilter !== "all";

  useEffect(() => {
    if (!needsFullPagination || products === null || products.length < MAX_PRODUCTS) {
      setFullProducts(null);
      setCategoryPageLoading(false);
      setCategoryPageError(null);
      return;
    }
    let isActive = true;
    const seq = listSeqRef.current;
    setCategoryPageLoading(true);
    setCategoryPageError(null);
    (async () => {
      try {
        const collected: CatalogProduct[] = [...products];
        const seenIds = new Set<number>(products.map((item) => item.id));
        let offset = MAX_PRODUCTS;
        while (true) {
          const page = await dataSource.listCatalogProducts({
            query: appliedQuery || undefined,
            includeInactive: true,
            limit: MAX_PRODUCTS,
            offset,
          });
          if (!isActive || seq !== listSeqRef.current) return;
          let added = 0;
          for (const item of page) {
            if (!seenIds.has(item.id)) {
              seenIds.add(item.id);
              collected.push(item);
              added += 1;
            }
          }
          if (page.length < MAX_PRODUCTS || added === 0) break;
          offset += MAX_PRODUCTS;
        }
        if (isActive && seq === listSeqRef.current) {
          setFullProducts(sortProducts(collected));
          setCategoryPageError(null);
        }
      } catch (error: unknown) {
        if (!isActive || seq !== listSeqRef.current) return;
        if (error instanceof ApiError && error.isSessionExpired) {
          onSessionExpired();
          return;
        }
        setFullProducts(null);
        setCategoryPageError(
          error instanceof ApiError ? error.message : "Halaman lanjutan kategori gagal dimuat.",
        );
      } finally {
        if (isActive && seq === listSeqRef.current) {
          setCategoryPageLoading(false);
        }
      }
    })();
    return () => {
      isActive = false;
    };
  }, [needsFullPagination, products, appliedQuery, dataSource, onSessionExpired, categoryReloadKey]);

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
    setFullProducts((previous) =>
      previous === null
        ? previous
        : sortProducts(previous.map((item) => (item.id === updated.id ? updated : item))),
    );
    setAllActiveProducts((previous) => {
      if (previous === null) return previous;
      const without = previous.filter((item) => item.id !== updated.id);
      return updated.active ? sortProducts([...without, updated]) : without;
    });
    setEdit((previous) =>
      previous !== null && previous.product.id === updated.id
        ? { ...previous, product: updated }
        : previous,
    );
  }

  function resetCreateProductForm(): void {
    setNewSku("");
    setNewName("");
    setNewPrice("");
    setNewSupplierIds([]);
    setSupplierFilter("");
    setNewBarcodes("");
    setBarcodeDraft("");
    if (categories && categories[0]) {
      setNewCategoryId(String(categories[0].id));
    }
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
      resetCreateProductForm();
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
    if (confirmation?.kind !== "remove-barcode" || submitLockRef.current) return;
    const { product, barcode } = confirmation;
    submitLockRef.current = true;
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
      submitLockRef.current = false;
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

  function appendBarcodeDraft(): void {
    const trimmed = barcodeDraft.trim();
    if (!trimmed) return;
    const existing = parseBarcodeInput(newBarcodes);
    if (existing.includes(trimmed)) {
      setStatus({ tone: "warning", text: `Barcode "${trimmed}" sudah ada di daftar produk ini.` });
      return;
    }
    const next = [...existing, trimmed].join("\n");
    setNewBarcodes(next);
    setBarcodeDraft("");
  }

  function removeDraftBarcode(targetBarcode: string): void {
    const next = parseBarcodeInput(newBarcodes)
      .filter((code) => code !== targetBarcode)
      .join("\n");
    setNewBarcodes(next);
  }

  const canCreateProduct = categories !== null && categories.length > 0;
  const searchNeedle = searchInput.trim().toLowerCase();
  const productCollection = needsFullPagination && fullProducts !== null ? fullProducts : products;
  const visibleProducts =
    productCollection === null
      ? null
      : productCollection.filter((product) => {
          if (listCategoryId !== "all" && product.categoryId !== Number(listCategoryId)) {
            return false;
          }
          if (statusFilter === "active" && !product.active) {
            return false;
          }
          if (statusFilter === "inactive" && product.active) {
            return false;
          }
          if (stockFilter === "empty" && product.stockOnHand > 0) {
            return false;
          }
          if (
            stockFilter === "low" &&
            (product.stockOnHand <= 0 || product.stockOnHand > DEMO_LOW_STOCK_THRESHOLD)
          ) {
            return false;
          }
          if (stockFilter === "safe" && product.stockOnHand <= DEMO_LOW_STOCK_THRESHOLD) {
            return false;
          }
          if (searchNeedle.length === 0) {
            return true;
          }
          return (
            product.name.toLowerCase().includes(searchNeedle) ||
            product.sku.toLowerCase().includes(searchNeedle) ||
            product.categoryName.toLowerCase().includes(searchNeedle) ||
            product.barcodes.some((code) => code.toLowerCase().includes(searchNeedle))
          );
        });

  const searchSuggestions =
    showSuggestions && searchNeedle.length > 0 && visibleProducts !== null
      ? visibleProducts.slice(0, 6)
      : [];

  // Ringkasan KPI untuk Barang/Stok
  const totalLoaded = productCollection?.length ?? 0;
  const activeCount = productCollection?.filter((p) => p.active).length ?? 0;
  const lowCount =
    productCollection?.filter((p) => p.stockOnHand > 0 && p.stockOnHand <= DEMO_LOW_STOCK_THRESHOLD).length ?? 0;
  const emptyCount = productCollection?.filter((p) => p.stockOnHand <= 0).length ?? 0;

  // Pagination tampilan tabel
  const totalVisible = visibleProducts?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalVisible / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const pagedProducts =
    visibleProducts === null
      ? null
      : visibleProducts.slice(safePageIndex * pageSize, (safePageIndex + 1) * pageSize);

  const parsedNewBarcodes = parseBarcodeInput(newBarcodes);
  const filteredSuppliers = (suppliers ?? []).filter((s) =>
    supplierFilter.trim().length === 0
      ? true
      : s.name.toLowerCase().includes(supplierFilter.trim().toLowerCase()),
  );

  const isCatalogView = view === "list";
  const isMasterView = view === "manage";
  const showProductForm = view === "all" || (isMasterView && masterTab === "product");
  const showCategorySection = view === "all" || (isMasterView && masterTab === "category");
  const showSupplierSection = view === "all" || (isMasterView && masterTab === "supplier");
  const showTagSection = view === "all" || (isMasterView && masterTab === "tags");

  return (
    <section className="admin-page" aria-labelledby="products-title" aria-busy={isLoading}>
      <header className="admin-header">
        <div className="admin-header__titles">
          <h1 id="products-title" className="admin-header__title">
            {isMasterView ? "Daftar Barang" : "Barang/Stok"}
          </h1>
          <p className="admin-header__subtitle">
            {isMasterView
              ? "Tambahkan produk master serta kelola data kategori, supplier, dan pencetakan tag harga rak."
              : "Cari, periksa saldo stok terkini, dan kelola status maupun harga katalog barang terdaftar."}
          </p>
        </div>

        {isCatalogView && onNavigateToCreate && (
          <div className="admin-header__actions">
            <Button type="button" variant="primary" onClick={onNavigateToCreate}>
              <IconPlus size={18} />
              <span>Tambah Barang</span>
            </Button>
          </div>
        )}
      </header>

      {dataSource.catalogMode === "DEMO" && (
        <StatusMessage
          tone="warning"
          text="Mode DEMO menampilkan katalog sintetis. Simpan produk/kategori/supplier memerlukan backend lokal dan tidak menyamar sebagai sukses."
        />
      )}

      {status && <StatusMessage tone={status.tone} text={status.text} />}

      {loadError && (
        <div className="admin-card account-load-error">
          <p className="field-error" role="alert" style={{ margin: 0 }}>
            {loadError}
          </p>
          <Button variant="secondary" onClick={() => setReloadKey((value) => value + 1)}>
            Coba lagi
          </Button>
        </div>
      )}

      {/* =====================================================================
          BAGIAN 1: DAFTAR BARANG (MASTER DATA INPUT, KATEGORI, SUPPLIER, TAG)
          ===================================================================== */}
      {view !== "list" && (
        <>
          {isMasterView && (
            <div className="admin-tabs" role="tablist" aria-label="Submenu Daftar Barang">
              <button
                type="button"
                role="tab"
                aria-selected={masterTab === "product"}
                className={masterTab === "product" ? "admin-tab admin-tab--active" : "admin-tab"}
                onClick={() => setMasterTab("product")}
              >
                <IconPlus size={18} />
                <span>Tambah Barang</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={masterTab === "category"}
                className={masterTab === "category" ? "admin-tab admin-tab--active" : "admin-tab"}
                onClick={() => setMasterTab("category")}
              >
                <IconLayers size={18} />
                <span>Kategori ({categories?.length ?? 0})</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={masterTab === "supplier"}
                className={masterTab === "supplier" ? "admin-tab admin-tab--active" : "admin-tab"}
                onClick={() => setMasterTab("supplier")}
              >
                <IconTruck size={18} />
                <span>Supplier ({suppliers?.length ?? 0})</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={masterTab === "tags"}
                className={masterTab === "tags" ? "admin-tab admin-tab--active" : "admin-tab"}
                onClick={() => setMasterTab("tags")}
              >
                <IconTag size={18} />
                <span>Tag Harga</span>
              </button>
            </div>
          )}

          {showProductForm && (
            <form className="admin-card" onSubmit={handleCreateProduct} aria-label="Buat produk" noValidate>
              <div className="admin-card__header">
                <div>
                  <h2 className="admin-card__title">Informasi Barang</h2>
                  <p className="admin-card__desc">
                    Daftarkan katalog barang baru. Stok awal dicatat terpisah melalui Penerimaan atau Koreksi Stok.
                  </p>
                </div>
              </div>

              {!canCreateProduct && !isLoading && (
                <StatusMessage
                  tone="warning"
                  text="Buat minimal satu kategori terlebih dahulu pada bagian Kategori sebelum menambah produk."
                />
              )}

              <div className="admin-split-55-45" style={{ marginTop: "12px" }}>
                {/* Kiri: Informasi Dasar Barang */}
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div>
                    <div style={{ display: "flex", gap: "4px", alignItems: "baseline" }}>
                      <label htmlFor={nameId} className="field-label">
                        Nama produk
                      </label>
                      <span aria-hidden="true" style={{ color: "var(--color-danger)", fontWeight: 700 }}>*</span>
                    </div>
                    <input
                      id={nameId}
                      className="input"
                      type="text"
                      maxLength={120}
                      placeholder="Contoh: Air Mineral 600 ml"
                      value={newName}
                      onChange={(event) => setNewName(event.target.value)}
                      disabled={isSubmitting || !canCreateProduct}
                      required
                    />
                  </div>

                  <div className="form-grid">
                    <div>
                      <div style={{ display: "flex", gap: "4px", alignItems: "baseline" }}>
                        <label htmlFor={skuId} className="field-label">
                          SKU
                        </label>
                        <span aria-hidden="true" style={{ color: "var(--color-danger)", fontWeight: 700 }}>*</span>
                      </div>
                      <input
                        id={skuId}
                        className="input"
                        type="text"
                        maxLength={64}
                        autoComplete="off"
                        placeholder="Contoh: MIN-001"
                        value={newSku}
                        onChange={(event) => setNewSku(event.target.value)}
                        disabled={isSubmitting || !canCreateProduct}
                        required
                      />
                    </div>

                    <div>
                      <div style={{ display: "flex", gap: "4px", alignItems: "baseline" }}>
                        <label htmlFor={categoryId} className="field-label">
                          Kategori
                        </label>
                        <span aria-hidden="true" style={{ color: "var(--color-danger)", fontWeight: 700 }}>*</span>
                      </div>
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

                  <div>
                    <div style={{ display: "flex", gap: "4px", alignItems: "baseline" }}>
                      <label htmlFor={priceId} className="field-label">
                        Harga (Rp)
                      </label>
                      <span aria-hidden="true" style={{ color: "var(--color-danger)", fontWeight: 700 }}>*</span>
                    </div>
                    <input
                      id={priceId}
                      className="input"
                      type="text"
                      inputMode="numeric"
                      placeholder="Contoh: 5.000"
                      value={newPrice.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}
                      onChange={(event) => setNewPrice(event.target.value.replace(/\./g, ""))}
                      disabled={isSubmitting || !canCreateProduct}
                      required
                    />
                    <span className="field-hint">Bilangan bulat Rupiah tanpa desimal.</span>
                  </div>

                  <p className="muted" style={{ margin: "4px 0 0", fontSize: "12px" }}>
                    * Wajib diisi sebelum menyimpan produk.
                  </p>
                </div>

                {/* Kanan: Supplier & Barcode */}
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <fieldset className="catalog-fieldset" style={{ margin: 0 }} disabled={isSubmitting || !canCreateProduct}>
                    <legend className="field-label">
                      Supplier (opsional)
                      {newSupplierIds.length > 0 ? ` · ${newSupplierIds.length} dipilih` : ""}
                    </legend>
                    {(suppliers ?? []).length > 5 && (
                      <input
                        type="search"
                        className="input"
                        style={{ marginBottom: "8px", minHeight: "38px" }}
                        placeholder="Filter nama supplier…"
                        value={supplierFilter}
                        onChange={(event) => setSupplierFilter(event.target.value)}
                      />
                    )}
                    {(suppliers ?? []).length === 0 ? (
                      <span className="muted">Belum ada supplier terdaftar.</span>
                    ) : (
                      <div style={{ maxHeight: "140px", overflowY: "auto" }}>
                        {filteredSuppliers.map((item) => (
                          <label key={item.id} className="checkbox-row">
                            <input
                              type="checkbox"
                              checked={newSupplierIds.includes(item.id)}
                              onChange={() => toggleSupplier(item.id)}
                            />
                            <span>{item.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </fieldset>

                  <div className="catalog-fieldset" style={{ margin: 0 }}>
                    <label htmlFor={barcodeId} className="field-label">
                      Barcode (satu per baris)
                    </label>
                    <div className="search__row" style={{ marginBottom: "8px" }}>
                      <input
                        type="text"
                        className="input"
                        maxLength={64}
                        placeholder="Scan atau ketik kode barcode…"
                        value={barcodeDraft}
                        disabled={isSubmitting || !canCreateProduct}
                        onChange={(event) => setBarcodeDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            appendBarcodeDraft();
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={isSubmitting || !canCreateProduct || barcodeDraft.trim().length === 0}
                        onClick={appendBarcodeDraft}
                      >
                        <IconPlus size={16} />
                        <span>Tambah</span>
                      </Button>
                    </div>
                    <textarea
                      id={barcodeId}
                      className="input"
                      rows={2}
                      value={newBarcodes}
                      onChange={(event) => setNewBarcodes(event.target.value)}
                      disabled={isSubmitting || !canCreateProduct}
                      placeholder="Contoh: 000123"
                    />
                    {parsedNewBarcodes.length > 0 && (
                      <div className="barcode-chip-list" aria-label="Pratinjau barcode baru">
                        {parsedNewBarcodes.map((code) => (
                          <span key={code} className="barcode-chip">
                            <span>{code}</span>
                            <button
                              type="button"
                              className="barcode-chip__remove"
                              aria-label={`Hapus pratinjau barcode ${code}`}
                              onClick={() => removeDraftBarcode(code)}
                            >
                              <IconX size={14} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <span className="field-hint">
                      Barcode disimpan sebagai teks; angka nol di depan tetap dipertahankan.
                    </span>
                  </div>
                </div>
              </div>

              <div className="dialog__actions" style={{ borderTop: "1px solid var(--color-border)", paddingTop: "12px" }}>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isSubmitting}
                  onClick={resetCreateProductForm}
                >
                  <IconRotateCcw size={16} />
                  <span>Reset</span>
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={isSubmitting || !canCreateProduct}
                >
                  <IconCheckCircle size={18} />
                  <span>{isSubmitting ? "Menyimpan…" : "Simpan produk"}</span>
                </Button>
              </div>
            </form>
          )}

          {(showCategorySection || showSupplierSection) && (
            <div className={view === "all" ? "catalog-grid" : undefined}>
              {showCategorySection && (
                <div className="admin-card">
                  <form onSubmit={handleCreateCategory} aria-label="Buat kategori">
                    <div className="admin-card__header">
                      <div>
                        <h2 className="admin-card__title">Kategori Barang</h2>
                        <p className="admin-card__desc">Kelompokkan produk agar pencarian katalog lebih terstruktur.</p>
                      </div>
                    </div>
                    <div className="search__row" style={{ alignItems: "flex-end", marginBottom: "16px" }}>
                      <div style={{ flex: 1 }}>
                        <label htmlFor={`${categoryId}-new`} className="field-label">
                          Nama kategori baru
                        </label>
                        <input
                          id={`${categoryId}-new`}
                          className="input"
                          type="text"
                          maxLength={120}
                          placeholder="Contoh: Makanan Ringan"
                          value={categoryName}
                          onChange={(event) => setCategoryName(event.target.value)}
                          disabled={isSubmitting}
                        />
                      </div>
                      <Button type="submit" variant="primary" disabled={isSubmitting || categoryName.trim().length === 0}>
                        <IconPlus size={18} />
                        <span>Tambah kategori</span>
                      </Button>
                    </div>
                  </form>

                  {(categories ?? []).length === 0 ? (
                    <div className="admin-empty">
                      <span className="admin-empty__icon">
                        <IconLayers size={24} />
                      </span>
                      <p className="admin-empty__title">Belum ada kategori</p>
                      <p className="admin-empty__desc">Tambahkan minimal satu kategori untuk mulai mendaftarkan barang.</p>
                    </div>
                  ) : (
                    <div className="table-wrap">
                      <table className="table" aria-label="Daftar kategori">
                        <thead>
                          <tr>
                            <th scope="col">ID</th>
                            <th scope="col">Nama Kategori</th>
                            <th scope="col" className="num">Produk Dimuat</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(categories ?? []).map((item) => {
                            const count = (products ?? []).filter((p) => p.categoryId === item.id).length;
                            return (
                              <tr key={item.id}>
                                <td className="muted">#{item.id}</td>
                                <td className="cell-primary">{item.name}</td>
                                <td className="num">{count}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {showSupplierSection && (
                <div className="admin-card">
                  <form onSubmit={handleCreateSupplier} aria-label="Buat supplier">
                    <div className="admin-card__header">
                      <div>
                        <h2 className="admin-card__title">Data Supplier</h2>
                        <p className="admin-card__desc">Daftar pemasok resmi untuk pencatatan penerimaan barang.</p>
                      </div>
                    </div>
                    <div className="search__row" style={{ alignItems: "flex-end", marginBottom: "16px" }}>
                      <div style={{ flex: 1 }}>
                        <label htmlFor={`${supplierId}-new`} className="field-label">
                          Nama supplier baru
                        </label>
                        <input
                          id={`${supplierId}-new`}
                          className="input"
                          type="text"
                          maxLength={120}
                          placeholder="Contoh: PT Sumber Segar"
                          value={supplierName}
                          onChange={(event) => setSupplierName(event.target.value)}
                          disabled={isSubmitting}
                        />
                      </div>
                      <Button type="submit" variant="primary" disabled={isSubmitting || supplierName.trim().length === 0}>
                        <IconPlus size={18} />
                        <span>Tambah supplier</span>
                      </Button>
                    </div>
                  </form>

                  {(suppliers ?? []).length === 0 ? (
                    <div className="admin-empty">
                      <span className="admin-empty__icon">
                        <IconTruck size={24} />
                      </span>
                      <p className="admin-empty__title">Belum ada supplier</p>
                      <p className="admin-empty__desc">Tambahkan nama pemasok agar dapat dipilih pada penerimaan barang.</p>
                    </div>
                  ) : (
                    <div className="table-wrap">
                      <table className="table" aria-label="Daftar supplier">
                        <thead>
                          <tr>
                            <th scope="col">ID</th>
                            <th scope="col">Nama Supplier</th>
                            <th scope="col" className="num">Produk Terkait</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(suppliers ?? []).map((item) => {
                            const count = (products ?? []).filter((p) => p.supplierIds.includes(item.id)).length;
                            return (
                              <tr key={item.id}>
                                <td className="muted">#{item.id}</td>
                                <td className="cell-primary">{item.name}</td>
                                <td className="num">{count}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {showTagSection &&
            ((allActiveProducts && allActiveProducts.length > 0) ||
              (products && products.length > 0) ||
              tagLoadError !== null ||
              isMasterView) &&
            (() => {
              const tagSource = allActiveProducts ?? [];
              const selectedCategory = tagCategoryId === "all" ? null : Number(tagCategoryId);
              const categoryTags = buildPriceTags(tagSource, selectedCategory);
              const excludedSet = new Set(excludedTagProductIds);
              const batchTags = categoryTags.filter((tag) => !excludedSet.has(tag.productId));

              return (
                <section className="admin-card" aria-label="Tag harga otomatis">
                  <div className="admin-card__header">
                    <div>
                      <h2 className="admin-card__title">Tag Harga Rak</h2>
                      <p className="admin-card__desc">
                        Unduh PDF tag harga rak dari produk aktif (nama toko, nama barang, harga jual, kode barcode teks, dan SKU).
                      </p>
                    </div>
                  </div>

                  {tagLoadError && (
                    <div className="account-load-error" style={{ marginBottom: "12px" }}>
                      <p className="field-error" role="alert" style={{ margin: 0 }}>
                        {tagLoadError}
                      </p>
                      <Button variant="secondary" onClick={invalidatePendingReadsAndRefresh}>
                        Coba lagi
                      </Button>
                    </div>
                  )}

                  <div className="admin-toolbar" style={{ padding: "12px", background: "var(--color-bg)" }}>
                    <div className="admin-toolbar__controls">
                      <div className="admin-toolbar__field">
                        <label htmlFor="tag-category-filter" className="field-label">
                          Batch tag harga
                        </label>
                        <select
                          id="tag-category-filter"
                          className="input"
                          value={tagCategoryId}
                          onChange={(event) => {
                            setTagCategoryId(event.target.value);
                            setExcludedTagProductIds([]);
                          }}
                        >
                          <option value="all">Semua produk aktif</option>
                          {(categories ?? []).map((cat) => (
                            <option key={cat.id} value={String(cat.id)}>
                              {cat.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      {excludedTagProductIds.length > 0 && (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setExcludedTagProductIds([])}
                        >
                          Pilih semua ({categoryTags.length})
                        </Button>
                      )}
                    </div>

                    <Button
                      variant="primary"
                      disabled={allActiveProducts === null}
                      onClick={() => {
                        if (batchTags.length === 0) {
                          setStatus({
                            tone: "warning",
                            text: "Tidak ada produk aktif pada batch tag harga yang dipilih.",
                          });
                          return;
                        }
                        const blob = buildPriceTagsPdfBlob(batchTags);
                        const url = URL.createObjectURL(blob);
                        const anchor = document.createElement("a");
                        anchor.href = url;
                        anchor.download = "tag-harga.pdf";
                        anchor.click();
                        URL.revokeObjectURL(url);
                        setStatus({
                          tone: "success",
                          text: `Tag harga disiapkan untuk ${batchTags.length} produk.`,
                        });
                      }}
                    >
                      <IconPrinter size={18} />
                      <span>Cetak / PDF Tag Harga ({batchTags.length})</span>
                    </Button>
                  </div>

                  {isMasterView && categoryTags.length > 0 && (
                    <>
                      <p className="field-hint" style={{ marginTop: "12px" }}>
                        Pratinjau label ({Math.min(6, batchTags.length)} dari {batchTags.length} produk terpilih). Nomor barcode dicetak sebagai teks sesuai katalog.
                      </p>
                      <div className="price-tag-grid">
                        {categoryTags.slice(0, 6).map((tag) => {
                          const checked = !excludedSet.has(tag.productId);
                          return (
                            <div key={tag.productId} className="price-tag-card">
                              <div className="price-tag-card__store" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span>{tag.storeName}</span>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  aria-label={`Sertakan tag ${tag.name}`}
                                  onChange={() =>
                                    setExcludedTagProductIds((prev) =>
                                      prev.includes(tag.productId)
                                        ? prev.filter((id) => id !== tag.productId)
                                        : [...prev, tag.productId],
                                    )
                                  }
                                />
                              </div>
                              <div className="price-tag-card__name">{tag.name}</div>
                              <div className="price-tag-card__price">{tag.formattedPrice}</div>
                              <div className="price-tag-card__codes">
                                <span>Barcode: {tag.barcode || "—"}</span>
                                <span>SKU: {tag.sku}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </section>
              );
            })()}
        </>
      )}

      {/* =====================================================================
          BAGIAN 2: BARANG/STOK (TABEL KATALOG, FILTER & UBAH PRODUK)
          ===================================================================== */}
      {view !== "manage" && (
        <>
          {/* Empat KPI Ringkasan Katalog */}
          <div className="admin-kpi-grid">
            <div className="admin-kpi-card">
              <div className="admin-kpi-card__top">
                <span className="admin-kpi-card__label">Total barang</span>
                <span className="admin-kpi-card__icon">
                  <IconPackage size={18} />
                </span>
              </div>
              <div className="admin-kpi-card__value">{totalLoaded}</div>
              <p className="admin-kpi-card__meta">
                {products && products.length === MAX_PRODUCTS
                  ? "Batas muat awal 100 produk katalog"
                  : "Seluruh produk terdaftar"}
              </p>
            </div>

            <div className="admin-kpi-card">
              <div className="admin-kpi-card__top">
                <span className="admin-kpi-card__label">Aktif</span>
                <span className="admin-kpi-card__icon">
                  <IconCheckCircle size={18} />
                </span>
              </div>
              <div className="admin-kpi-card__value">{activeCount}</div>
              <p className="admin-kpi-card__meta">Tersedia untuk pencarian & scan kasir</p>
            </div>

            <div className="admin-kpi-card admin-kpi-card--warning">
              <div className="admin-kpi-card__top">
                <span className="admin-kpi-card__label">Menipis</span>
                <span className="admin-kpi-card__icon">
                  <IconAlertTriangle size={18} />
                </span>
              </div>
              <div className="admin-kpi-card__value">{lowCount}</div>
              <p className="admin-kpi-card__meta">Saldo 1 s.d. {DEMO_LOW_STOCK_THRESHOLD} unit</p>
            </div>

            <div className="admin-kpi-card admin-kpi-card--danger">
              <div className="admin-kpi-card__top">
                <span className="admin-kpi-card__label">Habis</span>
                <span className="admin-kpi-card__icon">
                  <IconXCircle size={18} />
                </span>
              </div>
              <div className="admin-kpi-card__value">{emptyCount}</div>
              <p className="admin-kpi-card__meta">Saldo 0 unit (penjualan diblokir)</p>
            </div>
          </div>

          {edit && (
            <form className="admin-card product-form" style={{ margin: 0 }} onSubmit={handleSaveEdit} aria-label="Ubah produk">
              <div className="admin-card__header">
                <div>
                  <h2 className="admin-card__title">Ubah Produk · {edit.product.sku}</h2>
                  <p className="admin-card__desc">
                    Perubahan harga berlaku pada checkout berikutnya; transaksi lama tetap memakai harga historis.
                  </p>
                </div>
              </div>

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
                    value={edit.price.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}
                    onChange={(event) => setEdit({ ...edit, price: event.target.value.replace(/\./g, "") })}
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
                <h3 className="section-title">Barcode Terdaftar</h3>
                <ul className="catalog-list" aria-label="Barcode produk" style={{ listStyle: "none", paddingLeft: 0, display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {edit.product.barcodes.length === 0 && <li className="muted">Belum ada barcode.</li>}
                  {edit.product.barcodes.map((barcode) => (
                    <li key={barcode} className="barcode-chip">
                      <code>{barcode}</code>
                      <Button
                        variant="destructive"
                        className="btn--icon"
                        style={{ minHeight: "28px", minWidth: "28px", padding: "0 8px", fontSize: "12px", marginTop: 0 }}
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
                        <IconTrash size={14} />
                        <span>Hapus</span>
                      </Button>
                    </li>
                  ))}
                </ul>

                <div className="search__row" style={{ alignItems: "flex-end", marginTop: "12px", maxWidth: "460px" }}>
                  <div style={{ flex: 1 }}>
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
                  </div>
                  <Button
                    variant="secondary"
                    style={{ marginTop: 0 }}
                    aria-label={`Tambah barcode ${edit.product.sku}`}
                    disabled={busyProductId !== null || edit.newBarcode.trim().length === 0}
                    onClick={() => void handleAddBarcode()}
                  >
                    <IconPlus size={16} />
                    <span>Tambah barcode</span>
                  </Button>
                </div>
              </div>

              <div className="dialog__actions" style={{ borderTop: "1px solid var(--color-border)", paddingTop: "12px" }}>
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
                <Button type="submit" variant="primary" disabled={isSubmitting}>
                  {isSubmitting ? "Menyimpan…" : "Simpan perubahan"}
                </Button>
              </div>
            </form>
          )}

          <div className="admin-card">
            {view !== "list" && <h2 className="admin-card__title" style={{ marginBottom: "12px" }}>Daftar barang</h2>}

            <form
              className="catalog-search"
              onSubmit={(event) => {
                event.preventDefault();
                setShowSuggestions(false);
                setPageIndex(0);
                setAppliedQuery(truncateToCodeUnits(searchInput.trim(), 80));
              }}
              role="search"
              aria-label="Cari produk admin"
            >
              <div className="catalog-search__field">
                <label htmlFor={searchId} className="field-label">
                  Cari produk
                </label>
                <div className="input-with-icon">
                  <span className="input-with-icon__prefix">
                    <IconSearch size={16} />
                  </span>
                  <input
                    id={searchId}
                    className="input input--pl"
                    type="search"
                    name="query"
                    maxLength={80}
                    placeholder="Ketik nama, SKU, atau barcode…"
                    value={searchInput}
                    onFocus={() => setShowSuggestions(true)}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setSearchInput(nextValue);
                      setShowSuggestions(true);
                      setPageIndex(0);
                      if (appliedQuery !== "" && nextValue.trim() !== appliedQuery) {
                        setAppliedQuery("");
                      }
                    }}
                  />
                </div>
                {searchSuggestions.length > 0 && (
                  <ul className="catalog-suggestions" role="listbox" aria-label="Saran produk">
                    {searchSuggestions.map((item) => (
                      <li key={item.id} role="option" aria-selected={false}>
                        <button
                          type="button"
                          className="catalog-suggestions__item"
                          onClick={() => {
                            setSearchInput(truncateToCodeUnits(item.name, 80));
                            setShowSuggestions(false);
                            setPageIndex(0);
                          }}
                        >
                          <span>{item.name}</span>
                          <span className="muted"> · {item.sku}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="catalog-search__filter">
                <label htmlFor={categoryDropdownId} className="field-label">
                  Filter Kategori
                </label>
                <select
                  id={categoryDropdownId}
                  className="input"
                  aria-label="Filter dropdown kategori"
                  value={listCategoryId}
                  onChange={(event) => {
                    setListCategoryId(event.target.value);
                    setPageIndex(0);
                  }}
                >
                  <option value="all">Semua kategori</option>
                  {(categories ?? []).map((cat) => (
                    <option key={cat.id} value={String(cat.id)}>
                      Kategori: {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="catalog-search__filter">
                <label htmlFor={statusFilterId} className="field-label">
                  Status
                </label>
                <select
                  id={statusFilterId}
                  className="input"
                  aria-label="Filter status barang"
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value as "all" | "active" | "inactive");
                    setPageIndex(0);
                  }}
                >
                  <option value="all">Semua</option>
                  <option value="active">Aktif</option>
                  <option value="inactive">Nonaktif</option>
                </select>
              </div>

              <div className="catalog-search__filter">
                <label htmlFor={stockFilterId} className="field-label">
                  Kondisi Stok
                </label>
                <select
                  id={stockFilterId}
                  className="input"
                  aria-label="Filter kondisi stok"
                  value={stockFilter}
                  onChange={(event) => {
                    setStockFilter(event.target.value as "all" | "safe" | "low" | "empty");
                    setPageIndex(0);
                  }}
                >
                  <option value="all">Semua</option>
                  <option value="safe">Stok Aman</option>
                  <option value="low">Stok Menipis</option>
                  <option value="empty">Stok Habis</option>
                </select>
              </div>

              <div className="catalog-search__actions">
                <Button type="submit" variant="primary">
                  <IconSearch size={16} />
                  <span>Cari</span>
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setSearchInput("");
                    setAppliedQuery("");
                    setListCategoryId("all");
                    setStatusFilter("all");
                    setStockFilter("all");
                    setShowSuggestions(false);
                    setPageIndex(0);
                  }}
                >
                  <IconRotateCcw size={16} />
                  <span>Tampilkan semua</span>
                </Button>
              </div>
            </form>

            {categories !== null && categories.length > 0 && (
              <div className="catalog-category-bar" role="group" aria-label="Filter kategori barang">
                <Button
                  type="button"
                  variant={listCategoryId === "all" ? "primary" : "secondary"}
                  aria-pressed={listCategoryId === "all"}
                  onClick={() => {
                    setListCategoryId("all");
                    setPageIndex(0);
                  }}
                >
                  Semua
                </Button>
                {categories.map((cat) => {
                  const selected = listCategoryId === String(cat.id);
                  return (
                    <Button
                      key={cat.id}
                      type="button"
                      variant={selected ? "primary" : "secondary"}
                      aria-pressed={selected}
                      onClick={() => {
                        setListCategoryId(String(cat.id));
                        setPageIndex(0);
                      }}
                    >
                      {cat.name}
                    </Button>
                  );
                })}
              </div>
            )}

            {!loadError && categoryPageError && (
              <div className="account-load-error" style={{ marginBottom: "12px" }}>
                <p className="field-error" role="alert" style={{ margin: 0 }}>
                  {categoryPageError}
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setCategoryReloadKey((previous) => previous + 1)}
                >
                  Coba lagi
                </Button>
              </div>
            )}

            {!loadError && (visibleProducts === null || categoryPageLoading) && (
              <p className="muted">{categoryPageLoading ? "Memuat produk kategori…" : "Memuat katalog…"}</p>
            )}

            {!loadError &&
              !categoryPageLoading &&
              !categoryPageError &&
              visibleProducts !== null &&
              visibleProducts.length === 0 && (
                <div className="admin-empty">
                  <span className="admin-empty__icon">
                    <IconPackage size={24} />
                  </span>
                  <p className="admin-empty__title">Belum ada produk yang cocok.</p>
                  <p className="admin-empty__desc">
                    Periksa kata kunci pencarian atau atur ulang filter kategori, status, dan stok.
                  </p>
                </div>
              )}

            {!loadError && pagedProducts !== null && pagedProducts.length > 0 && (
              <>
                <div className="table-wrap">
                  <table className="table" aria-label="Daftar barang">
                    <thead>
                      <tr>
                        <th scope="col">Nama &amp; SKU</th>
                        <th scope="col">Kategori</th>
                        <th scope="col" className="num">
                          Harga Jual
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
                      {pagedProducts.map((product) => (
                        <tr key={product.id}>
                          <td>
                            <div className="cell-primary">{product.name}</div>
                            <div className="cell-sub">
                              <code>{product.sku}</code>
                            </div>
                          </td>
                          <td>{product.categoryName}</td>
                          <td className="num">
                            <MoneyText amountRp={product.priceRp} />
                          </td>
                          <td className="num stock-cell">
                            <div className="stock-cell__wrap">
                              <span className="stock-cell__qty">{product.stockOnHand}</span>
                              <StockBadge stock={product.stockOnHand} />
                            </div>
                          </td>
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
                                <IconEdit size={14} />
                                <span>Ubah</span>
                              </Button>
                              <Button
                                variant={product.active ? "secondary" : "primary"}
                                className={product.active ? "btn--outline-danger" : undefined}
                                aria-label={`${product.active ? "Nonaktifkan" : "Aktifkan"} ${product.sku}`}
                                disabled={busyProductId !== null || isSubmitting}
                                onClick={() =>
                                  setConfirmation({ kind: "toggle", product, nextActive: !product.active })
                                }
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

                <div className="admin-pagination">
                  <span>
                    Menampilkan {safePageIndex * pageSize + 1}–
                    {Math.min((safePageIndex + 1) * pageSize, totalVisible)} dari {totalVisible} barang
                  </span>
                  <div className="admin-pagination__controls">
                    <label htmlFor="products-page-size" className="visually-hidden">
                      Baris per halaman
                    </label>
                    <select
                      id="products-page-size"
                      className="input"
                      style={{ width: "auto", minHeight: "36px", padding: "4px 10px" }}
                      value={pageSize}
                      onChange={(event) => {
                        setPageSize(Number(event.target.value));
                        setPageIndex(0);
                      }}
                    >
                      <option value={25}>25 baris</option>
                      <option value={50}>50 baris</option>
                      <option value={100}>100 baris</option>
                    </select>
                    <Button
                      type="button"
                      variant="secondary"
                      className="btn--icon"
                      aria-label="Halaman sebelumnya"
                      disabled={safePageIndex <= 0}
                      onClick={() => setPageIndex((prev) => Math.max(0, prev - 1))}
                    >
                      <IconChevronLeft size={16} />
                    </Button>
                    <span>
                      Hal. {safePageIndex + 1} / {totalPages}
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      className="btn--icon"
                      aria-label="Halaman berikutnya"
                      disabled={safePageIndex >= totalPages - 1}
                      onClick={() => setPageIndex((prev) => Math.min(totalPages - 1, prev + 1))}
                    >
                      <IconChevronRight size={16} />
                    </Button>
                  </div>
                </div>
              </>
            )}

            {!loadError && products !== null && products.length === MAX_PRODUCTS && (
              <p className="muted" role="note" style={{ marginTop: "8px", marginBottom: 0 }}>
                Menampilkan 100 produk pertama. Gunakan pencarian untuk produk lainnya.
              </p>
            )}
          </div>
        </>
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
