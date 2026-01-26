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
- SHOPIFY_APP_API_KEY (Custom App Client ID)
- SHOPIFY_APP_API_SECRET (Custom App Secret)
- SHOPIFY_APP_URL (URL to your server with https)
- SHOPIFY_APP_ACCESS_TOKEN (optional legacy)
- SHOPIFY_API_VERSION
- SHOPIFY_WEBHOOK_SECRET (optional)
- SIMPLYPRINT_COMPANY_ID
- SIMPLYPRINT_API_KEY
- SIMPLYPRINT_QUEUE_GROUP_NAME
- BASIC_AUTH_USER (optional)
- BASIC_AUTH_PASS (optional)

Shopify apps require OAuth. Configure SHOPIFY_APP_API_KEY/SECRET/URL and then install the app by visiting /api/shopify/auth.
The access token is stored in the database after installation.



## Docker
Use docker-compose.yml to run everything in one container. Provide secrets via environment variables.

Build and run manually:

1. Build image:
   docker build -t shopify-simplyprint-sync:latest .
2. Run container:
   docker run --name shopify-simplyprint-sync -p 4000:4000 -v %cd%/data:/app/data -e SHOPIFY_APP_API_KEY=YOUR_APP_KEY -e SHOPIFY_APP_API_SECRET=YOUR_APP_SECRET -e SHOPIFY_APP_URL=YOUR_PUBLIC_URL -e SHOPIFY_APP_SCOPES=read_products,read_orders -e SHOPIFY_WEBHOOK_SECRET=YOUR_SHOPIFY_WEBHOOK_SECRET -e SIMPLYPRINT_COMPANY_ID=YOUR_COMPANY_ID -e SIMPLYPRINT_API_KEY=YOUR_SIMPLYPRINT_API_KEY -e SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com -e SIMPLYPRINT_QUEUE_GROUP_NAME=Shopify -e DATABASE_URL=file:/app/data/app.db shopify-simplyprint-sync:latest

Note: The Docker image uses Debian slim with OpenSSL installed to satisfy Prisma runtime requirements.

## Shopify webhook
Create a Shopify webhook for orders/create and point it to:

  https://YourServer.mydomain.com/api/webhooks/shopify/orders/create

If you set SHOPIFY_WEBHOOK_SECRET, the webhook signature is verified.
If BASIC_AUTH_USER/BASIC_AUTH_PASS are set, the webhook still works because it is excluded from auth.

## SimplyPrint queue group
The queue group name defaults to "Shopify". Create this queue group in SimplyPrint or change SIMPLYPRINT_QUEUE_GROUP_NAME.
