const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const port = Number(process.env.PORT || process.argv[2] || 8000);
const host = process.env.HOST || "0.0.0.0";
const root = __dirname;
const dataDir = path.join(root, "data");
const dbPath = path.join(dataDir, "db.json");
const staffSessions = new Map();

const config = {
  websiteUrl: process.env.WEBSITE_URL || "https://www.evspeare.shop",
  customerAppApi: (process.env.CUSTOMER_APP_API_URL || process.env.WEBSITE_URL || "https://www.evspeare.shop").replace(/\/+$/, ""),
  pickerUrl: process.env.PICKER_URL || "https://evsphere-warehouse-mobile-production.up.railway.app",
  inboundAppUrl: process.env.INBOUND_APP_URL || "",
  backendApi: (process.env.BACKEND_API_URL || "https://evsphere-warehouse-backend-production.up.railway.app/api").replace(/\/+$/, ""),
  productsEndpoint: process.env.PRODUCTS_ENDPOINT || "/central-panel/products",
  ordersEndpoint: process.env.ORDERS_ENDPOINT || "/central-panel/orders",
  customersEndpoint: process.env.CUSTOMERS_ENDPOINT || "/central-panel/customers",
  pickerOrdersEndpoint: process.env.PICKER_ORDERS_ENDPOINT || "/central-panel/picker-orders",
  returnsEndpoint: process.env.RETURNS_ENDPOINT || "/central-panel/returns",
  inventoryEndpoint: process.env.INVENTORY_ENDPOINT || "/central-panel/inventory",
  updateEndpoint: process.env.UPDATE_ENDPOINT || "/central-panel/update",
  inboundOrdersEndpoint: process.env.INBOUND_ORDERS_ENDPOINT || "/central-panel/inbound-orders",
  itemNotFoundEndpoint: process.env.ITEM_NOT_FOUND_ENDPOINT || "/central-panel/item-not-found",
  cashSettlementsEndpoint: process.env.CASH_SETTLEMENTS_ENDPOINT || "/central-panel/cash-settlements",
};

const adminId = process.env.CENTRAL_ADMIN_ID || "admin";
const adminPassword = process.env.CENTRAL_ADMIN_PASSWORD || "admin123";
const adminSessionSecret = process.env.ADMIN_SESSION_SECRET || `${adminId}:${adminPassword}`;
const adminSessionTtlMs = Number(process.env.ADMIN_SESSION_TTL_MS || 7 * 24 * 60 * 60 * 1000);
const backendToken = process.env.BACKEND_BEARER_TOKEN || process.env.WAREHOUSE_API_TOKEN || process.env.INTEGRATION_API_KEY || "";
const warehouseId = process.env.WAREHOUSE_ID || "";

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    if (requestUrl.pathname === "/api/login" && request.method === "POST") {
      await handleStaffLogin(request, response);
      return;
    }
    if (requestUrl.pathname === "/api/me") {
      await handleStaffMe(request, response);
      return;
    }
    if (requestUrl.pathname.startsWith("/api/admin/")) {
      await handleAdminApi(request, response, requestUrl);
      return;
    }
    serveStatic(requestUrl, response);
  } catch (error) {
    sendJson(response, 500, { ok: false, message: error.message || "Server error" });
  }
}).listen(port, host, () => {
  console.log(`EV Speare Central Panel running on ${host}:${port}`);
});

async function handleAdminApi(request, response, requestUrl) {
  if (requestUrl.pathname === "/api/admin/login" && request.method === "POST") {
    const body = await readJson(request);
    const loginId = String(body.adminId || body.email || "").trim();
    let admin = null;
    if (loginId === adminId && String(body.password || "") === adminPassword) {
      admin = { userId: adminId, permissions: ["*"] };
    } else {
      admin = await authenticateManagedAdmin(loginId, String(body.password || ""));
    }
    if (!admin) {
      sendJson(response, 401, { ok: false, message: "Invalid admin ID or password" });
      return;
    }
    const token = createAdminToken(admin);
    sendJson(response, 200, { ok: true, token, permissions: admin.permissions });
    return;
  }

  const admin = authorizedAdmin(request);
  if (!admin) {
    sendJson(response, 401, { ok: false, message: "Admin login required" });
    return;
  }

  if (requestUrl.pathname === "/api/admin/config") {
    sendJson(response, 200, { ok: true, config, permissions: admin.permissions });
    return;
  }

  if (requestUrl.pathname === "/api/admin/users") {
    if (!adminCanOpen(admin, "user-create")) {
      sendJson(response, 403, { ok: false, message: "You are not allowed to access this page." });
      return;
    }
    await handleUsersApi(request, response);
    return;
  }

  if (requestUrl.pathname === "/api/admin/warehouses") {
    await handleWarehousesApi(request, response);
    return;
  }

  if (requestUrl.pathname === "/api/admin/push-notifications") {
    if (!adminCanOpen(admin, "push-notifications")) {
      sendJson(response, 403, { ok: false, message: "You are not allowed to access this page." });
      return;
    }
    await handlePushNotificationsApi(request, response, admin);
    return;
  }

  if (requestUrl.pathname === "/api/admin/proxy") {
    await proxyBackend(request, response, requestUrl);
    return;
  }

  sendJson(response, 404, { ok: false, message: "Admin API route not found" });
}

