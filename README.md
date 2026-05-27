# EV Speare Central Panel

Professional central admin panel for EV Speare website, customer app, picker app and warehouse modules.

## Local run

```bash
npm start
```

Open `http://127.0.0.1:8000/`.

## Railway deploy

1. Create a new Railway project.
2. Choose Deploy from GitHub or upload this folder.
3. Railway will detect `package.json`.
4. Start command: `npm start`.
5. Add a custom domain if needed, for example `central.evspeare.shop`.

The server uses Railway's `PORT` automatically.

## Connect data

Set these environment variables in your hosting provider:

- `CENTRAL_ADMIN_ID`
- `CENTRAL_ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET` recommended stable secret so admin login stays valid across restarts
- `ADMIN_SESSION_TTL_MS` optional session duration in milliseconds, default 7 days
- `BACKEND_API_URL`
- `BACKEND_BEARER_TOKEN` if protected backend endpoints need a token
- `WAREHOUSE_ID` optional default warehouse
- `PRODUCTS_ENDPOINT` optional, default `/central-panel/products`
- `ORDERS_ENDPOINT` optional, default `/central-panel/orders`
- `CUSTOMERS_ENDPOINT` optional, default `/central-panel/customers`
- `PICKER_ORDERS_ENDPOINT` optional, default `/central-panel/picker-orders`
- `RETURNS_ENDPOINT` optional, default `/central-panel/returns`
- `INVENTORY_ENDPOINT` optional, default `/central-panel/inventory`
- `UPDATE_ENDPOINT` optional central editor storage endpoint, default `/central-panel/update`
- `INBOUND_ORDERS_ENDPOINT` optional warehouse inbound order feed, default `/central-panel/inbound-orders`
- `INBOUND_APP_URL` optional deployed inbound customer storefront link shown in the panel

The frontend does not show API settings. It logs in through `/api/admin/login` and uses the server-side proxy `/api/admin/proxy`.

Set `BACKEND_BEARER_TOKEN` to the same value as the warehouse backend `INTEGRATION_API_KEY`. The dashboard data feeds, editor settings and `/api/admin/users` then sync through the protected warehouse central-panel APIs.

Create customers with the `Inbound Customer` role and map a warehouse. Those credentials log into the dedicated `inbound-customer-app-source` app; orders receive a server-enforced 20% discount and appear in the central `Inbound Customers` page.

## Built-in user backend

The app includes a small Node backend for creating admin, manager and picker users:

- Admin-only list/create users: `/api/admin/users`
- Picker/warehouse login: `/api/login`
- Current logged-in staff user: `/api/me`

Users are stored in `data/db.json` with salted password hashes. For production-scale use, replace this file store with your main database while keeping the same endpoint shapes.
