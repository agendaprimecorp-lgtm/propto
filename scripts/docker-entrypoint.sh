#!/bin/sh
set -e

echo "🚀 Propto Worker Starting..."

# Wait for database if configured
if [ -n "$WAIT_FOR_DB" ]; then
  echo "⏳ Waiting for database connection..."
  timeout=30
  while [ $timeout -gt 0 ]; do
    if pg_isready -h "${DATABASE_HOST:-localhost}" -p "${DATABASE_PORT:-5432}" -U "${DATABASE_USER:-postgres}" > /dev/null 2>&1; then
      echo "✅ Database is ready"
      break
    fi
    timeout=$((timeout - 1))
    sleep 1
  done

  if [ $timeout -eq 0 ]; then
    echo "⚠️  Database connection timeout, continuing anyway..."
  fi
fi

# Run migrations if configured
if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "🔄 Running migrations..."
  if npm run migrate 2>/dev/null || npm -w @propto/capture-worker run migrate 2>/dev/null; then
    echo "✅ Migrations completed"
  else
    echo "⚠️  Migrations not available or failed, continuing anyway..."
  fi
fi

# Start the worker
echo "🎯 Starting capture-worker..."
exec npm -w @propto/capture-worker run start
