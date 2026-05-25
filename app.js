const defaults = {
  websiteUrl: "https://www.evspeare.shop",
  pickerUrl: "https://evsphere-warehouse-mobile-production.up.railway.app",
  backendUrl: "https://evsphere-warehouse-backend-production.up.railway.app",
  backendApi: "https://evsphere-warehouse-backend-production.up.railway.app/api",
  productsEndpoint: "https://www.evspeare.shop/api/mobile/products",
  ordersEndpoint: "https://www.evspeare.shop/api/mobile/orders",
  customersEndpoint: "/customers",
  inventoryEndpoint: "/inventory",
  dashboardEndpoint: "/dashboard",
  pickerOrdersEndpoint: "/pick-list",
  returnsEndpoint: "/returns/pick-list",
  pickerToken: "",
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
  inventory: [],
  warehouse: {},
  health: {},
  errors: {},
  lastUpdated: null,
  refreshTimer: null,
};

const modules = [
  { key: "products", label: "Products", page: "products", source: "Website catalog", endpointKey: "productsEndpoint" },
  { key: "orders", label: "Orders", page: "orders", source: "Customer app", endpointKey: "ordersEndpoint" },
  { key: "customers", label: "Customers", page: "customers", source: "Customer app", endpointKey: "customersEndpoint" },
  { key: "pickerOrders", label: "Picker Queue", page: "picker", source: "Picker app", endpointKey: "pickerOrdersEndpoint" },
  { key: "returns", label: "Returns", page: "returns", source: "Warehouse returns", endpointKey: "returnsEndpoint" },
  { key: "inventory", label: "Inventory", page: "inventory", source: "Warehouse stock", endpointKey: "inventoryEndpoint" },
  { key: "warehouse", label: "Warehouse", page: "warehouse", source: "Backend dashboard", endpointKey: "dashboardEndpoint" },
];

