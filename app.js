const defaults = {
  websiteUrl: "https://www.evspeare.shop",
  pickerUrl: "https://evsphere-warehouse-mobile-production.up.railway.app",
  backendApi: "https://evsphere-warehouse-backend-production.up.railway.app/api",
  productsEndpoint: "https://www.evspeare.shop/api/mobile/products",
  ordersEndpoint: "https://www.evspeare.shop/api/mobile/orders",
  customersEndpoint: "/customers",
  pickerOrdersEndpoint: "/pick-list",
  returnsEndpoint: "/returns/pick-list",
  inventoryEndpoint: "/inventory",
  updateEndpoint: "/central-panel/update",
  warehouseId: "",
  autoRefreshSeconds: "30",
};

const store = {
  config: loadConfig(),
  adminToken: localStorage.getItem("evspeareAdminSession") || "",
  products: [],
  orders: [],
  customers: [],
  pickerOrders: [],
  returns: [],
  inventory: [],
  createdUsers: [],
  warehouses: [],
  activeTab: "all",
  editing: null,
  errors: {},
  lastSync: null,
  timer: null,
};

const statuses = ["all", "pending", "shipped", "delivered", "cancel", "return"];
const accessPermissions = [
  ["dashboard", "Dashboard"], ["products", "Products"], ["suppliers", "Suppliers"], ["stock_in", "Stock In"],
  ["stock_out", "Stock Out"], ["inventory", "Inventory"], ["locations", "Locations"], ["orders", "Orders"],
  ["picker_ops", "Picker Ops"], ["pick_transfer", "Pick Transfer"], ["shiprocket", "Shiprocket"],
  ["shipping_status", "Shipping Status"], ["returns", "Returns"], ["refunds", "Payment Refunds"],
  ["money_tracking", "Money Tracking"], ["invoices", "Invoices"], ["reports", "Reports"], ["users", "Users"],
  ["ops_config", "Ops Config"], ["settings", "Settings"],
];
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

document.addEventListener("DOMContentLoaded", () => {
  setDefaultDates();
  bindLogin();
  bindNavigation();
  bindActions();
  hydrateEditors();
  renderAll();
  initializeSession();
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
  $("#warehouse-filter").addEventListener("change", renderAll);
  $("#tracking-form").addEventListener("submit", trackOrder);
  $("#create-user").addEventListener("click", createAccessUser);
  $("#refresh-created-users").addEventListener("click", loadCreatedUsers);
  $("#close-drawer").addEventListener("click", closeDrawer);
  $("#save-record").addEventListener("click", saveRecord);
  $("#delete-record").addEventListener("click", deleteAccessUser);
  $$("[data-action='load-products']").forEach((button) => button.addEventListener("click", loadProducts));
  $$("[data-action='load-orders']").forEach((button) => button.addEventListener("click", loadOrders));
  $$("[data-action='load-customers']").forEach((button) => button.addEventListener("click", loadCustomers));
  $$("[data-action='load-picker']").forEach((button) => button.addEventListener("click", loadPicker));
  $$("[data-action='load-returns']").forEach((button) => button.addEventListener("click", loadReturns));
  $$("[data-action='load-inventory']").forEach((button) => button.addEventListener("click", loadInventory));
  $$("[data-save-editor]").forEach((button) => button.addEventListener("click", () => saveEditor(button.dataset.saveEditor)));
  $$("[data-export]").forEach((button) => button.addEventListener("click", () => exportCsv(button.dataset.export)));
}

function bindLogin() {
  $("#admin-login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.message || "Login failed");
      store.adminToken = data.token;
      localStorage.setItem("evspeareAdminSession", data.token);
      $("#login-gate").classList.remove("active");
      await initializeSession();
    } catch (error) {
      toast(error.message);
    }
  });
}

async function initializeSession() {
  if (!store.adminToken) {
    $("#login-gate").classList.add("active");
    return;
  }
  try {
    const response = await fetch("/api/admin/config", { headers: adminHeaders(), cache: "no-store" });
    const data = await response.json();
    if (!response.ok || data.ok === false) throw new Error(data.message || "Config failed");
    store.config = { ...store.config, ...data.config };
    $("#login-gate").classList.remove("active");
    await refreshAll();
    startAutoRefresh();
  } catch (error) {
    localStorage.removeItem("evspeareAdminSession");
    store.adminToken = "";
    $("#login-gate").classList.add("active");
    toast(error.message);
  }
}

function openPage(page, title) {
  $$(".nav-stack button").forEach((item) => item.classList.toggle("active", item.dataset.page === page));
  $$(".page").forEach((panel) => panel.classList.toggle("active", panel.dataset.pagePanel === page));
  $("#page-title").textContent = title;
}

