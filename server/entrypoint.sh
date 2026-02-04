#!/bin/sh
set -e

if [ -z "$DATABASE_URL" ]; then
  export DATABASE_URL="file:/app/data/app.db"
fi

if [ -d "./prisma/migrations" ]; then
  echo "Running Prisma migrations..."
  ./node_modules/.bin/prisma migrate deploy
else
  echo "Applying Prisma schema (db push)..."
  ./node_modules/.bin/prisma db push
fi

if [ -f "./dist/migrate-mappings.js" ]; then
  echo "Running mapping migration..."
  node ./dist/migrate-mappings.js
fi

echo "Starting server..."
exec node dist/index.js