const pageCards = {
  picker: [
    ["Orders", "Pending, picking and packed order queue", ["Pending", "Picking", "Packed"]],
    ["Ship", "Ready-to-ship dispatch panel", ["Packed", "Dispatch"]],
    ["Return", "Approved returns receive flow", ["Scan", "PV", "Inspection"]],
    ["Stock", "Stock-in and bin update workflow", ["SKU", "Bin", "Qty"]],
    ["Move", "Move product between bins", ["From", "To", "Qty"]],
    ["Inventory", "Bin inventory lookup", ["Location", "Available"]],
  ],
  warehouse: [
    ["Users", "Admin, manager and picker accounts", ["Roles", "Login"]],
    ["Products", "SKU, price, image and stock master", ["Catalog", "Inventory"]],
    ["Orders", "Customer orders and fulfillment status", ["Pick", "Pack", "Ship"]],
    ["Returns", "Approval, receive and PV pipeline", ["Return", "Refund"]],
    ["Locations", "Warehouse bin and movement map", ["Barcode", "Stock"]],
  ],
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

document.addEventListener("DOMContentLoaded", () => {
  bindNavigation();
  bindActions();
  hydrateSettings();
  renderStaticCards();
  renderAll();
  refreshAll();
  startAutoRefresh();
});

function bindNavigation() {
  $$(".nav-stack button").forEach((button) => {
    button.addEventListener("click", () => showPage(button.dataset.page, button.textContent.trim()));
  });
}

function bindActions() {
  $("#refresh-all").addEventListener("click", refreshAll);
  $("#save-config").addEventListener("click", () => {
    saveSettings();
    startAutoRefresh();
  });
  $("#login-api").addEventListener("click", loginAndSaveToken);
  $("#product-search").addEventListener("input", renderProducts);
  $$("[data-action='refresh-all']").forEach((button) => button.addEventListener("click", refreshAll));
  $$("[data-action='load-products']").forEach((button) => button.addEventListener("click", loadProducts));
  $$("[data-action='load-orders']").forEach((button) => button.addEventListener("click", loadOrders));
  $$("[data-action='load-customers']").forEach((button) => button.addEventListener("click", loadCustomers));
  $$("[data-action='load-picker']").forEach((button) => button.addEventListener("click", loadPickerData));
  $$("[data-action='load-returns']").forEach((button) => button.addEventListener("click", loadReturns));
  $$("[data-action='load-inventory']").forEach((button) => button.addEventListener("click", loadInventory));
  $$("[data-action='test-health']").forEach((button) => button.addEventListener("click", testHealth));
}

function showPage(page, title) {
  $$(".nav-stack button").forEach((item) => item.classList.toggle("active", item.dataset.page === page));
  $$(".page").forEach((panel) => panel.classList.toggle("active", panel.dataset.pagePanel === page));
  $("#page-title").textContent = title;
}

async function refreshAll() {
  toast("Live data sync started...");
  await Promise.allSettled([
    testHealth(),
    loadProducts(),
    loadOrders(),
    loadCustomers(),
    loadPickerData(),
    loadReturns(),
    loadInventory(),
    loadWarehouse(),
  ]);
  store.lastUpdated = new Date();
  renderAll();
  toast("All live panels updated.");
}

function startAutoRefresh() {
  if (store.refreshTimer) window.clearInterval(store.refreshTimer);
  const seconds = Number(store.config.autoRefreshSeconds || 0);
  if (!seconds || seconds < 10) return;
  store.refreshTimer = window.setInterval(refreshAll, seconds * 1000);
}

async function testHealth() {
  const checks = [
    ["Website", store.config.websiteUrl],
    ["Picker App", store.config.pickerUrl],
    ["Backend API", `${store.config.backendApi}/health`],
    ["Products API", endpointUrl(store.config.productsEndpoint)],
  ];

  const results = await Promise.all(checks.map(async ([name, url]) => {
    try {
      const response = await fetch(url, { cache: "no-store" });
      return [name, response.ok ? "ok" : "warn", `${response.status} ${response.statusText}`];
    } catch (error) {
      return [name, "fail", error.message || "Connection failed"];
    }
  }));

  store.health = Object.fromEntries(results.map(([name, state, detail]) => [name, { state, detail }]));
  renderHealth();
}

async function loadProducts() {
  await loadModule("products", store.config.productsEndpoint, normalizeProduct);
  renderProducts();
}

async function loadOrders() {
  await loadModule("orders", store.config.ordersEndpoint, normalizeOrder);
  renderOrders();
}

async function loadCustomers() {
  await loadModule("customers", store.config.customersEndpoint, normalizeCustomer, { auth: true, candidates: ["/users", "/customers"] });
  renderCustomers();
}

async function loadPickerData() {
  await loadModule("pickerOrders", store.config.pickerOrdersEndpoint, normalizeOrder, { auth: true });
  renderPicker();
}

async function loadReturns() {
  await loadModule("returns", store.config.returnsEndpoint, normalizeReturn, { auth: true });
  renderReturns();
}

async function loadInventory() {
  await loadModule("inventory", store.config.inventoryEndpoint, normalizeInventory, {
    auth: true,
    candidates: ["/inventory", "/products", "/stock", "/locations"],
  });
  if (!store.inventory.length && store.products.length) {
    store.inventory = store.products.map((product) => ({
      sku: product.sku,
      name: product.name,
      location: product.location || "Catalog",
      available: product.stock,
      total: product.stock,
      status: product.stock > 0 ? "available" : "out_of_stock",
    }));
  }
  renderInventory();
}

async function loadWarehouse() {
  try {
    const data = await apiGet(store.config.dashboardEndpoint, { auth: true });
    store.warehouse = data && typeof data === "object" ? data : {};
    delete store.errors.warehouse;
  } catch (error) {
    store.warehouse = {};
    store.errors.warehouse = `${error.message}. Warehouse dashboard login/token required ho sakta hai.`;
  }
  renderWarehouse();
}

async function loadModule(key, endpoint, normalizer, options = {}) {
  const candidates = [endpoint, ...(options.candidates || [])].filter(Boolean);
  let lastError = null;
  for (const candidate of [...new Set(candidates)]) {
    try {
      const payload = await apiGet(candidate, { auth: options.auth });
      store[key] = asArray(payload).map(normalizer);
      delete store.errors[key];
      return;
    } catch (error) {
      lastError = error;
    }
  }
  store[key] = [];
  store.errors[key] = `${lastError?.message || "Unable to load data"}. ${options.auth ? "Login/token required ho sakta hai." : ""}`;
}

async function apiGet(path, options = {}) {
  const headers = { Accept: "application/json" };
  if (options.auth) Object.assign(headers, authHeaders());
  const response = await fetch(endpointUrl(path), {
    headers,
    credentials: "include",
    cache: "no-store",
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Non-JSON response (${response.status})`);
  }
  if (!response.ok || data.ok === false) throw new Error(data.message || data.error || `API error ${response.status}`);
  return data;
}

function endpointUrl(path) {
  const value = String(path || "");
  if (/^https?:\/\//i.test(value)) return value;
  return `${store.config.backendApi.replace(/\/+$/, "")}${value.startsWith("/") ? value : `/${value}`}`;
}

function authHeaders() {
  const headers = {};
  if (store.config.pickerToken) headers.Authorization = `Bearer ${store.config.pickerToken}`;
  if (store.config.warehouseId) headers["X-Warehouse-Id"] = store.config.warehouseId;
  return headers;
}

function renderAll() {
  renderHealth();
  renderMetrics();
  renderModules();
  renderProducts();
  renderOrders();
  renderCustomers();
  renderPicker();
  renderReturns();
  renderInventory();
  renderWarehouse();
  renderNotes();
}

function renderHealth() {
  const entries = Object.entries(store.health);
  $("#source-count").textContent = `${entries.filter(([, item]) => item.state === "ok").length} connected`;
  $("#status-grid").innerHTML = entries.length
    ? entries.map(([name, item]) => `
      <article class="status-card ${item.state}">
        <span>${escapeHtml(name)}</span>
        <strong>${stateLabel(item.state)}</strong>
        <span>${escapeHtml(item.detail)}</span>
      </article>
    `).join("")
    : `<article class="status-card warn"><span>Sources</span><strong>Waiting</strong><span>Run refresh to test live systems.</span></article>`;

  renderDiagnostics();
}

function renderMetrics() {
  const orderTotal = store.orders.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const stock = store.inventory.reduce((sum, item) => sum + Number(item.available || 0), 0);
  const pending = store.pickerOrders.filter((item) => ["pending", "picking"].includes(String(item.status).toLowerCase())).length;
  const lowStock = store.inventory.filter((item) => Number(item.available || 0) <= 1).length;
  const metrics = [
    ["Products", store.products.length, "Website catalog live rows"],
    ["Orders", store.orders.length, `Customer order value Rs. ${formatNumber(orderTotal)}`],
    ["Customers", store.customers.length || "--", "Users/customer feed"],
    ["Picker queue", pending, "Pending or active picking"],
    ["Returns", store.returns.length, "Return receive and PV flow"],
    ["Inventory qty", stock || "--", "Available stock across rows"],
    ["Low stock", lowStock || "--", "Items at 1 qty or less"],
    ["Status", healthLabel(), lastUpdatedText()],
  ];

  $("#metric-grid").innerHTML = metrics.map(metricCard).join("");
  $("#hero-products").textContent = store.products.length || "--";
  $("#hero-orders").textContent = store.orders.length || "--";
  $("#hero-modules").textContent = `${modules.length}`;

  renderSummaryCards("products-summary", [
    ["Total products", store.products.length, "Rows from website catalog"],
    ["In stock", store.products.filter((item) => item.stock > 0).length, "Available items"],
    ["Out of stock", store.products.filter((item) => item.stock <= 0).length, "Needs attention"],
    ["Categories", new Set(store.products.map((item) => item.category)).size || "--", "Unique categories"],
  ]);

  renderSummaryCards("orders-summary", [
    ["Orders", store.orders.length, "Customer app feed"],
    ["Value", `Rs. ${formatNumber(orderTotal)}`, "Visible order total"],
    ["Open", countStatus(store.orders, ["new", "pending", "placed"]), "New/pending orders"],
    ["Completed", countStatus(store.orders, ["delivered", "complete", "completed"]), "Fulfilled orders"],
  ]);

  renderSummaryCards("customers-summary", [
    ["Customers", store.customers.length || "--", "Loaded user rows"],
    ["With phone", store.customers.filter((item) => item.phone).length || "--", "Phone captured"],
    ["With email", store.customers.filter((item) => item.email).length || "--", "Email captured"],
    ["Protected", store.errors.customers ? "Yes" : "No", "Token requirement"],
  ]);

  renderSummaryCards("returns-summary", [
    ["Returns", store.returns.length, "Return queue"],
    ["Approved", countStatus(store.returns, ["approved"]), "Ready to receive"],
    ["Inspection", countStatus(store.returns, ["inspection"]), "PV needed"],
    ["Picked", countStatus(store.returns, ["return_picked", "picked"]), "Received rows"],
  ]);

  renderSummaryCards("inventory-summary", [
    ["Inventory rows", store.inventory.length || "--", "Stock records"],
    ["Available qty", stock || "--", "Visible stock"],
    ["Low stock", lowStock || "--", "Reorder watch"],
    ["Locations", new Set(store.inventory.map((item) => item.location).filter(Boolean)).size || "--", "Bins/locations"],
  ]);
}

function renderModules() {
  $("#module-grid").innerHTML = modules.map((module) => {
    const value = module.key === "warehouse" ? Object.keys(store.warehouse || {}).length : (store[module.key] || []).length;
    const error = store.errors[module.key];
    return `
      <article class="module-card ${error ? "warn" : "ok"}" data-jump="${module.page}">
        <div>
          <span>${escapeHtml(module.source)}</span>
          <strong>${escapeHtml(module.label)}</strong>
        </div>
        <b>${value || "--"}</b>
        <p>${error ? escapeHtml(error) : "Live panel ready"}</p>
      </article>
    `;
  }).join("");
  $$("#module-grid [data-jump]").forEach((card) => {
    card.addEventListener("click", () => {
      const page = card.dataset.jump;
      const button = $(`.nav-stack [data-page="${page}"]`);
      if (button) showPage(page, button.textContent.trim());
    });
  });
}

function renderProducts() {
  const query = ($("#product-search")?.value || "").toLowerCase();
  const rows = store.products.filter((item) => [item.name, item.sku, item.category, item.status].join(" ").toLowerCase().includes(query));
  $("#products-table").innerHTML = rows.length
    ? rows.slice(0, 200).map((item) => dataRow([
      strong(item.name),
      item.sku || "-",
      `Rs. ${formatNumber(item.price)}`,
      item.category || "Catalog",
      statusPill(item.stock > 0 ? "available" : "out_of_stock"),
      `Stock ${formatNumber(item.stock)}`,
    ])).join("")
    : emptyState("Products load nahi huye. Website catalog ya backend permission check karein.", store.errors.products);
}

function renderOrders() {
  $("#orders-table").innerHTML = store.orders.length
    ? store.orders.slice(0, 200).map((item) => dataRow([
      strong(item.number),
      item.customer,
      item.phone || "-",
      statusPill(item.status),
      `Rs. ${formatNumber(item.total)}`,
      item.createdAt || "-",
    ])).join("")
    : emptyState("Customer order rows protected ho sakte hain.", store.errors.orders);
}

function renderCustomers() {
  $("#customers-table").innerHTML = store.customers.length
    ? store.customers.slice(0, 200).map((item) => dataRow([
      strong(item.name),
      item.phone || "-",
      item.email || "-",
      statusPill(item.role || "customer"),
      item.orders ? `${item.orders} orders` : "-",
      item.createdAt || "-",
    ])).join("")
    : emptyState("Customer data token/database API ke baad live dikhega.", store.errors.customers);
}

function renderPicker() {
  const pickRows = store.pickerOrders.length
    ? store.pickerOrders.slice(0, 200).map((item) => dataRow([
      strong(item.number),
      item.customer,
      item.items ? `${item.items} items` : "-",
      statusPill(item.status),
      item.warehouse || "-",
      `Rs. ${formatNumber(item.total)}`,
    ])).join("")
    : emptyState("Picker queue login/token protected ho sakta hai.", store.errors.pickerOrders);
  $("#picker-orders-table").innerHTML = pickRows;
  $("#returns-table").innerHTML = returnRowsHtml();
}

function renderReturns() {
  const html = returnRowsHtml();
  $("#returns-table").innerHTML = html;
  $("#returns-full-table").innerHTML = html;
}

function returnRowsHtml() {
  return store.returns.length
    ? store.returns.slice(0, 200).map((item) => dataRow([
      strong(item.number),
      item.customer,
      item.orderId || "-",
      statusPill(item.status),
      item.reason || "-",
      item.createdAt || "-",
    ])).join("")
    : emptyState("Approved returns load nahi huye.", store.errors.returns);
}

function renderInventory() {
  $("#inventory-table").innerHTML = store.inventory.length
    ? store.inventory.slice(0, 200).map((item) => dataRow([
      strong(item.name),
      item.sku || "-",
      item.location || "-",
      `Available ${formatNumber(item.available)}`,
      `Total ${formatNumber(item.total)}`,
      statusPill(item.status),
    ])).join("")
    : emptyState("Inventory endpoint/database API connect hone ke baad stock rows live dikhenge.", store.errors.inventory);

  $("#inventory-actions").innerHTML = [
    ["Stock In", "Picker app stock-in flow se SKU, bin aur quantity update hoti hai."],
    ["Move Stock", "From-bin to to-bin movement ka live audit yahan add hoga."],
    ["Bin Lookup", "Location inventory endpoint connect hote hi bin-wise rows dikhenge."],
  ].map(noteCard).join("");
}

function renderWarehouse() {
  const rows = [
    ["Dashboard", valueFrom(store.warehouse, ["pending_orders", "pendingOrders", "orders"], "--"), "Live backend summary"],
    ["Products API", store.products.length || "--", "Catalog visible"],
    ["Pick List", store.pickerOrders.length || "--", "Picker workflow"],
    ["Returns", store.returns.length || "--", "Reverse logistics"],
    ["Inventory", store.inventory.length || "--", "Stock records"],
    ["Users", store.customers.length || "--", "Customer/user rows"],
  ];
  $("#warehouse-table").innerHTML = rows.map(([name, value, help]) => dataRow([strong(name), value, help, statusPill(value === "--" ? "locked" : "connected")])).join("");
  $("#service-map").innerHTML = [
    ["Website", store.config.websiteUrl],
    ["Picker App", store.config.pickerUrl],
    ["Backend", store.config.backendUrl],
    ["Backend API", store.config.backendApi],
  ].map(([title, url]) => `<article><strong>${escapeHtml(title)}</strong><p><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a></p></article>`).join("");
  renderDiagnostics();
}

function renderDiagnostics() {
  const log = $("#diagnostic-log");
  if (!log) return;
  const health = Object.entries(store.health).map(([name, item]) => [name, `${stateLabel(item.state)} - ${item.detail}`]);
  const errors = Object.entries(store.errors).map(([name, detail]) => [labelFor(name), detail]);
  const rows = [...health, ...errors];
  log.innerHTML = rows.length
    ? rows.map(([title, body]) => `<article><strong>${escapeHtml(title)}</strong><p>${escapeHtml(body)}</p></article>`).join("")
    : `<div class="empty">No diagnostics yet.</div>`;
}

function renderNotes() {
  const notes = [
    ["End-to-end ready", "Products public website se live load ho rahe hain. Orders, picker, returns, users aur inventory token/database API ke saath unlock honge."],
    ["Same database setup", "Direct browser se DB connect mat karein. Hosted backend API ko same database se connect karke panel ko API rows dena best rahega."],
    ["Auto refresh", `${store.config.autoRefreshSeconds || 30} seconds par live panels refresh honge.`],
  ];
  $("#note-list").innerHTML = notes.map(noteCard).join("");
}

function renderStaticCards() {
  for (const [key, rows] of Object.entries(pageCards)) {
    const node = $(`#${key}-map`);
    if (!node) continue;
    node.innerHTML = rows.map(([title, body, chips]) => `
      <article class="page-card">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(body)}</span>
        <div class="chip-row">${chips.map((chip) => `<span class="chip">${escapeHtml(chip)}</span>`).join("")}</div>
      </article>
    `).join("");
  }
}

function renderSummaryCards(id, cards) {
  const node = $(`#${id}`);
  if (!node) return;
  node.innerHTML = cards.map(([label, value, help]) => `
    <article class="page-card compact-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(help)}</span>
    </article>
  `).join("");
}

function hydrateSettings() {
  const form = $("#settings-form");
  Object.entries(store.config).forEach(([key, value]) => {
    if (form.elements[key]) form.elements[key].value = value;
  });
}

function saveSettings() {
  const form = $("#settings-form");
  store.config = { ...store.config, ...Object.fromEntries(new FormData(form).entries()) };
  store.config.backendApi = store.config.backendApi.replace(/\/+$/, "");
  store.config.backendUrl = store.config.backendApi.replace(/\/api\/?$/, "");
  localStorage.setItem("evspeareCentralConfig", JSON.stringify(store.config));
  toast("Configuration saved.");
}

async function loginAndSaveToken() {
  const form = $("#login-form");
  const email = form.elements.email.value.trim();
  const password = form.elements.password.value;
  if (!email || !password) {
    showLoginResult("Missing details", "Email aur password dono required hain.");
    return;
  }

  saveSettings();
  showLoginResult("Logging in", "Backend se token request ho raha hai...");

  try {
    const response = await fetch(`${store.config.backendApi}/login`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.message || `Login failed ${response.status}`);

    const token = data.token || data.access_token || data.accessToken || "";
    if (token) {
      store.config.pickerToken = token;
      localStorage.setItem("evspeareCentralConfig", JSON.stringify(store.config));
      hydrateSettings();
      showLoginResult("Token saved", "Bearer token browser local storage mein save ho gaya. Live panels reload ho rahe hain.");
    } else {
      showLoginResult("Login done", "Login successful hai, lekin bearer token return nahi hua. Cookie session set ho sakta hai.");
    }
    await refreshAll();
  } catch (error) {
    showLoginResult("Login failed", error.message);
  }
}

function showLoginResult(title, body) {
  $("#login-result").innerHTML = `<article><strong>${escapeHtml(title)}</strong><p>${escapeHtml(body)}</p></article>`;
  toast(title);
}

function loadConfig() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem("evspeareCentralConfig") || "{}") };
  } catch {
    return { ...defaults };
  }
}

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["products", "items", "orders", "returns", "customers", "users", "inventory", "locations", "data", "results", "records", "nodes"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  if (Array.isArray(payload.edges)) return payload.edges.map((item) => item.node || item);
  return [];
}