async function refreshAll() {
  setSyncState("Syncing");
  await Promise.allSettled([loadProducts(), loadOrders(), loadCustomers(), loadPicker(), loadReturns()]);
  await loadInventory();
  await loadWarehouses();
  await loadCreatedUsers();
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

async function loadInventory() {
  await loadRows("inventory", store.config.inventoryEndpoint, normalizeInventory, ["/inventory", "/products", "/stock"]);
  if (!store.inventory.length && store.products.length) {
    store.inventory = store.products.map((item) => ({
      id: item.id,
      name: item.name,
      sku: item.sku,
      warehouseId: item.warehouseId || "default",
      stock: item.stock,
      value: Number(item.price || 0) * Number(item.stock || 0),
      location: item.location || "-",
    }));
  }
  renderAll();
}

async function loadCreatedUsers() {
  try {
    const payload = await adminGet("/api/admin/users");
    store.createdUsers = asArray(payload).map(normalizeAccessUser);
    delete store.errors.createdUsers;
  } catch (error) {
    store.createdUsers = loadLocalUsers();
    store.errors.createdUsers = `${error.message}. Backend user-create endpoint ready nahi hai, local draft dikh raha hai.`;
  }
  renderCreatedUsers();
}

async function loadWarehouses() {
  try {
    const payload = await adminGet("/api/admin/warehouses");
    store.warehouses = asArray(payload).map(normalizeWarehouse);
    delete store.errors.warehouses;
  } catch (error) {
    store.warehouses = [];
    store.errors.warehouses = error.message;
  }
  populateWarehouseFilter();
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
  const response = await fetch(proxyUrl(path), {
    headers: adminHeaders(),
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
  const response = await fetch(proxyUrl(path), {
    method: "POST",
    headers: { ...adminHeaders(), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.message || data.error || `API ${response.status}`);
  return data;
}

async function adminGet(path) {
  const response = await fetch(path, { headers: adminHeaders(), cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.message || `API ${response.status}`);
  return data;
}

async function adminPost(path, body) {
  return adminRequest(path, "POST", body);
}

async function adminRequest(path, method, body) {
  const response = await fetch(path, {
    method,
    headers: { ...adminHeaders(), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.message || `API ${response.status}`);
  return data;
}

function proxyUrl(path) {
  return `/api/admin/proxy?path=${encodeURIComponent(path || "/")}`;
}

function adminHeaders() {
  return { Accept: "application/json", Authorization: `Bearer ${store.adminToken}` };
}

function renderAll() {
  renderMetrics();
  renderTabs();
  renderOrders();
  renderCustomers();
  renderPickers();
  renderReturns();
  renderProducts();
  renderInventory();
  renderCreatedUsers();
  renderShiprocket();
  renderDashboardLists();
  renderOperations();
  renderOpsConfig();
  renderEditLog();
}

function renderMetrics() {
  const filteredOrders = filtered(store.orders, "orders");
  const visibleInventory = filtered(store.inventory, "inventory");
  const inventoryQty = visibleInventory.reduce((sum, item) => sum + Number(item.stock || 0), 0);
  const inventoryValue = visibleInventory.reduce((sum, item) => sum + Number(item.value || 0), 0);
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
    ["Total inventory", inventoryQty || "--", "Warehouse-wise stock", "green"],
    ["Inventory value", `Rs. ${formatNumber(inventoryValue)}`, "Stock value", "green"],
    ["Out of stock", visibleInventory.filter((item) => item.stock <= 0).length, "Needs refill", "rose"],
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
    [item.orderId || item.number, `Order ID / ${item.date || "No date"} ${item.time || ""}`],
    [item.customerId || item.customer, `Customer / ${item.phone || "No phone"}`],
    [item.warehouseId || "-", `Warehouse ID / Picker ${item.pickerId || "-"}`],
    [item.pincode || "-", `Pincode / AWB ${item.awb || "-"}`],
    [statusPill(item.status), `Rs. ${formatNumber(item.total)}`],
    [item.location || item.address || "-", "Location"],
  ])).join("") : emptyState("Order rows live endpoint/token ke baad dikhenge.", store.errors.orders);
  $("#active-orders-table").innerHTML = activeOrders().slice(0, 8).map((item) => rowHtml("orders", item, [
    [item.orderId || item.number, `${item.date || "No date"} ${item.time || ""}`],
    [item.customer, item.phone || "No phone"],
    [item.warehouseId || "-", `Picker ${item.pickerId || "-"}`],
    [statusPill(item.status), `AWB ${item.awb || "-"}`],
    [item.location || item.pincode || "-", "Location/Pincode"],
  ])).join("") || emptyState("No active orders in current filter.");
  populateWarehouseFilter();
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
    [item.orderId || item.number, item.createdAt || "No date"],
    [item.pickerId || item.picker || item.customer, item.phone || "Picker/order"],
    [statusPill(item.status), "Status"],
    [item.warehouseId || item.warehouse || "-", "Warehouse"],
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
    [imageCell(item), item.sku || "No SKU"],
    [`Rs. ${formatNumber(item.price)}`, item.category || "Catalog"],
    [statusPill(item.stock > 0 ? "active" : "out_of_stock"), "Stock status"],
    [`Stock ${formatNumber(item.stock)}`, "Quantity"],
    [item.warehouseId || item.source || "Website", "Warehouse/Source"],
  ])).join("") : emptyState("Products public website se load hone chahiye.", store.errors.products);
  populateWarehouseFilter();
}

function renderInventory() {
  const rows = filtered(store.inventory, "inventory");
  $("#inventory-table").innerHTML = rows.length ? rows.slice(0, 300).map((item) => rowHtml("products", item, [
    [imageCell(item), item.sku || "No SKU"],
    [item.warehouseId || "-", "Warehouse ID"],
    [item.location || "-", "Location"],
    [`Stock ${formatNumber(item.stock)}`, "Total inventory"],
    [`Rs. ${formatNumber(item.value)}`, "Inventory value"],
  ])).join("") : emptyState("Inventory backend endpoint connect hone ke baad warehouse-wise stock dikhega.", store.errors.inventory);
  populateWarehouseFilter();
}

function renderShiprocket() {
  const rows = shiprocketRows();
  const inTransit = rows.filter((item) => tabMatches(item.status, "shipped")).length;
  const delivered = rows.filter((item) => tabMatches(item.status, "delivered")).length;
  const missingAwb = rows.filter((item) => !item.awb).length;
  const summary = $("#shiprocket-summary");
  if (summary) {
    summary.innerHTML = [
      ["Courier rows", rows.length, "Shiprocket linked orders"],
      ["In transit", inTransit, "Shipped/dispatch status"],
      ["Delivered", delivered, "Completed courier rows"],
      ["Missing AWB", missingAwb, "Needs courier creation"],
    ].map(([label, value, help]) => `<article class="metric-card blue"><span>${label}</span><strong>${value}</strong><span>${help}</span></article>`).join("");
  }
  const table = $("#shiprocket-table");
  if (!table) return;
  table.innerHTML = rows.length ? rows.slice(0, 300).map((item) => rowHtml("orders", item, [
    [item.orderId || item.number, item.createdAt || "No date"],
    [item.awb || "-", "AWB"],
    [item.courierProvider || "Shiprocket", `Shipment ${item.courierShipmentId || "-"}`],
    [statusPill(item.courierStatus || item.status), "Courier status"],
    [item.customer, item.phone || "Customer"],
  ])).join("") : emptyState("Shiprocket rows orders/courier endpoint connect hone ke baad dikhenge.");
}

function renderCreatedUsers() {
  const node = $("#created-users-table");
  if (!node) return;
  node.innerHTML = store.createdUsers.length ? store.createdUsers.map((item) => `
    <button class="access-user-row" type="button" data-edit-type="accessUsers" data-edit-id="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.userId)}">
      <span>
        <strong>${escapeHtml(item.name || item.userId)}</strong>
        <small>${escapeHtml(item.userId)}</small>
      </span>
      ${statusPill(item.role)}
      <span class="warehouse-chip">
        <strong>${escapeHtml(item.warehouseCode || item.warehouseId || "-")}</strong>
        <small>${escapeHtml(item.status || "active")}</small>
      </span>
      <span class="access-row-arrow" aria-hidden="true">&rsaquo;</span>
    </button>
  `).join("") : emptyState("Abhi koi admin/picker user create nahi hua.");
}

function renderDashboardLists() {
  $("#active-customers").innerHTML = filtered(store.customers, "customers").slice(0, 8).map((item) => miniCard(item.name, item.phone || item.email || "Active", `${item.orders || 0} orders`)).join("") || emptyState("No active customers yet.");
  $("#active-pickers").innerHTML = activePickers().slice(0, 8).map((item) => miniCard(item.picker || item.customer || item.number, item.warehouse || item.status, item.number)).join("") || emptyState("No active pickers yet.");
  renderDateWise();
}

function renderOperations() {
  const lowStock = filtered(store.inventory, "inventory").filter((item) => Number(item.stock || 0) <= 1);
  const pendingOrders = filtered(store.orders, "orders").filter((item) => tabMatches(item.status, "pending"));
  const returns = filtered(store.returns, "returns");
  const alerts = [
    lowStock.length ? ["Low stock", `${lowStock.length} SKU at 1 qty or less`, "Inventory"] : null,
    pendingOrders.length ? ["Pending orders", `${pendingOrders.length} orders need picking`, "Orders"] : null,
    returns.length ? ["Returns", `${returns.length} return rows need action`, "Returns"] : null,
    Object.keys(store.errors).length ? ["Connection", `${Object.keys(store.errors).length} modules partial`, "Check"] : null,
  ].filter(Boolean);
  $("#ops-alerts").innerHTML = alerts.length ? alerts.map(([title, body, side]) => miniCard(title, body, side)).join("") : miniCard("All clear", "No operational exceptions in current filter", "OK");

  const pipeline = [
    ["Pending", countStatus(store.orders, ["pending", "new", "placed", "processing"])],
    ["Shipped", countStatus(store.orders, ["shipped", "packed", "dispatch", "dispatched"])],
    ["Delivered", countStatus(store.orders, ["delivered", "complete", "completed"])],
    ["Cancel", countStatus(store.orders, ["cancel", "cancelled", "canceled"])],
    ["Return", store.returns.length],
  ];
  const max = Math.max(...pipeline.map((item) => item[1]), 1);
  $("#pipeline-health").innerHTML = pipeline.map(([label, count]) => `
    <article class="pipeline-step">
      <div><strong>${escapeHtml(label)}</strong><span>${count} rows</span></div>
      <div class="bar"><i style="width:${Math.max(4, (count / max) * 100)}%"></i></div>
    </article>
  `).join("");

  const health = [
    ["Products", store.products.length ? "Online" : "Waiting", `${store.products.length} rows`],
    ["Orders", store.orders.length ? "Online" : "Protected", `${store.orders.length} rows`],
    ["Pickers", store.pickerOrders.length ? "Online" : "Protected", `${store.pickerOrders.length} rows`],
    ["Users", store.createdUsers.length ? "Online" : "Ready", `${store.createdUsers.length} users`],
    ["Inventory", store.inventory.length ? "Online" : "Catalog fallback", `${store.inventory.length} rows`],
  ];
  const node = $("#system-health");
  if (node) node.innerHTML = health.map(([title, body, side]) => miniCard(title, body, side)).join("");
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

function populateWarehouseFilter() {
  const select = $("#warehouse-filter");
  const current = select.value;
  const warehouses = [...new Set([
    store.config.warehouseId,
    ...store.warehouses.map((item) => item.id),
    ...store.warehouses.map((item) => item.code),
    ...store.orders.map((item) => item.warehouseId || item.warehouse),
    ...store.pickerOrders.map((item) => item.warehouseId || item.warehouse),
    ...store.inventory.map((item) => item.warehouseId || item.warehouse),
    ...store.products.map((item) => item.warehouseId || item.warehouse),
    ...store.createdUsers.map((item) => item.warehouseId || item.warehouse),
    ...store.createdUsers.flatMap((item) => (item.warehouses || []).map((warehouse) => warehouse.id || warehouse.code)),
  ].filter(Boolean).map(String))].sort();
  select.innerHTML = `<option value="">All warehouses</option>${warehouses.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`).join("")}`;
  if (warehouses.includes(current)) select.value = current;

  const userWarehouseSelect = $("#user-warehouse-select");
  if (userWarehouseSelect) {
    const selected = userWarehouseSelect.value;
    const options = store.warehouses.length
      ? store.warehouses.map((warehouse) => `<option value="${escapeHtml(warehouse.id)}">${escapeHtml(warehouse.id)}</option>`).join("")
      : warehouses.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`).join("");
    userWarehouseSelect.innerHTML = `<option value="">Select warehouse ID</option>${options}`;
    if (Array.from(userWarehouseSelect.options).some((option) => option.value === selected)) userWarehouseSelect.value = selected;
  }
}

