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
- `PRODUCTS_ENDPOINT`
- `ORDERS_ENDPOINT`
- `CUSTOMERS_ENDPOINT`
- `PICKER_ORDERS_ENDPOINT`
- `RETURNS_ENDPOINT`
- `INVENTORY_ENDPOINT`
- `UPDATE_ENDPOINT`

The frontend does not show API settings. It logs in through `/api/admin/login` and uses the server-side proxy `/api/admin/proxy`.

For real warehouse user creation, set `BACKEND_BEARER_TOKEN` to the same value as the warehouse backend `INTEGRATION_API_KEY`. Then `/api/admin/users` syncs users into the warehouse database through `/api/central-panel/users`.

## Built-in user backend

The app includes a small Node backend for creating admin, manager and picker users:

- Admin-only list/create users: `/api/admin/users`
- Picker/warehouse login: `/api/login`
- Current logged-in staff user: `/api/me`

Users are stored in `data/db.json` with salted password hashes. For production-scale use, replace this file store with your main database while keeping the same endpoint shapes.