function normalizeProduct(item, index = 0) {
  const stock = numberFrom(item, ["stockQuantity", "stock_quantity", "available_quantity", "availableStock", "quantity", "qty", "stock"]);
  return {
    name: textFrom(item, ["name", "title", "product_name"]) || `Product ${index + 1}`,
    sku: textFrom(item, ["sku", "product_sku", "barcode", "ean", "id"]),
    price: numberFrom(item, ["price", "sale_price", "selling_price", "amount", "mrp"]),
    stock,
    category: textFrom(item, ["category", "category_name", "type", "source"]) || "Catalog",
    status: stock > 0 ? "available" : "out_of_stock",
    location: textFrom(item, ["location", "bin", "warehouse"]),
  };
}

function normalizeOrder(item, index = 0) {
  return {
    number: textFrom(item, ["order_number", "website_order_id", "orderId", "return_number", "id"]) || `Order ${index + 1}`,
    customer: textFrom(item, ["customer_name", "name", "customer"]) || textFrom(item.customer, ["name"]) || "Customer",
    phone: textFrom(item, ["phone", "mobile", "customer_phone"]) || textFrom(item.customer, ["phone", "mobile"]),
    status: textFrom(item, ["status", "order_status", "fulfillment_status"]) || "new",
    total: numberFrom(item, ["total", "amount", "grand_total", "order_total"]) || numberFrom(item.amounts, ["total"]),
    items: Array.isArray(item.items) ? item.items.length : numberFrom(item, ["items_count", "item_count"]),
    warehouse: textFrom(item, ["warehouse", "warehouse_code"]),
    createdAt: textFrom(item, ["created_at", "createdAt", "date"]),
  };
}

