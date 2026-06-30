#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ZIP="$ROOT/scripts/international-football.zip"
EXTRACT="$ROOT/scripts/extracted"

# Read Kaggle credentials
KAGGLE_JSON="$HOME/.kaggle/kaggle.json"
if [ -f "$KAGGLE_JSON" ]; then
  KAGGLE_USERNAME=$(python3 -c "import json; d=json.load(open('$KAGGLE_JSON')); print(d['username'])")
  KAGGLE_KEY=$(python3 -c "import json; d=json.load(open('$KAGGLE_JSON')); print(d['key'])")
elif [ -n "$KAGGLE_USERNAME" ] && [ -n "$KAGGLE_KEY" ]; then
  : # already set via env
else
  echo "Error: Kaggle credentials not found."
  echo "Either create ~/.kaggle/kaggle.json or set KAGGLE_USERNAME and KAGGLE_KEY env vars."
  echo "Get your API key at: https://www.kaggle.com/settings > API > Create New Token"
  exit 1
fi

echo "Downloading latest international football data from Kaggle..."
curl -L -u "$KAGGLE_USERNAME:$KAGGLE_KEY" -o "$ZIP" \
  https://www.kaggle.com/api/v1/datasets/download/martj42/international-football-results-from-1872-to-2017

echo "Extracting..."
rm -rf "$EXTRACT"
unzip -q "$ZIP" -d "$EXTRACT"

FILES=(results.csv goalscorers.csv shootouts.csv former_names.csv)

echo "Copying files..."
for file in "${FILES[@]}"; do
  cp "$EXTRACT/$file" "$ROOT/data/$file"
  cp "$EXTRACT/$file" "$ROOT/public/data/$file"
  echo "  ✓ $file"
done

rm -rf "$ZIP" "$EXTRACT"

echo "Done. Both data/ and public/data/ are up to date."