async function handlePushNotificationsApi(request, response, admin) {
  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false, message: "Method not allowed" });
    return;
  }
  const body = await readJson(request);
  const title = String(body.title || "").trim();
  const message = String(body.message || "").trim();
  if (!title || !message) {
    sendJson(response, 400, { ok: false, message: "Title and message are required" });
    return;
  }
  const notification = {
    id: crypto.randomUUID(),
    title,
    message,
    audience: String(body.audience || "all").trim(),
    pincode: String(body.pincode || "").replace(/\D/g, "").slice(0, 6),
    target: String(body.target || "orders").trim(),
    schedule: String(body.schedule || "now").trim(),
    priority: String(body.priority || "normal").trim(),
    status: body.schedule === "draft" ? "draft" : "queued",
    createdBy: admin.userId || adminId,
    createdAt: new Date().toISOString(),
  };
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.appendFileSync(path.join(dataDir, "push-notifications.jsonl"), `${JSON.stringify(notification)}\n`);

  const pushAdminToken = String(process.env.PUSH_ADMIN_TOKEN || "").trim();
  let customerAppPushError = "";
  let customerAppDelivery = null;
  if (pushAdminToken && notification.status === "queued") {
    try {
      const appResponse = await fetch(`${config.customerAppApi}/api/mobile/push/send`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${pushAdminToken}`,
        },
        body: JSON.stringify(notification),
      });
      const appData = await appResponse.json().catch(() => ({}));
      if (appResponse.ok && appData.ok !== false) {
        customerAppDelivery = appData;
      } else {
        customerAppPushError = appData?.result?.message || appData?.message || `Customer app returned ${appResponse.status}`;
      }
    } catch (error) {
      customerAppPushError = error.message || "Customer app push endpoint is not reachable";
    }
  } else if (notification.status === "queued") {
    customerAppPushError = "PUSH_ADMIN_TOKEN is not configured in central panel";
  }

  let backendSynced = false;
  let backendSyncError = "";
  if (backendToken && notification.status === "queued") {
    try {
      const upstream = await fetch(`${config.backendApi}/central-panel/push-notifications`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${backendToken}`,
        },
        body: JSON.stringify(notification),
      });
      backendSynced = upstream.ok;
    } catch (error) {
      backendSyncError = error.message || "Backend push sync failed";
    }
  }

  if (customerAppDelivery) {
    sendJson(response, 200, {
      ok: true,
      message: `Push sent to ${customerAppDelivery.targets || 0} registered device(s).`,
      notification,
      delivery: customerAppDelivery,
      backendSynced,
      backendSyncError: backendSynced ? undefined : backendSyncError || undefined,
    });
    return;
  }

  const queuedMessage = customerAppPushError
    ? `Push notification queued locally. Mobile delivery failed: ${customerAppPushError}`
    : "Push notification queued locally.";
  sendJson(response, 200, {
    ok: true,
    message: notification.status === "draft" ? "Push notification draft saved." : queuedMessage,
    notification,
    delivery: customerAppPushError ? { ok: false, message: customerAppPushError } : undefined,
    backendSynced,
    backendSyncError: backendSynced ? undefined : backendSyncError || undefined,
  });
}