function normalizeCustomer(item, index = 0) {
  return {
    name: textFrom(item, ["name", "customer_name", "full_name"]) || `Customer ${index + 1}`,
    phone: textFrom(item, ["phone", "mobile", "customer_phone"]),
    email: textFrom(item, ["email", "customer_email"]),
    role: textFrom(item, ["role", "type"]) || "customer",
    orders: numberFrom(item, ["orders", "order_count", "total_orders"]),
    createdAt: textFrom(item, ["created_at", "createdAt", "date"]),
  };
}

function normalizeReturn(item, index = 0) {
  return {
    number: textFrom(item, ["return_number", "website_order_id", "id"]) || `Return ${index + 1}`,
    orderId: textFrom(item, ["website_order_id", "order_id", "orderId"]),
    customer: textFrom(item, ["customer_name", "name"]) || textFrom(item.customer, ["name"]) || "Customer",
    status: textFrom(item, ["status"]) || "approved",
    reason: textFrom(item, ["reason", "note", "details"]) || "Return",
    createdAt: textFrom(item, ["created_at", "createdAt", "date"]),
  };
}

function normalizeInventory(item, index = 0) {
  const product = item.product || item;
  const available = numberFrom(item, ["available_quantity", "available", "stock", "quantity", "qty"]) || numberFrom(product, ["available_quantity", "stockQuantity", "stock"]);
  return {
    name: textFrom(product, ["name", "title", "product_name"]) || `Inventory ${index + 1}`,
    sku: textFrom(product, ["sku", "barcode", "ean", "id"]),
    location: textFrom(item, ["location", "location_code", "full_code", "barcode", "bin"]) || textFrom(item.location, ["full_code", "barcode", "code"]),
    available,
    total: numberFrom(item, ["total", "quantity", "stock"]) || available,
    status: available > 0 ? "available" : "out_of_stock",
  };
}

