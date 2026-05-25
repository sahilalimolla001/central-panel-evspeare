const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const port = Number(process.env.PORT || process.argv[2] || 8000);
const host = process.env.HOST || "0.0.0.0";
const root = __dirname;
const sessions = new Map();

const config = {
  websiteUrl: process.env.WEBSITE_URL || "https://www.evspeare.shop",
  pickerUrl: process.env.PICKER_URL || "https://evsphere-warehouse-mobile-production.up.railway.app",
  backendApi: (process.env.BACKEND_API_URL || "https://evsphere-warehouse-backend-production.up.railway.app/api").replace(/\/+$/, ""),
  productsEndpoint: process.env.PRODUCTS_ENDPOINT || "https://www.evspeare.shop/api/mobile/products",
  ordersEndpoint: process.env.ORDERS_ENDPOINT || "https://www.evspeare.shop/api/mobile/orders",
  customersEndpoint: process.env.CUSTOMERS_ENDPOINT || "/customers",
  pickerOrdersEndpoint: process.env.PICKER_ORDERS_ENDPOINT || "/pick-list",
  returnsEndpoint: process.env.RETURNS_ENDPOINT || "/returns/pick-list",
  inventoryEndpoint: process.env.INVENTORY_ENDPOINT || "/inventory",
  updateEndpoint: process.env.UPDATE_ENDPOINT || "/central-panel/update",
};

const adminId = process.env.CENTRAL_ADMIN_ID || "admin";
const adminPassword = process.env.CENTRAL_ADMIN_PASSWORD || "admin123";
const backendToken = process.env.BACKEND_BEARER_TOKEN || "";
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
    if (String(body.adminId || body.email || "").trim() !== adminId || String(body.password || "") !== adminPassword) {
      sendJson(response, 401, { ok: false, message: "Invalid admin ID or password" });
      return;
    }
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { createdAt: Date.now() });
    sendJson(response, 200, { ok: true, token });
    return;
  }

  if (!isAuthorized(request)) {
    sendJson(response, 401, { ok: false, message: "Admin login required" });
    return;
  }

  if (requestUrl.pathname === "/api/admin/config") {
    sendJson(response, 200, { ok: true, config });
    return;
  }

  if (requestUrl.pathname === "/api/admin/proxy") {
    await proxyBackend(request, response, requestUrl);
    return;
  }

  sendJson(response, 404, { ok: false, message: "Admin API route not found" });
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

function isAuthorized(request) {
  const auth = request.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return Boolean(token && sessions.has(token));
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
