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

Shopify apps require OAuth after 1. January 2026:

1. Go to https://dev.shopify.com/dashboard and create a new app, call it what you want t.ex "Simplyprint"
2. Add "App URL" and set it to where your server are accessibble t.ex: "https://shopisimply.mydomain.com/dashboard
3. Under Access and Scopes add "read_orders" and "read_products".
4. Redirect URLs: put in: "https://shopisimply.mydomain.com/api/shopify/auth"
5. Press Release.
6. Go to settings for your app in Dev dashboard -> Your app -> Settings and copy your Client ID and use that for SHOPIFY_APP_API_KEY variable and copy Secret as a variable for SHOPIFY_APP_API_SECRET.
7. Go to Dev Dashboard -> Your app -> Home and choose Distribution -> Custom Distribution -> Enter your Shopify domain t.ex https://admin.shopify.com/store/MyStore -> Generate link -> Paste that link in your webbrowser and install the app.
8. Start the docker-container -> Choose authenticate on Shopify -> Products should sync and you are up and running :)
The access token is stored in the database after installation.



## Docker
Use docker-compose.yml to run everything in one container. Provide secrets via environment variables.

Build and run manually:

1. Build image:
   docker build -t shopify-simplyprint-sync:latest .
2. Run container:
   docker run --name shopify-simplyprint-sync -p 4000:4000 -v %cd%/data:/app/data -e SHOPIFY_APP_API_KEY=YOUR_APP_KEY -e SHOPIFY_APP_API_SECRET=YOUR_APP_SECRET -e SHOPIFY_APP_URL=YOUR_PUBLIC_URL -e -e SIMPLYPRINT_COMPANY_ID=YOUR_COMPANY_ID -e SIMPLYPRINT_API_KEY=YOUR_SIMPLYPRINT_API_KEY -e SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com -e SIMPLYPRINT_QUEUE_GROUP_NAME=Shopify -e DATABASE_URL=file:/app/data/app.db shopify-simplyprint-sync:latest

Note: The Docker image uses Debian slim with OpenSSL installed to satisfy Prisma runtime requirements.

## Shopify webhook
Create a Shopify webhook for orders/create and point it to:

  https://YourServer.mydomain.com/api/webhooks/shopify/orders/create

If BASIC_AUTH_USER/BASIC_AUTH_PASS are set, the webhook still works because it is excluded from auth.

## SimplyPrint queue group
The queue group name defaults to "Shopify". Create this queue group in SimplyPrint or change SIMPLYPRINT_QUEUE_GROUP_NAME in the variable or in the software when its started.
