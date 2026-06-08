#!/bin/sh
set -e

echo ">>> Running database migrations..."
node_modules/.bin/prisma migrate deploy

echo ">>> Starting API server..."
exec node dist/index.js
