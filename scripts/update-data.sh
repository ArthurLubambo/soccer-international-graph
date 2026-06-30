#!/bin/bash
set -e

BASE_URL="https://raw.githubusercontent.com/martj42/international_results/master"
FILES=(results.csv goalscorers.csv shootouts.csv former_names.csv)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Downloading latest international football data..."

for file in "${FILES[@]}"; do
  curl -fsSL "$BASE_URL/$file" -o "$ROOT/data/$file"
  cp "$ROOT/data/$file" "$ROOT/public/data/$file"
  echo "  ✓ $file"
done

echo "Done. Both data/ and public/data/ are up to date."
