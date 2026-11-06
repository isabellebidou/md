#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_root"
docker compose up --build -d
printf 'App is running at http://localhost:8000\n'