async function handleUsersApi(request, response) {
  if (backendToken) {
    try {
      const synced = await proxyCentralUsers(request);
      response.writeHead(synced.status, {
        "Content-Type": synced.contentType,
        "Cache-Control": "no-store",
      });
      response.end(synced.text);
      return;
    } catch (error) {
      if (request.method !== "GET") {
        sendJson(response, 502, { ok: false, message: `Warehouse user sync failed: ${error.message}` });
        return;
      }
    }
  }

  const db = readDb();
  if (request.method === "GET") {
    sendJson(response, 200, { ok: true, users: db.users.map(publicUser) });
    return;
  }

  if (request.method === "POST") {
    const body = await readJson(request);
    if (!body.userId || !body.password || !body.warehouseId) {
      sendJson(response, 400, { ok: false, message: "userId, password and warehouseId are required" });
      return;
    }
    if (db.users.some((item) => item.userId.toLowerCase() === String(body.userId).trim().toLowerCase())) {
      sendJson(response, 409, { ok: false, message: "User ID already exists" });
      return;
    }
    const user = buildUser(body);
    db.users.push(user);
    writeDb(db);
    sendJson(response, 201, { ok: true, user: publicUser(user), localOnly: true });
    return;
  }

  if (request.method === "PUT" || request.method === "PATCH") {
    const body = await readJson(request);
    const originalUserId = String(body.originalUserId || body.userId || "").trim().toLowerCase();
    const index = db.users.findIndex((item) => String(item.id) === String(body.id) || item.userId.toLowerCase() === originalUserId);
    if (index < 0) {
      sendJson(response, 404, { ok: false, message: "User not found" });
      return;
    }
    const updates = { ...body };
    delete updates.password;
    delete updates.confirmPassword;
    delete updates.originalUserId;
    if (body.password) updates.passwordHash = hashPassword(body.password, db.users[index].salt);
    db.users[index] = { ...db.users[index], ...updates, updatedAt: new Date().toISOString() };
    writeDb(db);
    sendJson(response, 200, { ok: true, user: publicUser(db.users[index]) });
    return;
  }

  if (request.method === "DELETE") {
    const body = await readJson(request);
    const index = db.users.findIndex((item) => String(item.id) === String(body.id) || item.userId.toLowerCase() === String(body.userId || "").toLowerCase());
    if (index < 0) {
      sendJson(response, 404, { ok: false, message: "User not found" });
      return;
    }
    const deleted = db.users.splice(index, 1)[0];
    writeDb(db);
    sendJson(response, 200, { ok: true, user: publicUser(deleted), localOnly: true });
    return;
  }

  sendJson(response, 405, { ok: false, message: "Method not allowed" });
}

async function handleWarehousesApi(request, response) {
  if (request.method !== "GET") {
    sendJson(response, 405, { ok: false, message: "Method not allowed" });
    return;
  }

  if (backendToken) {
    try {
      const synced = await proxyCentralPath(request, "/central-panel/warehouses");
      response.writeHead(synced.status, {
        "Content-Type": synced.contentType,
        "Cache-Control": "no-store",
      });
      response.end(synced.text);
      return;
    } catch (error) {
      sendJson(response, 502, { ok: false, message: `Warehouse list sync failed: ${error.message}` });
      return;
    }
  }

  const db = readDb();
  const warehouses = [...new Set(db.users.map((user) => user.warehouseId).filter(Boolean))].map((id) => ({
    id,
    code: id,
    name: id,
  }));
  if (warehouseId && !warehouses.some((warehouse) => String(warehouse.id) === String(warehouseId))) {
    warehouses.unshift({ id: warehouseId, code: warehouseId, name: warehouseId });
  }
  sendJson(response, 200, { ok: true, warehouses });
}

async function proxyCentralUsers(request) {
  return proxyCentralPath(request, "/central-panel/users");
}

async function proxyCentralPath(request, path) {
  const target = `${config.backendApi}${path}`;
  const headers = { Accept: "application/json", Authorization: `Bearer ${backendToken}` };
  if (!["GET", "HEAD"].includes(request.method)) headers["Content-Type"] = "application/json";
  const body = ["GET", "HEAD"].includes(request.method) ? undefined : await readText(request);
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body,
  });
  return {
    status: upstream.status,
    contentType: upstream.headers.get("content-type") || "application/json; charset=utf-8",
    text: await upstream.text(),
  };
}

async function authenticateManagedAdmin(loginId, password) {
  if (!loginId || !password) return null;
  try {
    const upstream = await fetch(`${config.backendApi}/login`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ email: loginId, password }),
    });
    const data = await upstream.json().catch(() => ({}));
    if (upstream.ok && data.user?.role === "admin") {
      return { userId: data.user.email || loginId, permissions: data.user.permissions || [] };
    }
  } catch {
    // Local built-in users remain available if the warehouse backend is offline.
  }
  const user = readDb().users.find((item) => item.userId.toLowerCase() === loginId.toLowerCase() && item.role === "admin" && item.status !== "blocked");
  if (!user || hashPassword(password, user.salt) !== user.passwordHash) return null;
  return { userId: user.userId, permissions: Array.isArray(user.permissions) ? user.permissions : [] };
}

