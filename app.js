const defaults = {
  websiteUrl: "https://www.evspeare.shop",
  backendApi: "https://evsphere-warehouse-backend-production.up.railway.app/api",
  productsEndpoint: "https://www.evspeare.shop/api/mobile/products",
  ordersEndpoint: "https://www.evspeare.shop/api/mobile/orders",
  pickerToken: "",
  warehouseId: "",
};

const store = {
  config: loadConfig(),
  products: [],
  orders: [],
  pickerOrders: [],
  returns: [],
  health: {},
};

const pages = {
  website: [
    ["Home", "Promo, search, categories, recommended products", ["Products", "Categories", "Offers"]],
    ["Category", "Category rail and product filters", ["Motors", "Lights", "Deals"]],
    ["Product", "Product detail, image, price, stock", ["SKU", "MRP", "Stock"]],
    ["Cart", "Cart items and checkout totals", ["Subtotal", "COD", "Online"]],
    ["Policies", "Privacy, terms, shipping, returns, payments", ["Static pages", "Support"]],
  ],
  customer: [
    ["Login/Profile", "OTP login, customer identity, saved data", ["Users", "OTP", "Wishlist"]],
    ["Orders", "Order history, status and tracking", ["Placed", "Cancel", "Return"]],
    ["Checkout", "Address, payment and order push", ["COD", "PayU", "Delivery"]],
    ["Support", "Customer query submission", ["Name", "Phone", "Message"]],
  ],
  picker: [
    ["Orders", "Pending and picking order queue", ["Pending", "Picking", "Packed"]],
    ["Ship", "Ready to ship and dispatch flow", ["Packed", "Dispatch"]],
    ["Return", "Return receive and item scan", ["Approved", "Inspection"]],
    ["Stock", "Stock-in product and bin update", ["SKU", "Bin", "Quantity"]],
    ["Move", "Move stock between locations", ["From bin", "To bin"]],
    ["Inventory", "View bin inventory", ["Location", "Available"]],
  ],
  warehouse: [
    ["Users", "Admin and manager accounts", ["Login required", "Roles"]],
    ["Products", "Catalog, SKU, image, price and stock", ["API", "Inventory"]],
    ["Orders", "Website and picker order workflow", ["Pick list", "Dispatch"]],
    ["Returns", "Approval, receive and physical verification", ["PV", "Refund"]],
    ["Locations", "Warehouse bins and movement", ["Barcode", "Quantity"]],
  ],
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

document.addEventListener("DOMContentLoaded", () => {
  bindNavigation();
  bindActions();
  hydrateSettings();
  renderPageMaps();
  renderAll();
  refreshAll();
});

function bindNavigation() {
  $$(".nav-stack button").forEach((button) => {
    button.addEventListener("click", () => {
      const page = button.dataset.page;
      $$(".nav-stack button").forEach((item) => item.classList.toggle("active", item === button));
      $$(".page").forEach((panel) => panel.classList.toggle("active", panel.dataset.pagePanel === page));
      $("#page-title").textContent = button.textContent;
    });
  });
}

function bindActions() {
  $("#refresh-all").addEventListener("click", refreshAll);
  $("#save-config").addEventListener("click", saveSettings);
  $("#login-api").addEventListener("click", loginAndSaveToken);
  $("#product-search").addEventListener("input", renderProducts);
  $$("[data-action='load-products']").forEach((button) => button.addEventListener("click", loadProducts));
  $$("[data-action='load-orders']").forEach((button) => button.addEventListener("click", loadOrders));
  $$("[data-action='load-picker']").forEach((button) => button.addEventListener("click", loadPickerData));
  $$("[data-action='test-health']").forEach((button) => button.addEventListener("click", testHealth));
}

async function refreshAll() {
  toast("Refreshing central panel...");
  await Promise.allSettled([testHealth(), loadProducts(), loadOrders(), loadPickerData()]);
  renderAll();
  toast("Central panel updated.");
}

async function testHealth() {
  const checks = [
    ["Backend API", `${store.config.backendApi}/health`],
    ["Products API", endpointUrl(store.config.productsEndpoint)],
    ["Website", store.config.websiteUrl],
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
  return results;
}

async function loadProducts() {
  try {
    const payload = await apiGet(store.config.productsEndpoint);
    store.products = asArray(payload).map(normalizeProduct);
  } catch (error) {
    store.products = [];
    logDiagnostic("Products", error.message);
  }
  renderProducts();
  renderMetrics();
}

async function loadOrders() {
  try {
    const payload = await apiGet(store.config.ordersEndpoint);
    store.orders = asArray(payload.orders || payload).map(normalizeOrder);
  } catch (error) {
    store.orders = [];
    logDiagnostic("Customer Orders", `${error.message}. Token/login may be required.`);
  }
  renderOrders();
  renderMetrics();
}

async function loadPickerData() {
  const headers = authHeaders();
  try {
    const orders = await apiGet("/pick-list", headers);
    store.pickerOrders = asArray(orders.orders || orders).map(normalizeOrder);
  } catch (error) {
    store.pickerOrders = [];
    logDiagnostic("Picker Orders", `${error.message}. Picker login token may be required.`);
  }

  try {
    const returns = await apiGet("/returns/pick-list", headers);
    store.returns = asArray(returns.returns || returns).map(normalizeReturn);
  } catch (error) {
    store.returns = [];
    logDiagnostic("Returns", `${error.message}. Picker login token may be required.`);
  }

  renderPicker();
  renderMetrics();
}

async function apiGet(path, headers = {}) {
  const response = await fetch(endpointUrl(path), {
    headers: { Accept: "application/json", ...headers },
    credentials: "include",
    cache: "no-store",
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok || data.ok === false) throw new Error(data.message || `API error ${response.status}`);
  return data;
}

function endpointUrl(path) {
  const value = String(path || "");
  if (/^https?:\/\//i.test(value)) return value;
  return `${store.config.backendApi}${value.startsWith("/") ? value : `/${value}`}`;
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
  renderProducts();
  renderOrders();
  renderPicker();
  renderNotes();
}

function renderHealth() {
  const entries = Object.entries(store.health);
  $("#source-count").textContent = `${entries.filter(([, item]) => item.state === "ok").length} connected`;
  $("#status-grid").innerHTML = entries.length
    ? entries.map(([name, item]) => `
      <article class="status-card ${item.state}">
        <span>${escapeHtml(name)}</span>
        <strong>${item.state === "ok" ? "Online" : item.state === "warn" ? "Check" : "Locked"}</strong>
        <span>${escapeHtml(item.detail)}</span>
      </article>
    `).join("")
    : `<article class="status-card warn"><span>Sources</span><strong>Waiting</strong><span>Run refresh to test live systems.</span></article>`;

  const log = $("#diagnostic-log");
  if (log) {
    log.innerHTML = entries.length
      ? entries.map(([name, item]) => `<article><strong>${escapeHtml(name)}</strong><p>${escapeHtml(item.detail)}</p></article>`).join("")
      : `<div class="empty">No diagnostics yet.</div>`;
  }
}

function renderMetrics() {
  const stock = store.products.reduce((sum, item) => sum + Number(item.stock || 0), 0);
  const orderTotal = store.orders.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const pending = store.pickerOrders.filter((item) => ["pending", "picking"].includes(String(item.status).toLowerCase())).length;
  const metrics = [
    ["Products", store.products.length, "Live catalog records"],
    ["Total stock", stock || "--", "Quantity visible from product feed"],
    ["Customer orders", store.orders.length, `Value Rs. ${formatNumber(orderTotal)}`],
    ["Picker queue", pending, "Pending or picking orders"],
    ["Returns", store.returns.length, "Approved and inspection flow"],
    ["API modules", "12+", "Products, orders, returns, stock, move"],
    ["Pages mapped", "20+", "Website, app, picker, backend"],
    ["Status", healthLabel(), "Live source condition"],
  ];

  $("#metric-grid").innerHTML = metrics.map(([label, value, help]) => `
    <article class="metric-card">
      <span>${label}</span>
      <strong>${value}</strong>
      <span>${help}</span>
    </article>
  `).join("");

  $("#hero-products").textContent = store.products.length || "--";
  $("#hero-orders").textContent = store.orders.length || "--";
  $("#hero-picker").textContent = pending || "--";
}

function renderProducts() {
  const query = ($("#product-search")?.value || "").toLowerCase();
  const rows = store.products.filter((item) => [item.name, item.sku, item.category].join(" ").toLowerCase().includes(query));
  $("#products-table").innerHTML = rows.length
    ? rows.slice(0, 80).map((item) => `
      <article class="table-row">
        <strong>${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(item.sku || "-")}</span>
        <span>Rs. ${formatNumber(item.price)}</span>
        <span>${escapeHtml(item.category || "Catalog")} / Stock ${formatNumber(item.stock)}</span>
      </article>
    `).join("")
    : `<div class="empty">Products load nahi huye. Backend login/CORS/token required ho sakta hai.</div>`;
}

function renderOrders() {
  $("#orders-table").innerHTML = store.orders.length
    ? store.orders.slice(0, 80).map(orderRow).join("")
    : `<div class="empty">Customer orders protected ho sakte hain. Integrations page me token/config add karke reload karein.</div>`;
}

function renderPicker() {
  $("#picker-orders-table").innerHTML = store.pickerOrders.length
    ? store.pickerOrders.slice(0, 80).map(orderRow).join("")
    : `<div class="empty">Picker orders ke liye picker/admin bearer token required ho sakta hai.</div>`;
  $("#returns-table").innerHTML = store.returns.length
    ? store.returns.slice(0, 80).map((item) => `
      <article class="table-row">
        <strong>${escapeHtml(item.number)}</strong>
        <span>${escapeHtml(item.customer)}</span>
        <span>${escapeHtml(item.status)}</span>
        <span>${escapeHtml(item.reason)}</span>
      </article>
    `).join("")
    : `<div class="empty">Approved returns abhi load nahi huye.</div>`;
}

function orderRow(item) {
  return `
    <article class="table-row">
      <strong>${escapeHtml(item.number)}</strong>
      <span>${escapeHtml(item.customer)}</span>
      <span>${escapeHtml(item.status)}</span>
      <span>Rs. ${formatNumber(item.total)}</span>
    </article>
  `;
}

function renderNotes() {
  const notes = [
    ["Protected data", "Warehouse `/users`, picker pick-list, returns aur order feeds login/token ke peeche ho sakte hain."],
    ["Best setup", "Backend API bearer token aur warehouse ID Integrations page mein save karne ke baad full live data dikhega."],
    ["Already mapped", "Customer app pages, picker screens aur warehouse modules panel mein separate cards ke roop mein ready hain."],
  ];
  $("#note-list").innerHTML = notes.map(([title, body]) => `<article><strong>${title}</strong><p>${body}</p></article>`).join("");
}

function renderPageMaps() {
  for (const [key, rows] of Object.entries(pages)) {
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
    if (!token) {
      showLoginResult("Login done", "Login successful hai, lekin API ne bearer token return nahi kiya. Cookie session set ho sakta hai.");
    } else {
      store.config.pickerToken = token;
      localStorage.setItem("evspeareCentralConfig", JSON.stringify(store.config));
      hydrateSettings();
      showLoginResult("Token saved", "Bearer token safely browser local storage mein save ho gaya.");
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
  for (const key of ["products", "items", "orders", "returns", "data", "results", "records"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function normalizeProduct(item, index = 0) {
  return {
    name: item.name || item.title || `Product ${index + 1}`,
    sku: item.sku || item.product_sku || item.barcode || item.id || "",
    price: Number(item.price || item.sale_price || item.selling_price || item.amount || 0),
    stock: Number(item.stockQuantity || item.stock_quantity || item.available_quantity || item.quantity || item.stock || 0),
    category: item.category || item.category_name || item.type || "Catalog",
  };
}

function normalizeOrder(item, index = 0) {
  return {
    number: item.order_number || item.website_order_id || item.orderId || item.id || `Order ${index + 1}`,
    customer: item.customer_name || item.name || item.customer?.name || item.phone || "Customer",
    status: item.status || item.order_status || "new",
    total: Number(item.total || item.amount || item.grand_total || item.amounts?.total || 0),
  };
}

function normalizeReturn(item, index = 0) {
  return {
    number: item.return_number || item.website_order_id || item.id || `Return ${index + 1}`,
    customer: item.customer_name || item.customer?.name || "Customer",
    status: item.status || "approved",
    reason: item.reason || item.note || "Return",
  };
}

function logDiagnostic(title, body) {
  const existing = store.health[title] || {};
  store.health[title] = { state: existing.state || "warn", detail: body };
  renderHealth();
}

function healthLabel() {
  const values = Object.values(store.health);
  if (!values.length) return "Waiting";
  if (values.some((item) => item.state === "fail")) return "Needs login";
  if (values.some((item) => item.state === "warn")) return "Partial";
  return "Online";
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
