# Shopify → SimplyPrint Sync

This service lets you map Shopify products and variants to SimplyPrint files. When a Shopify order is created, mapped items are added to the SimplyPrint "Shopify" queue group.

## Features
- Map by product or variant
- Search SimplyPrint files by filename
- Auto-queue on Shopify order creation
- Single container deployment

## Environment variables
Create a .env file for the server using server/.env.example as a template:

- PORT
- DATABASE_URL
- SHOPIFY_SHOP_DOMAIN
- SHOPIFY_ADMIN_API_TOKEN
- SHOPIFY_API_VERSION
- SHOPIFY_WEBHOOK_SECRET (optional)
- SIMPLYPRINT_COMPANY_ID
- SIMPLYPRINT_API_KEY
- SIMPLYPRINT_QUEUE_GROUP_NAME
- BASIC_AUTH_USER (optional)
- BASIC_AUTH_PASS (optional)

## Local development
1. Install dependencies:
   - In server: npm install
   - In web: npm install
2. Generate Prisma client and migrate database:
   - In server: npm run prisma:generate
   - In server: npm run prisma:migrate
3. Start backend:
   - In server: npm run dev
4. Start frontend:
   - In web: npm run dev

The web app is served at port 5173 in dev mode, and it proxies API requests to the server at port 4000.

## Docker
Use docker-compose.yml to run everything in one container. Provide secrets via environment variables.

Build and run manually:

1. Build image:
   docker build -t shopify-simplyprint-sync:latest .
2. Run container:
   docker run --name shopify-simplyprint-sync -p 4000:4000 -v %cd%/data:/app/data -e SHOPIFY_ADMIN_API_TOKEN=YOUR_SHOPIFY_ADMIN_API_TOKEN -e SHOPIFY_WEBHOOK_SECRET=YOUR_SHOPIFY_WEBHOOK_SECRET -e SIMPLYPRINT_COMPANY_ID=YOUR_COMPANY_ID -e SIMPLYPRINT_API_KEY=YOUR_SIMPLYPRINT_API_KEY -e SHOPIFY_SHOP_DOMAIN=protonord.myshopify.com -e SIMPLYPRINT_QUEUE_GROUP_NAME=Shopify -e DATABASE_URL=file:/app/data/app.db shopify-simplyprint-sync:latest

Note: The Docker image uses Debian slim with OpenSSL installed to satisfy Prisma runtime requirements.

## Shopify webhook
Create a Shopify webhook for orders/create and point it to:

  /api/webhooks/shopify/orders/create

If you set SHOPIFY_WEBHOOK_SECRET, the webhook signature is verified.
If BASIC_AUTH_USER/BASIC_AUTH_PASS are set, the webhook still works because it is excluded from auth.

## SimplyPrint queue group
The queue group name defaults to "Shopify". Create this queue group in SimplyPrint or change SIMPLYPRINT_QUEUE_GROUP_NAME.
