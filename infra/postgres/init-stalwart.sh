#!/bin/sh
# Creates the separate database Stalwart uses as its data and blob store (runs once on first start).
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  CREATE USER stalwart WITH PASSWORD '${STALWART_DB_PASSWORD}';
  CREATE DATABASE stalwart OWNER stalwart;
SQL
