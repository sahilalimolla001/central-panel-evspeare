const defaults = {
  websiteUrl: "https://www.evspeare.shop",
  pickerUrl: "https://evsphere-warehouse-mobile-production.up.railway.app",
  backendApi: "https://evsphere-warehouse-backend-production.up.railway.app/api",
  productsEndpoint: "https://www.evspeare.shop/api/mobile/products",
  ordersEndpoint: "https://www.evspeare.shop/api/mobile/orders",
  customersEndpoint: "/customers",
  pickerOrdersEndpoint: "/pick-list",
  returnsEndpoint: "/returns/pick-list",
  updateEndpoint: "/central-panel/update",
  token: "",
  warehouseId: "",
  autoRefreshSeconds: "30",
};

const store = {
  config: loadConfig(),
  products: [],
  orders: [],
  customers: [],
  pickerOrders: [],
  returns: [],
  activeTab: "all",
  editing: null,
  errors: {},
  lastSync: null,
  timer: null,
};

const statuses = ["all", "pending", "shipped", "delivered", "cancel", "return"];
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

document.addEventListener("DOMContentLoaded", () => {
  setDefaultDates();
  bindNavigation();
  bindActions();
  hydrateSettings();
  hydrateEditors();
  renderAll();
  refreshAll();
  startAutoRefresh();
});

function bindNavigation() {
  $$(".nav-stack button").forEach((button) => {
    button.addEventListener("click", () => openPage(button.dataset.page, button.textContent.trim()));
  });
  $$("[data-open-page]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.openPage;
      const nav = $(`.nav-stack [data-page="${target}"]`);
      openPage(target, nav?.textContent.trim() || target);
    });
  });
}

function bindActions() {
  $("#refresh-all").addEventListener("click", refreshAll);
  $("#apply-filter").addEventListener("click", renderAll);
  $("#clear-filter").addEventListener("click", clearFilters);
  $("#global-search").addEventListener("input", renderAll);
  $("#save-config").addEventListener("click", () => {
    saveConfig();
    startAutoRefresh();
    refreshAll();
  });
  $("#login-api").addEventListener("click", loginAndSaveToken);
  $("#close-drawer").addEventListener("click", closeDrawer);
  $("#save-record").addEventListener("click", saveRecord);
  $$("[data-action='load-products']").forEach((button) => button.addEventListener("click", loadProducts));
  $$("[data-action='load-orders']").forEach((button) => button.addEventListener("click", loadOrders));
  $$("[data-action='load-customers']").forEach((button) => button.addEventListener("click", loadCustomers));
  $$("[data-action='load-picker']").forEach((button) => button.addEventListener("click", loadPicker));
  $$("[data-action='load-returns']").forEach((button) => button.addEventListener("click", loadReturns));
  $$("[data-save-editor]").forEach((button) => button.addEventListener("click", () => saveEditor(button.dataset.saveEditor)));
}

function openPage(page, title) {
  $$(".nav-stack button").forEach((item) => item.classList.toggle("active", item.dataset.page === page));
  $$(".page").forEach((panel) => panel.classList.toggle("active", panel.dataset.pagePanel === page));
  $("#page-title").textContent = title;
}

async function refreshAll() {
  setSyncState("Syncing");
  await Promise.allSettled([loadProducts(), loadOrders(), loadCustomers(), loadPicker(), loadReturns()]);
  store.lastSync = new Date();
  setSyncState(Object.keys(store.errors).length ? "Partial" : "Live");
  renderAll();
}

function startAutoRefresh() {
  if (store.timer) window.clearInterval(store.timer);
  const seconds = Number(store.config.autoRefreshSeconds || 0);
  if (seconds >= 10) store.timer = window.setInterval(refreshAll, seconds * 1000);
}

async function loadProducts() {
  await loadRows("products", store.config.productsEndpoint, normalizeProduct);
  renderAll();
}

