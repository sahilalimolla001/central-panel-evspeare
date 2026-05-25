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

Open the deployed panel, go to `Integrations`, then set:

- Website app URL: `https://www.evspeare.shop`
- Backend API URL: `https://evsphere-warehouse-backend-production.up.railway.app/api`
- Website products endpoint: `https://www.evspeare.shop/api/mobile/products`
- Customer orders endpoint: `https://www.evspeare.shop/api/mobile/orders`
- Picker token: staff/admin bearer token if required
- Warehouse ID: optional