function trackOrder(event) {
  event.preventDefault();
  const query = new FormData(event.currentTarget).get("query").trim().toLowerCase();
  if (!query) {
    $("#tracking-result").innerHTML = emptyState("Order ID, AWB, customer ID ya phone enter karein.");
    return;
  }
  const matches = [...store.orders, ...store.pickerOrders, ...store.returns].filter((item) => JSON.stringify(item).toLowerCase().includes(query));
  $("#tracking-result").innerHTML = matches.length ? matches.slice(0, 20).map((item) => `
    <article class="tracking-card">
      <div>
        <span>Order</span>
        <strong>${escapeHtml(item.orderId || item.number)}</strong>
      </div>
      <div>
        <span>Status</span>
        ${statusPill(item.status)}
      </div>
      <div>
        <span>Customer</span>
        <strong>${escapeHtml(item.customer || "-")}</strong>
      </div>
      <div>
        <span>AWB</span>
        <strong>${escapeHtml(item.awb || "-")}</strong>
      </div>
      <div>
        <span>Warehouse</span>
        <strong>${escapeHtml(item.warehouseId || item.warehouse || "-")}</strong>
      </div>
      <div>
        <span>Location</span>
        <strong>${escapeHtml(item.location || item.address || "-")}</strong>
      </div>
    </article>
  `).join("") : emptyState("Is query par koi order nahi mila.");
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
  if (raw.startsWith('<mark class="status-pill') || raw.startsWith('<div class="product-cell')) return raw;
  return escapeHtml(raw);
}