async function loadOrders() {
  await loadRows("orders", store.config.ordersEndpoint, normalizeOrder);
  renderAll();
}

async function loadCustomers() {
  await loadRows("customers", store.config.customersEndpoint, normalizeCustomer, ["/users", "/customers"]);
  if (!store.customers.length) store.customers = customersFromOrders();
  renderAll();
}

async function loadPicker() {
  await loadRows("pickerOrders", store.config.pickerOrdersEndpoint, normalizePicker, ["/pick-list"]);
  renderAll();
}

async function loadReturns() {
  await loadRows("returns", store.config.returnsEndpoint, normalizeReturn, ["/returns/pick-list"]);
  renderAll();
}

async function loadRows(key, endpoint, normalizer, fallback = []) {
  const candidates = [...new Set([endpoint, ...fallback].filter(Boolean))];
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const payload = await apiGet(candidate);
      store[key] = asArray(payload).map(normalizer);
      delete store.errors[key];
      return;
    } catch (error) {
      lastError = error;
    }
  }
  store[key] = [];
  store.errors[key] = lastError?.message || "Unable to load";
}

async function apiGet(path) {
  const response = await fetch(endpointUrl(path), {
    headers: authHeaders(),
    credentials: "include",
    cache: "no-store",
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Non JSON response ${response.status}`);
  }
  if (!response.ok || data.ok === false) throw new Error(data.message || data.error || `API ${response.status}`);
  return data;
}

async function apiPost(path, body) {
  const response = await fetch(endpointUrl(path), {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.message || data.error || `API ${response.status}`);
  return data;
}

function endpointUrl(path) {
  const value = String(path || "");
  if (/^https?:\/\//i.test(value)) return value;
  return `${store.config.backendApi.replace(/\/+$/, "")}${value.startsWith("/") ? value : `/${value}`}`;
}

function authHeaders() {
  const headers = { Accept: "application/json" };
  if (store.config.token) headers.Authorization = `Bearer ${store.config.token}`;
  if (store.config.warehouseId) headers["X-Warehouse-Id"] = store.config.warehouseId;
  return headers;
}

function renderAll() {
  renderMetrics();
  renderTabs();
  renderOrders();
  renderCustomers();
  renderPickers();
  renderReturns();
  renderProducts();
  renderDashboardLists();
  renderEditLog();
}

function renderMetrics() {
  const filteredOrders = filtered(store.orders, "orders");
  const rows = [
    ["Live orders", filteredOrders.length, "All orders in date/search filter", "blue"],
    ["Pending", countStatus(filteredOrders, ["pending", "new", "placed", "processing"]), "Waiting action", "amber"],
    ["Shipped", countStatus(filteredOrders, ["shipped", "packed", "dispatch", "dispatched"]), "On the way", "blue"],
    ["Delivered", countStatus(filteredOrders, ["delivered", "complete", "completed"]), "Completed", "green"],
    ["Cancel", countStatus(filteredOrders, ["cancel", "cancelled", "canceled"]), "Cancelled orders", "rose"],
    ["Return", filtered(store.returns, "returns").length + countStatus(filteredOrders, ["return", "returned"]), "Return flow", "amber"],
    ["Active customers", filtered(store.customers, "customers").length, "Customer rows", "green"],
    ["Active pickers", activePickers().length, "Picker staff/queue", "blue"],
    ["Active order", activeOrders().length, "Pending + shipped", "amber"],
    ["Catalog", filtered(store.products, "products").length, "Website products", "green"],
    ["Out of stock", store.products.filter((item) => item.stock <= 0).length, "Needs refill", "rose"],
    ["Sync", store.lastSync ? store.lastSync.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "--", "Last update", "blue"],
  ];
  $("#status-metrics").innerHTML = rows.map(([label, value, help, color]) => `
    <article class="metric-card ${color}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(help)}</span>
    </article>
  `).join("");
}

function renderTabs() {
  $("#order-tabs").innerHTML = statuses.map((status) => `
    <button class="${store.activeTab === status ? "active" : ""}" type="button" data-status="${status}">
      ${escapeHtml(statusLabel(status))} ${status === "all" ? store.orders.length : countOrdersForTab(status)}
    </button>
  `).join("");
  $$("#order-tabs [data-status]").forEach((button) => {
    button.addEventListener("click", () => {
      store.activeTab = button.dataset.status;
      renderTabs();
      renderOrders();
    });
  });
}

function renderOrders() {
  let rows = filtered(store.orders, "orders");
  if (store.activeTab !== "all") rows = rows.filter((row) => tabMatches(row.status, store.activeTab));
  $("#orders-table").innerHTML = rows.length ? rows.slice(0, 300).map((item) => rowHtml("orders", item, [
    [item.number, item.createdAt || "No date"],
    [item.customer, item.phone || "No phone"],
    [`Rs. ${formatNumber(item.total)}`, `${item.items || 0} items`],
    [statusPill(item.status), "Status"],
    [item.address || item.warehouse || "-", "Address/Warehouse"],
  ])).join("") : emptyState("Order rows live endpoint/token ke baad dikhenge.", store.errors.orders);
  $("#active-orders-table").innerHTML = activeOrders().slice(0, 8).map((item) => rowHtml("orders", item, [
    [item.number, item.createdAt || "No date"],
    [item.customer, item.phone || "No phone"],
    [statusPill(item.status), "Live status"],
    [`Rs. ${formatNumber(item.total)}`, `${item.items || 0} items`],
    [item.address || "-", "Address"],
  ])).join("") || emptyState("No active orders in current filter.");
}

function renderCustomers() {
  const rows = filtered(store.customers, "customers");
  $("#customers-table").innerHTML = rows.length ? rows.slice(0, 300).map((item) => rowHtml("customers", item, [
    [item.name, item.createdAt || "No date"],
    [item.phone || "-", "Phone"],
    [item.email || "-", "Email"],
    [statusPill(item.status || "active"), "Status"],
    [`${item.orders || 0} orders`, `Value Rs. ${formatNumber(item.value)}`],
  ])).join("") : emptyState("Customer rows ke liye customers/users endpoint connect karein.", store.errors.customers);
}

function renderPickers() {
  const rows = filtered(store.pickerOrders, "pickers");
  $("#pickers-table").innerHTML = rows.length ? rows.slice(0, 300).map((item) => rowHtml("pickers", item, [
    [item.number, item.createdAt || "No date"],
    [item.picker || item.customer, item.phone || "Picker/order"],
    [statusPill(item.status), "Status"],
    [item.warehouse || "-", "Warehouse"],
    [`${item.items || 0} items`, `Rs. ${formatNumber(item.total)}`],
  ])).join("") : emptyState("Picker queue token/login ke baad live dikhega.", store.errors.pickerOrders);
}

function renderReturns() {
  const cancelRows = store.orders.filter((item) => tabMatches(item.status, "cancel")).map((item) => ({
    id: `cancel-${item.id}`,
    number: item.number,
    customer: item.customer,
    phone: item.phone,
    status: "cancel",
    reason: item.reason || "Cancelled order",
    createdAt: item.createdAt,
  }));
  const rows = [...filtered(store.returns, "returns"), ...cancelRows];
  $("#returns-table").innerHTML = rows.length ? rows.slice(0, 300).map((item) => rowHtml("returns", item, [
    [item.number, item.createdAt || "No date"],
    [item.customer, item.phone || "No phone"],
    [statusPill(item.status), "Status"],
    [item.reason || "-", "Reason"],
    [item.orderId || "-", "Order ID"],
  ])).join("") : emptyState("Return/cancel rows endpoint ke baad dikhenge.", store.errors.returns);
}

function renderProducts() {
  const rows = filtered(store.products, "products");
  $("#products-table").innerHTML = rows.length ? rows.slice(0, 300).map((item) => rowHtml("products", item, [
    [item.name, item.sku || "No SKU"],
    [`Rs. ${formatNumber(item.price)}`, item.category || "Catalog"],
    [statusPill(item.stock > 0 ? "active" : "out_of_stock"), "Stock status"],
    [`Stock ${formatNumber(item.stock)}`, "Quantity"],
    [item.source || "Website", "Source"],
  ])).join("") : emptyState("Products public website se load hone chahiye.", store.errors.products);
}

function renderDashboardLists() {
  $("#active-customers").innerHTML = filtered(store.customers, "customers").slice(0, 8).map((item) => miniCard(item.name, item.phone || item.email || "Active", `${item.orders || 0} orders`)).join("") || emptyState("No active customers yet.");
  $("#active-pickers").innerHTML = activePickers().slice(0, 8).map((item) => miniCard(item.picker || item.customer || item.number, item.warehouse || item.status, item.number)).join("") || emptyState("No active pickers yet.");
  renderDateWise();
}

function renderDateWise() {
  const groups = groupByDate(filtered(store.orders, "orders"));
  const max = Math.max(...groups.map((item) => item.count), 1);
  $("#date-wise").innerHTML = groups.length ? groups.slice(0, 10).map((item) => `
    <article class="chart-card">
      <div class="mini-card">
        <strong>${escapeHtml(item.date)}</strong>
        <span>${item.count} orders / Rs. ${formatNumber(item.total)}</span>
      </div>
      <div class="bar"><i style="width:${Math.max(4, (item.count / max) * 100)}%"></i></div>
    </article>
  `).join("") : emptyState("Date-wise orders available nahi hain.");
}

function rowHtml(type, item, cells) {
  return `
    <article class="data-row">
      ${cells.map(([value, help]) => `<div class="row-cell">${safeCell(value)}<small>${escapeHtml(help || "")}</small></div>`).join("")}
      <div class="row-actions">
        <button type="button" data-edit-type="${type}" data-edit-id="${escapeHtml(item.id)}">Edit</button>
      </div>
    </article>
  `;
}

function safeCell(value) {
  const raw = String(value ?? "");
  if (raw.startsWith('<mark class="status-pill')) return raw;
  return escapeHtml(raw);
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-edit-type]");
  if (!button) return;
  openDrawer(button.dataset.editType, button.dataset.editId);
});

function openDrawer(type, id) {
  const item = collectionFor(type).find((row) => String(row.id) === String(id));
  if (!item) return;
  store.editing = { type, id, item };
  $("#drawer-kicker").textContent = type;
  $("#drawer-title").textContent = item.number || item.name || item.sku || "Record";
  $("#record-form").innerHTML = editableFields(type, item).map(([name, label, value]) => `
    <label>${escapeHtml(label)}<input name="${escapeHtml(name)}" value="${escapeHtml(value)}" /></label>
  `).join("");
  $("#edit-drawer").classList.add("open");
  $("#edit-drawer").setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  $("#edit-drawer").classList.remove("open");
  $("#edit-drawer").setAttribute("aria-hidden", "true");
  store.editing = null;
}

async function saveRecord() {
  if (!store.editing) return;
  const updates = Object.fromEntries(new FormData($("#record-form")).entries());
  const rows = collectionFor(store.editing.type);
  const index = rows.findIndex((row) => String(row.id) === String(store.editing.id));
  if (index >= 0) rows[index] = { ...rows[index], ...updates };
  saveLocalDraft(`record:${store.editing.type}:${store.editing.id}`, updates);
  try {
    await apiPost(store.config.updateEndpoint, { type: store.editing.type, id: store.editing.id, updates });
    toast("Record saved to backend.");
  } catch {
    toast("Backend update endpoint not ready. Draft saved locally.");
  }
  closeDrawer();
  renderAll();
}

async function saveEditor(section) {
  const form = $(`[data-editor="${section}"]`);
  const data = Object.fromEntries(new FormData(form).entries());
  saveLocalDraft(`editor:${section}`, data);
  try {
    await apiPost(store.config.updateEndpoint, { type: "editor", section, updates: data });
    toast(`${section} settings saved to backend.`);
  } catch {
    toast(`${section} draft saved locally. Backend update endpoint connect karein.`);
  }
  renderEditLog();
}

function editableFields(type, item) {
  const common = {
    orders: [["status", "Status", item.status], ["customer", "Customer", item.customer], ["phone", "Phone", item.phone], ["address", "Address", item.address], ["total", "Total", item.total]],
    customers: [["name", "Name", item.name], ["phone", "Phone", item.phone], ["email", "Email", item.email], ["status", "Status", item.status]],
    pickers: [["status", "Status", item.status], ["picker", "Picker", item.picker], ["warehouse", "Warehouse", item.warehouse]],
    returns: [["status", "Status", item.status], ["reason", "Reason", item.reason], ["customer", "Customer", item.customer]],
    products: [["name", "Product name", item.name], ["sku", "SKU", item.sku], ["price", "Price", item.price], ["stock", "Stock", item.stock], ["category", "Category", item.category]],
  };
  return common[type] || Object.entries(item).slice(0, 8).map(([key, value]) => [key, key, value]);
}

function collectionFor(type) {
  return {
    orders: store.orders,
    customers: store.customers,
    pickers: store.pickerOrders,
    returns: store.returns,
    products: store.products,
  }[type] || [];
}

function hydrateSettings() {
  const form = $("#settings-form");
  Object.entries(store.config).forEach(([key, value]) => {
    if (form.elements[key]) form.elements[key].value = value;
  });
}

function hydrateEditors() {
  $$("[data-editor]").forEach((form) => {
    const saved = loadLocalDraft(`editor:${form.dataset.editor}`);
    Object.entries(saved).forEach(([key, value]) => {
      if (form.elements[key]) form.elements[key].value = value;
    });
  });
}

function saveConfig() {
  const form = $("#settings-form");
  store.config = { ...store.config, ...Object.fromEntries(new FormData(form).entries()) };
  store.config.backendApi = store.config.backendApi.replace(/\/+$/, "");
  localStorage.setItem("evspeareLiveAdminConfig", JSON.stringify(store.config));
  toast("Config saved.");
}

async function loginAndSaveToken() {
  const form = $("#login-form");
  const email = form.elements.email.value.trim();
  const password = form.elements.password.value;
  if (!email || !password) {
    $("#login-result").innerHTML = miniCard("Missing login", "Email/password required", "");
    return;
  }
  saveConfig();
  try {
    const data = await apiPost("/login", { email, password });
    const token = data.token || data.access_token || data.accessToken || "";
    if (token) {
      store.config.token = token;
      localStorage.setItem("evspeareLiveAdminConfig", JSON.stringify(store.config));
      hydrateSettings();
      $("#login-result").innerHTML = miniCard("Token saved", "Live protected panels unlocked", "");
    } else {
      $("#login-result").innerHTML = miniCard("Login done", "No token returned, cookie session may work", "");
    }
    refreshAll();
  } catch (error) {
    $("#login-result").innerHTML = miniCard("Login failed", error.message, "");
  }
}

function filtered(rows, type) {
  const query = $("#global-search").value.trim().toLowerCase();
  const from = $("#date-from").value;
  const to = $("#date-to").value;
  return rows.filter((row) => {
    const blob = JSON.stringify(row).toLowerCase();
    const date = dateKey(row.createdAt);
    const queryOk = !query || blob.includes(query);
    const fromOk = !from || !date || date >= from;
    const toOk = !to || !date || date <= to;
    return queryOk && fromOk && toOk;
  });
}

function activeOrders() {
  return filtered(store.orders, "orders").filter((item) => ["pending", "new", "placed", "processing", "shipped", "packed", "dispatch", "dispatched"].includes(String(item.status).toLowerCase()));
}

function activePickers() {
  return filtered(store.pickerOrders, "pickers").filter((item) => !["delivered", "complete", "cancelled"].includes(String(item.status).toLowerCase()));
}

function customersFromOrders() {
  const map = new Map();
  store.orders.forEach((order) => {
    const key = order.phone || order.customer;
    if (!key) return;
    const current = map.get(key) || { id: key, name: order.customer, phone: order.phone, email: "", status: "active", orders: 0, value: 0, createdAt: order.createdAt };
    current.orders += 1;
    current.value += Number(order.total || 0);
    map.set(key, current);
  });
  return Array.from(map.values());
}

function countOrdersForTab(tab) {
  return store.orders.filter((row) => tabMatches(row.status, tab)).length;
}

function countStatus(rows, names) {
  return rows.filter((row) => names.some((name) => tabMatches(row.status, name))).length;
}

function tabMatches(status, tab) {
  const value = String(status || "").toLowerCase();
  if (tab === "cancel") return ["cancel", "cancelled", "canceled"].includes(value);
  if (tab === "return") return ["return", "returned", "return_requested", "approved"].includes(value);
  if (tab === "pending") return ["pending", "new", "placed", "processing"].includes(value);
  if (tab === "shipped") return ["shipped", "packed", "dispatch", "dispatched"].includes(value);
  if (tab === "delivered") return ["delivered", "complete", "completed"].includes(value);
  return value === tab;
}

function groupByDate(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const key = dateKey(row.createdAt) || "No date";
    const current = map.get(key) || { date: key, count: 0, total: 0 };
    current.count += 1;
    current.total += Number(row.total || 0);
    map.set(key, current);
  });
  return Array.from(map.values()).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function setDefaultDates() {
  const today = new Date();
  const prior = new Date();
  prior.setDate(today.getDate() - 30);
  $("#date-from").value = prior.toISOString().slice(0, 10);
  $("#date-to").value = today.toISOString().slice(0, 10);
}

function clearFilters() {
  $("#global-search").value = "";
  $("#date-from").value = "";
  $("#date-to").value = "";
  renderAll();
}

function setSyncState(state) {
  $("#sync-state").textContent = state;
  $("#last-sync").textContent = store.lastSync ? `Last: ${store.lastSync.toLocaleString("en-IN")}` : "Not synced yet";
}

function renderEditLog() {
  const keys = Object.keys(localStorage).filter((key) => key.startsWith("evspeareDraft:"));
  $("#edit-log").innerHTML = keys.length ? keys.slice(-8).reverse().map((key) => miniCard(key.replace("evspeareDraft:", ""), "Local draft saved", "")).join("") : emptyState("No edits yet.");
}

function normalizeProduct(item, index = 0) {
  return {
    id: String(item.id || item.sourceId || item.sku || index),
    name: text(item, ["name", "title", "product_name"]) || `Product ${index + 1}`,
    sku: text(item, ["sku", "ean", "barcode", "product_sku"]),
    price: number(item, ["price", "sale_price", "selling_price", "mrp", "amount"]),
    stock: number(item, ["stockQuantity", "stock_quantity", "available_quantity", "quantity", "stock"]),
    category: text(item, ["category", "category_name"]) || "Catalog",
    source: text(item, ["source"]) || "Website",
  };
}

function normalizeOrder(item, index = 0) {
  return {
    id: String(item.id || item.orderId || item.order_number || item.website_order_id || index),
    number: text(item, ["order_number", "website_order_id", "orderId", "id"]) || `Order ${index + 1}`,
    customer: text(item, ["customer_name", "name"]) || text(item.customer, ["name"]) || "Customer",
    phone: text(item, ["phone", "mobile", "customer_phone"]) || text(item.customer, ["phone", "mobile"]),
    address: text(item, ["address", "delivery_address"]) || text(item.address, ["line1", "full"]),
    status: text(item, ["status", "order_status", "fulfillment_status"]) || "pending",
    total: number(item, ["total", "amount", "grand_total"]) || number(item.amounts, ["total"]),
    items: Array.isArray(item.items) ? item.items.length : number(item, ["item_count", "items_count"]),
    createdAt: text(item, ["created_at", "createdAt", "date", "ordered_at"]),
    reason: text(item, ["reason", "cancel_reason"]),
  };
}

function normalizeCustomer(item, index = 0) {
  return {
    id: String(item.id || item.phone || item.email || index),
    name: text(item, ["name", "customer_name", "full_name"]) || `Customer ${index + 1}`,
    phone: text(item, ["phone", "mobile", "customer_phone"]),
    email: text(item, ["email", "customer_email"]),
    status: text(item, ["status"]) || "active",
    orders: number(item, ["orders", "order_count", "total_orders"]),
    value: number(item, ["value", "total_spent"]),
    createdAt: text(item, ["created_at", "createdAt", "date"]),
  };
}

function normalizePicker(item, index = 0) {
  const order = normalizeOrder(item, index);
  return {
    ...order,
    picker: text(item, ["picker_name", "picker", "staff_name"]) || text(item.user, ["name"]),
    warehouse: text(item, ["warehouse", "warehouse_code"]) || text(item.warehouse, ["code", "name"]),
  };
}

function normalizeReturn(item, index = 0) {
  return {
    id: String(item.id || item.return_number || index),
    number: text(item, ["return_number", "website_order_id", "id"]) || `Return ${index + 1}`,
    orderId: text(item, ["order_id", "orderId", "website_order_id"]),
    customer: text(item, ["customer_name", "name"]) || text(item.customer, ["name"]) || "Customer",
    phone: text(item, ["phone", "mobile"]) || text(item.customer, ["phone", "mobile"]),
    status: text(item, ["status"]) || "return",
    reason: text(item, ["reason", "note", "details"]) || "Return",
    createdAt: text(item, ["created_at", "createdAt", "date"]),
  };
}

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["products", "orders", "customers", "users", "items", "returns", "data", "results", "records"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function text(item, keys) {
  if (typeof item === "string" || typeof item === "number") return String(item);
  if (!item || typeof item !== "object") return "";
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null && item[key] !== "") return String(item[key]);
  }
  return "";
}

function number(item, keys) {
  if (!item || typeof item !== "object") return 0;
  for (const key of keys) {
    const raw = item[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const match = String(raw).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    if (match) return Number(match[0]);
  }
  return 0;
}

function dateKey(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  const match = String(value).match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function statusLabel(value) {
  return value === "all" ? "All" : value.charAt(0).toUpperCase() + value.slice(1);
}

function statusPill(value) {
  const raw = String(value || "unknown");
  const key = raw.toLowerCase().replace(/\s+/g, "_");
  return `<mark class="status-pill ${escapeHtml(key)}">${escapeHtml(raw)}</mark>`;
}

function miniCard(title, body, side) {
  return `<article class="mini-card"><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(body || "")}</span></div><b>${escapeHtml(side || "")}</b></article>`;
}

function emptyState(message, detail = "") {
  return `<div class="empty"><strong>${escapeHtml(message)}</strong>${detail ? `<p>${escapeHtml(detail)}</p>` : ""}</div>`;
}

function saveLocalDraft(key, data) {
  localStorage.setItem(`evspeareDraft:${key}`, JSON.stringify({ data, savedAt: new Date().toISOString() }));
}

function loadLocalDraft(key) {
  try {
    return JSON.parse(localStorage.getItem(`evspeareDraft:${key}`) || "{}").data || {};
  } catch {
    return {};
  }
}

function loadConfig() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem("evspeareLiveAdminConfig") || "{}") };
  } catch {
    return { ...defaults };
  }
}

function formatNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed.toLocaleString("en-IN") : "0";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => node.classList.remove("show"), 2400);
}
