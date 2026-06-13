# Sample Data — Northwind Robotics (fictional)

A coherent fictional company so you can try Comb end to end, and a template for
your own data. Ingest one, some, or all:

    comb ingest sample-data/refund-policy.md --source refund-policy
    for f in sample-data/*.md;  do comb ingest "$f" --source "$(basename "$f" .md)";  done
    for f in sample-data/*.csv; do comb ingest "$f" --source "$(basename "$f" .csv)"; done

Replace these with YOUR real docs (any .md/.txt/.csv/.json or a URL). After a
big load, recalibrate refusal:  comb calibrate --labels your-labels.json