function textFrom(item, keys) {
  if (typeof item === "string" || typeof item === "number") return String(item);
  if (!item || typeof item !== "object") return "";
  for (const key of keys) {
    const value = item[key];
    if (value !== null && value !== undefined && value !== "") return String(value);
  }
  return "";
}

function numberFrom(item, keys) {
  if (!item || typeof item !== "object") return 0;
  for (const key of keys) {
    const raw = item[key];
    if (raw === null || raw === undefined || raw === "") continue;
    const match = String(raw).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    if (match) return Number(match[0]);
  }
  return 0;
}

function valueFrom(item, keys, fallback = "") {
  const text = textFrom(item, keys);
  if (text) return text;
  const number = numberFrom(item, keys);
  return number || fallback;
}

function countStatus(rows, names) {
  const lookup = names.map((name) => String(name).toLowerCase());
  return rows.filter((row) => lookup.includes(String(row.status || "").toLowerCase())).length;
}

function metricCard([label, value, help]) {
  return `
    <article class="metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(help)}</span>
    </article>
  `;
}

function noteCard([title, body]) {
  return `<article><strong>${escapeHtml(title)}</strong><p>${escapeHtml(body)}</p></article>`;
}

function dataRow(cells) {
  return `<article class="table-row">${cells.map((cell) => `<span>${cell}</span>`).join("")}</article>`;
}

function strong(value) {
  return `<strong>${escapeHtml(value)}</strong>`;
}

function statusPill(value) {
  const raw = String(value || "unknown");
  const key = raw.toLowerCase().replace(/\s+/g, "_");
  return `<mark class="status-pill ${escapeHtml(key)}">${escapeHtml(raw)}</mark>`;
}

function emptyState(message, error = "") {
  return `<div class="empty"><strong>${escapeHtml(message)}</strong>${error ? `<p>${escapeHtml(error)}</p>` : ""}</div>`;
}

function labelFor(key) {
  return modules.find((module) => module.key === key)?.label || key;
}

function stateLabel(state) {
  return state === "ok" ? "Online" : state === "warn" ? "Check" : state === "fail" ? "Locked" : "Waiting";
}

function healthLabel() {
  const values = Object.values(store.health);
  if (!values.length) return "Waiting";
  if (Object.keys(store.errors).length) return "Partial";
  if (values.some((item) => item.state === "fail")) return "Needs login";
  if (values.some((item) => item.state === "warn")) return "Check";
  return "Online";
}

function lastUpdatedText() {
  return store.lastUpdated ? `Updated ${store.lastUpdated.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : "Waiting for first sync";
}

function formatNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString("en-IN") : "0";
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
