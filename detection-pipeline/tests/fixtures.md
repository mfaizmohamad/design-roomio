# Test fixtures

The room photos used by `smoke_vlm.py` live in `tests/fixtures/` and are **gitignored**
(downloaded test assets, not committed). Re-fetch them with:

```bash
cd detection-pipeline && mkdir -p tests/fixtures
base="https://commons.wikimedia.org/wiki/Special:FilePath"
curl -sL "$base/Living_room.jpg?width=1200"          -o tests/fixtures/living_room.jpg
curl -sL "$base/Bedroom%20Mitcham.jpg?width=1200"    -o tests/fixtures/bedroom.jpg
curl -sL "$base/Dining%20room%20interior.jpg?width=1200" -o tests/fixtures/dining_room.jpg
```

Sources: Wikimedia Commons (各 file's own license — generally CC BY-SA / public domain).
Used here only as local test inputs; not redistributed in the repo.

The offline unit suite (`test_pipeline.py`) does **not** need these — it uses synthetic
images so it runs fully offline with no downloads and no model.
