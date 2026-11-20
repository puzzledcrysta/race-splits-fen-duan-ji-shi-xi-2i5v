import sqlite3
from contextlib import contextmanager
from pathlib import Path
from app import settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, source BLOB NOT NULL, book BLOB NOT NULL,
  result TEXT NOT NULL, created TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
  run_id TEXT NOT NULL REFERENCES runs(id), version INTEGER NOT NULL,
  decision TEXT NOT NULL, note TEXT NOT NULL, changed TEXT NOT NULL,
  PRIMARY KEY(run_id,version)
);
CREATE TABLE IF NOT EXISTS official (
  slot INTEGER PRIMARY KEY CHECK (slot = 1),
  run_id TEXT NOT NULL REFERENCES runs(id),
  version INTEGER NOT NULL,
  review_version INTEGER NOT NULL,
  published TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS official_history (
  version INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  review_version INTEGER NOT NULL,
  published TEXT NOT NULL,
  superseded TEXT NOT NULL
);
"""


@contextmanager
def connection():
    path = Path(settings.DB)
    path.parent.mkdir(parents=True,exist_ok=True)
    db = sqlite3.connect(path,timeout=10)
    db.row_factory = sqlite3.Row
    try:
        db.execute('PRAGMA foreign_keys = ON')
        db.executescript(SCHEMA)
        with db:
            yield db
    finally:
        db.close()
