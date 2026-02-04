#!/bin/sh
set -e

if [ -z "$DATABASE_URL" ]; then
  export DATABASE_URL="file:/app/data/app.db"
fi

echo "Applying Prisma schema (db push)..."
./node_modules/.bin/prisma db push

if [ -f "./dist/migrate-mappings.js" ]; then
  echo "Running mapping migration..."
  node ./dist/migrate-mappings.js
fi

echo "Starting server..."
exec node dist/index.js