function imageCell(item) {
  const src = item.image || "";
  const image = src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(item.name || item.sku || "Product")}" loading="lazy" />` : `<span>${escapeHtml((item.name || item.sku || "P").slice(0, 1))}</span>`;
  return `<div class="product-cell"><div class="product-thumb">${image}</div><strong>${escapeHtml(item.name || "Product")}</strong></div>`;
}

function shiprocketRows() {
  return filtered(store.orders, "orders").filter((item) =>
    item.courierProvider || item.courierOrderId || item.courierShipmentId || item.awb || ["packed", "dispatch", "dispatched", "shipped", "delivered"].includes(String(item.status || "").toLowerCase())
  );
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
  $("#drawer-kicker").textContent = type === "accessUsers" ? "User access" : type;
  $("#drawer-title").textContent = item.userId || item.number || item.name || item.sku || "Record";
  $("#record-form").innerHTML = type === "accessUsers" ? accessUserEditorHtml(item) : editableFields(type, item).map(([name, label, value]) => `
    <label>${escapeHtml(label)}<input name="${escapeHtml(name)}" value="${escapeHtml(value)}" /></label>
  `).join("");
  $("#delete-record").hidden = type !== "accessUsers";
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
  if (store.editing.type === "accessUsers") {
    await saveAccessUser();
    return;
  }
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

async function saveAccessUser() {
  const formData = new FormData($("#record-form"));
  const updates = Object.fromEntries(formData.entries());
  updates.permissions = formData.getAll("permissions");
  updates.id = store.editing.id;
  if (!updates.userId || !updates.warehouseId) {
    toast("User ID aur warehouse ID required hai.");
    return;
  }
  if (!updates.password) delete updates.password;
  try {
    const response = await adminRequest("/api/admin/users", "PATCH", updates);
    const savedUser = normalizeAccessUser(response.user || updates);
    store.createdUsers = store.createdUsers.map((item) => String(item.id) === String(store.editing.id) ? savedUser : item);
    toast(`${savedUser.userId} update ho gaya.`);
    closeDrawer();
    await loadCreatedUsers();
  } catch (error) {
    toast(`User update nahi hua: ${error.message}`);
  }
}

async function deleteAccessUser() {
  if (!store.editing || store.editing.type !== "accessUsers") return;
  const user = store.editing.item;
  if (!window.confirm(`${user.userId} ko delete karna hai?`)) return;
  try {
    await adminRequest("/api/admin/users", "DELETE", { id: user.id, userId: user.userId });
    store.createdUsers = store.createdUsers.filter((item) => String(item.id) !== String(user.id));
    toast(`${user.userId} delete ho gaya.`);
    closeDrawer();
    renderAll();
  } catch (error) {
    toast(`User delete nahi hua: ${error.message}`);
  }
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

async function createAccessUser() {
  const form = $("#user-create-form");
  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());
  data.permissions = formData.getAll("permissions");
  if (!data.userId || !data.password || !data.warehouseId) {
    toast("User ID, password aur warehouse ID required hai.");
    return;
  }
  if (data.password !== data.confirmPassword) {
    toast("Password aur confirm password match nahi kar raha.");
    return;
  }
  delete data.confirmPassword;
  const user = normalizeAccessUser({ ...data, id: data.userId, createdAt: new Date().toISOString() });
  try {
    const response = await adminPost("/api/admin/users", data);
    const savedUser = normalizeAccessUser(response.user || user);
    store.createdUsers = [savedUser, ...store.createdUsers.filter((item) => item.userId !== savedUser.userId)];
    toast(`User save ho gaya. ${savedUser.userId} ab warehouse login kar sakta hai.`);
  } catch (error) {
    toast(`User save nahi hua: ${error.message}. Login tabhi chalega jab backend save successful ho.`);
    return;
  }
  form.reset();
  populateWarehouseFilter();
  await loadCreatedUsers();
}

function editableFields(type, item) {
  const common = {
    orders: [["status", "Status", item.status], ["orderId", "Order ID", item.orderId], ["customerId", "Customer ID", item.customerId], ["warehouseId", "Warehouse ID", item.warehouseId], ["pickerId", "Picker ID", item.pickerId], ["awb", "AWB", item.awb], ["pincode", "Pincode", item.pincode], ["location", "Location", item.location], ["customer", "Customer", item.customer], ["phone", "Phone", item.phone], ["address", "Address", item.address], ["total", "Total", item.total]],
    customers: [["name", "Name", item.name], ["phone", "Phone", item.phone], ["email", "Email", item.email], ["status", "Status", item.status]],
    pickers: [["status", "Status", item.status], ["picker", "Picker", item.picker], ["warehouse", "Warehouse", item.warehouse]],
    returns: [["status", "Status", item.status], ["reason", "Reason", item.reason], ["customer", "Customer", item.customer]],
    products: [["name", "Product name", item.name], ["sku", "SKU", item.sku], ["price", "Price", item.price], ["stock", "Stock", item.stock], ["warehouseId", "Warehouse ID", item.warehouseId], ["category", "Category", item.category]],
  };
  return common[type] || Object.entries(item).slice(0, 8).map(([key, value]) => [key, key, value]);
}

function accessUserEditorHtml(item) {
  const selectedWarehouse = String(item.warehouseId || "");
  const warehouseOptions = store.warehouses.length
    ? store.warehouses.map((warehouse) => [String(warehouse.id), warehouse.label || warehouse.code || warehouse.id])
    : [[selectedWarehouse, item.warehouseCode || selectedWarehouse || "Assigned warehouse"]];
  if (selectedWarehouse && !warehouseOptions.some(([id]) => id === selectedWarehouse)) {
    warehouseOptions.unshift([selectedWarehouse, item.warehouseCode || selectedWarehouse]);
  }
  const optionHtml = warehouseOptions
    .filter(([id]) => id)
    .map(([id, label]) => `<option value="${escapeHtml(id)}" ${id === selectedWarehouse ? "selected" : ""}>${escapeHtml(label)}</option>`)
    .join("");
  const checked = new Set(item.permissions || []);
  return `
    <div class="option-row">
      <label>User type
        <select name="role">
          ${["admin", "manager", "picker"].map((role) => `<option value="${role}" ${item.role === role ? "selected" : ""}>${escapeHtml(role)}</option>`).join("")}
        </select>
      </label>
      <label>Status
        <select name="status">
          ${["active", "blocked"].map((status) => `<option value="${status}" ${item.status === status ? "selected" : ""}>${escapeHtml(status)}</option>`).join("")}
        </select>
      </label>
      <label>User ID / Email<input name="userId" type="text" value="${escapeHtml(item.userId)}" required /></label>
      <label>New password<input name="password" type="password" autocomplete="new-password" placeholder="Leave blank to keep current" /></label>
      <label>Full name<input name="name" value="${escapeHtml(item.name || "")}" /></label>
      <label>Phone<input name="phone" inputmode="tel" value="${escapeHtml(item.phone || "")}" /></label>
      <label>Warehouse
        <select name="warehouseId" required>${optionHtml}</select>
      </label>
    </div>
    <details open>
      <summary>Permissions</summary>
      <div class="permission-grid">
        ${accessPermissions.map(([value, label]) => `<label><input name="permissions" type="checkbox" value="${value}" ${checked.has(value) ? "checked" : ""} /> ${label}</label>`).join("")}
      </div>
    </details>
  `;
}

function collectionFor(type) {
  return {
    orders: store.orders,
    customers: store.customers,
    pickers: store.pickerOrders,
    returns: store.returns,
    products: store.products,
    accessUsers: store.createdUsers,
  }[type] || [];
}

function hydrateEditors() {
  $$("[data-editor]").forEach((form) => {
    const saved = loadLocalDraft(`editor:${form.dataset.editor}`);
    Object.entries(saved).forEach(([key, value]) => {
      if (form.elements[key]) form.elements[key].value = value;
    });
  });
}

function filtered(rows, type) {
  const query = $("#global-search").value.trim().toLowerCase();
  const from = $("#date-from").value;
  const to = $("#date-to").value;
  const warehouse = $("#warehouse-filter").value;
  return rows.filter((row) => {
    const blob = JSON.stringify(row).toLowerCase();
    const date = dateKey(row.createdAt);
    const queryOk = !query || blob.includes(query);
    const fromOk = !from || !date || date >= from;
    const toOk = !to || !date || date <= to;
    const warehouseOk = !warehouse || String(row.warehouseId || row.warehouse || "").toLowerCase() === warehouse.toLowerCase();
    return queryOk && fromOk && toOk && warehouseOk;
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

function renderOpsConfig() {
  const config = loadLocalDraft("editor:ops-config");
  const fallback = {
    shiftRequired: "Enabled",
    pickMethod: "Bin first",
    routeOptimization: "Bin sequence",
    toteAssignment: "Required",
    bagSealCheck: "Required",
    awbMandatory: "Enabled",
    cycleCount: "Daily",
    incidentReporting: "Enabled",
  };
  const merged = { ...fallback, ...config };
  const preview = [
    ["Shift gate", merged.shiftRequired, "Picker login ke baad shift control"],
    ["Pick flow", merged.pickMethod, "Scanner workflow"],
    ["Route", merged.routeOptimization, "Queue sorting"],
    ["Tote", merged.toteAssignment, "Crate assignment"],
    ["Dispatch", `Seal ${merged.bagSealCheck}`, "Rider handoff checklist"],
    ["Shiprocket", merged.shiprocketSync || "Enabled", "AWB/courier sync"],
    ["Express app", merged.expressDelivery || "Enabled", `${merged.expressRadiusKm || 25} KM radius`],
    ["Buy again", merged.buyAgain || "Enabled", "Customer repeat ordering"],
    ["COD cap", `Rs. ${formatNumber(merged.codMaxAmount || 1000)}`, "Payment rule"],
    ["Order push", merged.appOrderPush || "Website + warehouse", "Customer app fulfilment"],
    ["Cycle count", merged.cycleCount, "Warehouse audit"],
    ["Incidents", merged.incidentReporting, "Floor issue reporting"],
  ];
  const readiness = [
    ["Picker app", store.pickerOrders.length ? "Live" : "Needs endpoint", `${store.pickerOrders.length} picker rows`],
    ["Warehouse filter", $("#warehouse-filter").options.length > 1 ? "Ready" : "Needs warehouse data", "Warehouse-wise view"],
    ["Inventory", store.inventory.length ? "Connected" : "Needs endpoint", `${store.inventory.length} rows`],
    ["Returns", store.returns.length ? "Connected" : "Needs endpoint", `${store.returns.length} rows`],
    ["Shiprocket", shiprocketRows().length ? "Connected" : "Needs courier data", `${shiprocketRows().length} rows`],
    ["Users", store.createdUsers.length ? "Ready" : "Create users", `${store.createdUsers.length} access users`],
  ];
  const previewNode = $("#ops-config-preview");
  if (previewNode) previewNode.innerHTML = preview.map((item) => miniCard(item[0], item[1], item[2])).join("");
  const readinessNode = $("#warehouse-readiness");
  if (readinessNode) readinessNode.innerHTML = readiness.map((item) => miniCard(item[0], item[1], item[2])).join("");
}

function exportCsv(key) {
  const rows = {
    orders: store.orders,
    customers: store.customers,
    pickerOrders: store.pickerOrders,
    returns: store.returns,
    products: store.products,
    inventory: store.inventory,
    shiprocket: shiprocketRows(),
  }[key] || [];
  if (!rows.length) {
    toast("Export ke liye rows available nahi hain.");
    return;
  }
  const columns = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((item) => set.add(item));
    return set;
  }, new Set()));
  const csv = [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `evspeare-${key}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  toast("CSV export ready.");
}

function csvCell(value) {
  const raw = Array.isArray(value) ? value.join("|") : String(value ?? "");
  return `"${raw.replaceAll('"', '""')}"`;
}

function normalizeProduct(item, index = 0) {
  return {
    id: String(item.id || item.sourceId || item.sku || index),
    name: text(item, ["name", "title", "product_name"]) || `Product ${index + 1}`,
    sku: text(item, ["sku", "ean", "barcode", "product_sku"]),
    price: number(item, ["price", "sale_price", "selling_price", "mrp", "amount"]),
    stock: number(item, ["stockQuantity", "stock_quantity", "available_quantity", "quantity", "stock"]),
    warehouseId: text(item, ["warehouseId", "warehouse_id", "warehouse", "warehouse_code"]),
    location: text(item, ["location", "bin", "location_code"]),
    image: firstImage(item),
    category: text(item, ["category", "category_name"]) || "Catalog",
    source: text(item, ["source"]) || "Website",
  };
}

function normalizeOrder(item, index = 0) {
  return {
    id: String(item.id || item.orderId || item.order_number || item.website_order_id || index),
    orderId: text(item, ["order_id", "orderId", "order_number", "website_order_id", "id"]) || `Order ${index + 1}`,
    number: text(item, ["order_number", "website_order_id", "orderId", "id"]) || `Order ${index + 1}`,
    customerId: text(item, ["customer_id", "customerId", "user_id", "userId"]) || text(item.customer, ["id"]),
    warehouseId: text(item, ["warehouse_id", "warehouseId", "warehouse", "warehouse_code"]) || text(item.warehouse, ["id", "code", "name"]),
    pickerId: text(item, ["picker_id", "pickerId", "staff_id"]) || text(item.picker, ["id"]),
    awb: text(item, ["awb", "awb_number", "tracking_number", "trackingId"]),
    courierProvider: text(item, ["courier_provider", "courierProvider"]) || text(item.courier, ["provider"]),
    courierOrderId: text(item, ["courier_order_id", "courierOrderId"]) || text(item.courier, ["order_id"]),
    courierShipmentId: text(item, ["courier_shipment_id", "courierShipmentId"]) || text(item.courier, ["shipment_id"]),
    courierStatus: text(item, ["courier_status", "courierStatus"]) || text(item.courier, ["status"]),
    pincode: text(item, ["pincode", "pin", "postal_code"]) || text(item.address, ["pincode", "pin"]),
    location: text(item, ["location", "city", "area"]) || text(item.address, ["city", "area", "full"]),
    customer: text(item, ["customer_name", "name"]) || text(item.customer, ["name"]) || "Customer",
    phone: text(item, ["phone", "mobile", "customer_phone"]) || text(item.customer, ["phone", "mobile"]),
    address: text(item, ["address", "delivery_address"]) || text(item.address, ["line1", "full"]),
    status: text(item, ["status", "order_status", "fulfillment_status"]) || "pending",
    total: number(item, ["total", "amount", "grand_total"]) || number(item.amounts, ["total"]),
    items: Array.isArray(item.items) ? item.items.length : number(item, ["item_count", "items_count"]),
    createdAt: text(item, ["created_at", "createdAt", "date", "ordered_at"]),
    date: dateKey(text(item, ["created_at", "createdAt", "date", "ordered_at"])),
    time: timeKey(text(item, ["created_at", "createdAt", "date", "ordered_at"])),
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
    warehouseId: text(item, ["warehouse_id", "warehouseId", "warehouse", "warehouse_code"]),
    awb: text(item, ["awb", "awb_number", "tracking_number"]),
    customer: text(item, ["customer_name", "name"]) || text(item.customer, ["name"]) || "Customer",
    phone: text(item, ["phone", "mobile"]) || text(item.customer, ["phone", "mobile"]),
    status: text(item, ["status"]) || "return",
    reason: text(item, ["reason", "note", "details"]) || "Return",
    createdAt: text(item, ["created_at", "createdAt", "date"]),
  };
}

function normalizeAccessUser(item, index = 0) {
  const firstWarehouse = Array.isArray(item.warehouses) ? item.warehouses[0] : null;
  const warehouseId = text(item, ["warehouseId", "warehouse_id"]) || text(firstWarehouse, ["id"]);
  const warehouseCode = text(item, ["warehouseCode", "warehouse_code", "warehouse"]) || text(firstWarehouse, ["code", "name"]);
  return {
    id: String(item.id || item.userId || item.email || index),
    userId: text(item, ["userId", "email", "username", "id"]) || `user-${index + 1}`,
    name: text(item, ["name", "full_name"]),
    phone: text(item, ["phone", "mobile"]),
    role: text(item, ["role", "type"]) || "picker",
    warehouseId,
    warehouseCode,
    warehouses: Array.isArray(item.warehouses) ? item.warehouses : [],
    status: text(item, ["status"]) || "active",
    permissions: Array.isArray(item.permissions) ? item.permissions : String(item.permissions || "").split(",").map((value) => value.trim()).filter(Boolean),
    createdAt: text(item, ["createdAt", "created_at"]),
  };
}

function normalizeWarehouse(item, index = 0) {
  const id = text(item, ["id", "warehouseId", "warehouse_id"]) || text(item, ["code"]) || String(index + 1);
  const code = text(item, ["code", "warehouseCode", "warehouse_code"]) || id;
  const name = text(item, ["name", "title"]) || code;
  const pincode = text(item, ["pincode", "pin"]);
  return {
    id,
    code,
    name,
    pincode,
    label: `${code}${name && name !== code ? ` / ${name}` : ""}${pincode ? ` / ${pincode}` : ""}`,
  };
}

function normalizeInventory(item, index = 0) {
  const product = item.product || item;
  const stock = number(item, ["available_quantity", "available", "stock", "quantity", "qty"]) || number(product, ["stockQuantity", "stock_quantity", "stock"]);
  const price = number(product, ["price", "sale_price", "selling_price", "mrp", "amount"]);
  return {
    id: String(item.id || product.id || product.sku || index),
    name: text(product, ["name", "title", "product_name"]) || `Inventory ${index + 1}`,
    sku: text(product, ["sku", "barcode", "ean"]),
    warehouseId: text(item, ["warehouse_id", "warehouseId", "warehouse", "warehouse_code"]) || text(item.warehouse, ["id", "code", "name"]),
    location: text(item, ["location", "location_code", "full_code", "barcode", "bin"]) || text(item.location, ["full_code", "barcode", "code"]),
    image: firstImage(product),
    stock,
    value: stock * price,
  };
}

function firstImage(item) {
  if (!item || typeof item !== "object") return "";
  const direct = text(item, ["image", "image_url", "imageUrl", "featured_image", "featuredImage"]);
  if (direct) return resolveMediaUrl(direct);
  const images = Array.isArray(item.images) ? item.images : [];
  if (!images.length) return "";
  const first = images[0];
  return resolveMediaUrl(typeof first === "string" ? first : text(first, ["src", "url", "image"]));
}

function resolveMediaUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.startsWith("gs://")) return "";
  if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
  try {
    return new URL(raw, store.config.websiteUrl || window.location.origin).href;
  } catch {
    return raw;
  }
}

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["products", "orders", "customers", "users", "warehouses", "items", "returns", "data", "results", "records"]) {
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

function timeKey(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const match = String(value).match(/\b\d{1,2}:\d{2}(:\d{2})?\b/);
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

function loadLocalUsers() {
  try {
    return JSON.parse(localStorage.getItem("evspeareAccessUsers") || "[]").map(normalizeAccessUser);
  } catch {
    return [];
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
