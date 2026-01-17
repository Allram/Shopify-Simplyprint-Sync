#!/bin/sh
set -e

if [ -n "$DATABASE_URL" ]; then
  if [ -d "./prisma/migrations" ]; then
    echo "Running Prisma migrations..."
    ./node_modules/.bin/prisma migrate deploy
  else
    echo "Applying Prisma schema (db push)..."
    ./node_modules/.bin/prisma db push
  fi
fi

echo "Starting server..."
node dist/index.js