async function handleStaffLogin(request, response) {
  const body = await readJson(request);
  const login = String(body.email || body.userId || "").trim().toLowerCase();
  const password = String(body.password || "");
  const db = readDb();
  const user = db.users.find((item) => item.userId.toLowerCase() === login && item.status !== "blocked");
  if (!user || hashPassword(password, user.salt) !== user.passwordHash) {
    sendJson(response, 401, { ok: false, message: "Invalid user ID or password" });
    return;
  }
  const token = crypto.randomBytes(32).toString("hex");
  staffSessions.set(token, { userId: user.userId, createdAt: Date.now() });
  sendJson(response, 200, { ok: true, token, user: publicUser(user) });
}

async function handleStaffMe(request, response) {
  const auth = request.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const session = staffSessions.get(token);
  if (!session) {
    sendJson(response, 401, { ok: false, message: "Login required" });
    return;
  }
  const db = readDb();
  const user = db.users.find((item) => item.userId === session.userId);
  sendJson(response, 200, { ok: true, user: user ? publicUser(user) : null });
}

async function proxyBackend(request, response, requestUrl) {
  const rawPath = requestUrl.searchParams.get("path") || "/";
  const target = /^https?:\/\//i.test(rawPath)
    ? rawPath
    : `${config.backendApi}${rawPath.startsWith("/") ? rawPath : `/${rawPath}`}`;
  const headers = { Accept: "application/json" };
  if (!["GET", "HEAD"].includes(request.method)) headers["Content-Type"] = "application/json";
  if (backendToken) headers.Authorization = `Bearer ${backendToken}`;
  if (warehouseId) headers["X-Warehouse-Id"] = warehouseId;

  const body = ["GET", "HEAD"].includes(request.method) ? undefined : await readText(request);
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body,
    redirect: "follow",
  });
  const text = await upstream.text();
  response.writeHead(upstream.status, {
    "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(text);
}

function serveStatic(requestUrl, response) {
  const relative = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
  const filePath = path.resolve(root, `.${relative}`);
  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": types[path.extname(filePath)] || "application/octet-stream" });
    response.end(data);
  });
}

function authorizedAdmin(request) {
  const auth = request.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return verifyAdminToken(token);
}

function adminCanOpen(admin, page) {
  if (admin.permissions.includes("*")) return true;
  const permission = `panel_${String(page).replaceAll("-", "_")}`;
  return admin.permissions.includes(permission) || (page === "cash-settlements" && admin.permissions.includes("panel_cash_tracker"));
}

function createAdminToken(admin = { userId: adminId, permissions: ["*"] }) {
  const payload = Buffer.from(JSON.stringify({
    scope: "admin",
    userId: admin.userId,
    permissions: admin.permissions,
    expiresAt: Date.now() + adminSessionTtlMs,
    nonce: crypto.randomBytes(16).toString("hex"),
  })).toString("base64url");
  return `${payload}.${adminTokenSignature(payload)}`;
}

function verifyAdminToken(token) {
  const [payload, suppliedSignature] = String(token || "").split(".");
  if (!payload || !suppliedSignature) return false;
  const expectedSignature = adminTokenSignature(payload);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data.scope !== "admin" || Number(data.expiresAt) <= Date.now()) return null;
    return { userId: data.userId || adminId, permissions: Array.isArray(data.permissions) ? data.permissions : ["*"] };
  } catch {
    return null;
  }
}

function adminTokenSignature(payload) {
  return crypto.createHmac("sha256", adminSessionSecret).update(payload).digest("base64url");
}

function buildUser(body) {
  const salt = crypto.randomBytes(16).toString("hex");
  return {
    id: crypto.randomUUID(),
    userId: String(body.userId || body.email || "").trim(),
    name: String(body.name || "").trim(),
    phone: String(body.phone || "").trim(),
    role: String(body.role || "picker").trim(),
    warehouseId: String(body.warehouseId || body.warehouse_id || "").trim(),
    status: String(body.status || "active").trim(),
    permissions: Array.isArray(body.permissions) ? body.permissions : [],
    salt,
    passwordHash: hashPassword(String(body.password || ""), salt),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function publicUser(user) {
  const { passwordHash, salt, ...safeUser } = user;
  return safeUser;
}

function hashPassword(password, salt) {
  return crypto.createHash("sha256").update(`${salt}:${password}`).digest("hex");
}

function readDb() {
  ensureDb();
  try {
    const db = JSON.parse(fs.readFileSync(dbPath, "utf8"));
    return { users: Array.isArray(db.users) ? db.users : [] };
  } catch {
    return { users: [] };
  }
}

function writeDb(db) {
  ensureDb();
  fs.writeFileSync(dbPath, JSON.stringify({ users: db.users || [] }, null, 2));
}

function ensureDb() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify({ users: [] }, null, 2));
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return readText(request).then((text) => {
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return {};
    }
  });
}

function readText(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) request.destroy();
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}
