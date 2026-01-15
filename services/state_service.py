import json
import re
from pathlib import Path

DEFAULT_PEOPLE = ["Yiannos", "Ntinos", "Ari", "Eva", "Athanasia", "Spiros", "Rozina", "Anna"]
DEFAULT_STATE = {"people": list(DEFAULT_PEOPLE), "receipts": []}


def ensure_dirs(data_dir: Path, upload_dir: Path) -> None:
  data_dir.mkdir(parents=True, exist_ok=True)
  upload_dir.mkdir(parents=True, exist_ok=True)


def clean(text):
  if not text:
    return None
  stripped = re.sub(r"<[^>]+>", "", str(text))
  stripped = re.sub(r"\s+", " ", stripped).strip()
  return stripped or None


def parse_number(text):
  if text is None:
    return None
  raw = str(text)
  raw = raw.replace("\xa0", "").replace(" ", "")
  raw = re.sub(r"[^\d,.\-]", "", raw)
  if not raw:
    return None
  # Handle common formats:
  # - "1.234,56" (thousands with dot, decimal comma)
  # - "1,234.56" (thousands with comma, decimal dot)
  # - "1234,56" (decimal comma)
  if "," in raw and "." in raw:
    raw = raw.replace(".", "").replace(",", ".")
  elif raw.count(",") == 1 and raw.count(".") == 0:
    raw = raw.replace(",", ".")
  else:
    raw = raw.replace(",", "")
  try:
    return float(raw)
  except ValueError:
    return None


def normalize_state(raw_state):
  """
  Ensure required keys exist, defaults are present, and names are de-duped/cleaned.
  """
  people = []
  seen = set()

  def add_person(name):
    cleaned = clean(name)
    if cleaned and cleaned not in seen:
      seen.add(cleaned)
      people.append(cleaned)

  # Always seed with defaults in the requested order
  for default_name in DEFAULT_PEOPLE:
    add_person(default_name)

  raw_people = raw_state.get("people") if isinstance(raw_state, dict) else []
  if isinstance(raw_people, list):
    for name in raw_people:
      add_person(name)

  receipts = raw_state.get("receipts") if isinstance(raw_state, dict) else []
  if not isinstance(receipts, list):
    receipts = []

  return {"people": people, "receipts": receipts}


def save_state(state, data_file: Path, data_dir: Path, upload_dir: Path) -> None:
  ensure_dirs(data_dir, upload_dir)
  with data_file.open("w", encoding="utf-8") as fh:
    json.dump(state, fh, ensure_ascii=False, indent=2)


def load_state(data_file: Path, data_dir: Path, upload_dir: Path):
  ensure_dirs(data_dir, upload_dir)
  raw = {}
  if data_file.exists():
    try:
      with data_file.open("r", encoding="utf-8") as fh:
        raw = json.load(fh)
    except json.JSONDecodeError:
      raw = {}
  state = normalize_state(raw)
  if (not data_file.exists()) or state != raw:
    save_state(state, data_file, data_dir, upload_dir)
  return state


def compute_summary(state):
  people = {name: {"paid": 0.0, "consumed": 0.0} for name in state.get("people", [])}
  for receipt in state.get("receipts", []):
    total = receipt.get("total_amount") or 0.0
    paid_by = receipt.get("paid_by")
    if paid_by in people:
      people[paid_by]["paid"] += total
    for item in receipt.get("items", []):
      participants = item.get("participants") or []
      if not participants:
        continue
      item_total = item.get("total")
      if item_total is None:
        q = item.get("quantity") or 0
        p = item.get("price") or 0
        item_total = q * p
      if not item_total:
        continue
      share = item_total / len(participants)
      for person in participants:
        if person in people:
          people[person]["consumed"] += share
  summary = []
  for name, data in people.items():
    net = round(data["paid"] - data["consumed"], 2)
    summary.append(
      {
        "name": name,
        "paid": round(data["paid"], 2),
        "consumed": round(data["consumed"], 2),
        "net": net
      }
    )
  summary.sort(key=lambda x: x["name"].lower())
  return summary
