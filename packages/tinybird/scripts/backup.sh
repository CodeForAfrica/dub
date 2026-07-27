#!/bin/bash
set -e

mkdir -p backup

TOKEN=$(python3 -c "import json; d=open('.tinyb').read(); import re; print(re.search(r'\"token\"\s*:\s*\"([^\"]+)\"', d).group(1))")
HOST="https://api.eu-west-1.aws.tinybird.co"

for DS in dub_click_events dub_lead_events dub_sale_events dub_conversion_events_log dub_webhook_events dub_api_logs; do
  echo "Exporting $DS..."
  curl -s -G "$HOST/v0/sql" \
    --data-urlencode "q=SELECT * FROM $DS FORMAT CSVWithNames" \
    -H "Authorization: Bearer $TOKEN" \
    > "backup/${DS}.csv"
  echo "  $(wc -l < "backup/${DS}.csv") rows"
done

echo "Done. Files in packages/tinybird/backup/"
