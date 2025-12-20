#!/usr/bin/env python3
"""
Lightweight receipt sharing web app using only the standard library.
Run: python3 app.py  (serves on http://localhost:8000)
"""
import cgi
import datetime as dt
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import urllib.error
import uuid
from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from socketserver import ThreadingMixIn
from http.server import HTTPServer

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = BASE_DIR / "uploads"
DATA_FILE = DATA_DIR / "state.json"


def ensure_dirs():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

def debug(msg):
    prefix = "\033[96m---- DEBUG ----\033[0m"
    line = f"{prefix} {msg}"
    # Print to stdout so terminals (and VS Code) show it immediately
    print(line, flush=True)
    sys.stderr.write(line + "\n")
    sys.stderr.flush()


DEFAULT_STATE = {
    "people": ["Alex", "Jamie", "Taylor"],
    "receipts": []
}

QR_API = "https://api.qrserver.com/v1/read-qr-code/?outputformat=json"


def load_state():
    ensure_dirs()
    if not DATA_FILE.exists():
        save_state(DEFAULT_STATE)
    with DATA_FILE.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def save_state(state):
    ensure_dirs()
    with DATA_FILE.open("w", encoding="utf-8") as fh:
        json.dump(state, fh, ensure_ascii=False, indent=2)


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
    # Turn European decimals into dot decimals
    if raw.count(",") == 1 and raw.count(".") == 0:
        raw = raw.replace(",", ".")
    else:
        raw = raw.replace(",", "")
    try:
        return float(raw)
    except ValueError:
        return None


def extract_single(field, html):
    pattern = rf'<span class="field field-{re.escape(field)}[\s\S]*?<span class="value">([\s\S]*?)<\/span>'
    match = re.search(pattern, html, re.IGNORECASE)
    return clean(match.group(1)) if match else None


def parse_invoice(html_text):
    html = html_text or ""
    invoice = {
        "supplier_name": extract_single("RegisteredName", html),
        "supplier_vat": extract_single("Vat", html),
        "invoice_number": extract_single("IssuerFormatedInvoiceSeriesNumber", html),
        "invoice_date": extract_single("DateIssued", html),
        "currency": extract_single("CurrencyCode", html),
        "total_amount": parse_number(extract_single("TotalGrossValue", html)),
        "payment_method": extract_single("PaymentMethodType", html),
        "items": []
    }

    rows = re.findall(r"<tr>[\s\S]*?<\/tr>", html, re.IGNORECASE) or []
    for row in rows:
        desc = re.search(r"field-Description1[\s\S]*?<span class=\"value\">([\s\S]*?)<\/span>", row, re.IGNORECASE)
        qty = re.search(r"field-Quantity[\s\S]*?<span class=\"value\">([\s\S]*?)<\/span>", row, re.IGNORECASE)
        price = re.search(r"field-UnitPrice[\s\S]*?<span class=\"value\">([\s\S]*?)<\/span>", row, re.IGNORECASE)
        if desc and qty and price:
            quantity = parse_number(clean(qty.group(1)))
            unit_price = parse_number(clean(price.group(1)))
            item_total = None
            if quantity is not None and unit_price is not None:
                item_total = round(quantity * unit_price, 2)
            invoice["items"].append(
                {
                    "id": uuid.uuid4().hex[:10],
                    "description": clean(desc.group(1)),
                    "quantity": quantity,
                    "price": unit_price,
                    "total": item_total,
                    "participants": []
                }
            )
    if invoice["total_amount"] is None:
        running = sum((it.get("total") or 0) for it in invoice["items"])
        invoice["total_amount"] = round(running, 2)
    return invoice


def post_qr_for_data(file_bytes, filename="qr.png", timeout=10):
    """
    Call the QR decode API with the uploaded image and return the decoded string.
    Uses raw urllib to keep dependencies out.
    """
    boundary = f"----codex{uuid.uuid4().hex}"
    body = []
    # file part
    body.append(f"--{boundary}\r\n".encode("utf-8"))
    body.append(f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode("utf-8"))
    body.append(b"Content-Type: application/octet-stream\r\n\r\n")
    body.append(file_bytes)
    body.append(b"\r\n")
    # close
    body.append(f"--{boundary}--\r\n".encode("utf-8"))
    payload = b"".join(body)
    req = urllib.request.Request(
        QR_API,
        data=payload,
        method="POST",
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "User-Agent": "trip-splitter/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            debug(f"qr api status={getattr(resp, 'status', None)} len={len(raw) if raw else 0}")
    except urllib.error.HTTPError as e:
        body = e.read() if hasattr(e, "read") else b""
        debug(f"qr api HTTPError status={getattr(e, 'code', None)} reason={getattr(e, 'reason', None)} body={body[:200]!r}")
        raise
    except urllib.error.URLError as e:
        debug(f"qr api URLError {e}")
        raise
    decoded = json.loads(raw.decode("utf-8", errors="ignore"))
    # expected structure: [{ symbol: [{ data: "..." }]}]
    data = None
    if isinstance(decoded, list) and decoded:
        symbols = decoded[0].get("symbol") if isinstance(decoded[0], dict) else None
        if symbols and isinstance(symbols, list) and symbols:
            data = symbols[0].get("data")
    return data


def fetch_html(url, timeout=10):
    req = urllib.request.Request(url, headers={"User-Agent": "trip-splitter/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        charset = resp.headers.get_content_charset() or "utf-8"
        return resp.read().decode(charset, errors="ignore")


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


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - - [%s] %s\n" % (self.client_address[0], self.log_date_time_string(), fmt % args))

    # ------- helpers -------
    def send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b""
        if not raw:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    # ------- routing -------
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path == "/api/state":
            state = load_state()
            payload = {
                "people": state.get("people", []),
                "receipts": state.get("receipts", []),
                "summary": compute_summary(state)
            }
            return self.send_json(payload)
        if path.startswith("/uploads/"):
            return super().do_GET()
        if path == "/" or path == "":
            self.path = "/index.html"
            return super().do_GET()
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        path_clean = path.rstrip("/") or "/"
        if path_clean == "/api/people":
            return self.handle_add_person()
        if path_clean == "/api/receipts":
            return self.handle_add_receipt()
        if path_clean == "/api/qr/decode":
            return self.handle_qr_decode()
        if re.match(r"^/api/receipts/[^/]+/participants$", path_clean):
            return self.handle_update_participants(path_clean)
        if re.match(r"^/api/receipts/[^/]+/paid_by$", path_clean):
            return self.handle_update_paid_by(path_clean)
        if re.match(r"^/api/receipts/[^/]+/bulk$", path_clean):
            return self.handle_bulk_participants(path_clean)
        return self.send_json({"error": "Not found"}, status=404)

    # ------- handlers -------
    def handle_add_person(self):
        data = self.read_json()
        name = (data.get("name") or "").strip()
        if not name:
            return self.send_json({"error": "Name required"}, status=400)
        state = load_state()
        if name not in state["people"]:
            state["people"].append(name)
            save_state(state)
        return self.send_json({"ok": True, "people": state["people"]})

    def handle_add_receipt(self):
        ctype, _pdict = cgi.parse_header(self.headers.get("Content-Type", ""))
        file_bytes = None
        if ctype.startswith("multipart/"):
            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={
                    "REQUEST_METHOD": "POST",
                    "CONTENT_TYPE": self.headers.get("Content-Type"),
                    "CONTENT_LENGTH": self.headers.get("Content-Length", "0"),
                },
            )
            html_text = form.getvalue("html_text", "")
            paid_by = form.getvalue("paid_by", "")
            title = form.getvalue("title", "")
            html_file = form["html_file"] if "html_file" in form else None
            if html_file is not None and getattr(html_file, "file", None):
                file_bytes = html_file.file.read()
                if not html_text:
                    try:
                        html_text = file_bytes.decode("utf-8", errors="ignore")
                    except Exception:
                        html_text = ""
        else:
            data = self.read_json()
            html_text = data.get("html_text", "")
            paid_by = data.get("paid_by", "")
            title = data.get("title", "")
            html_file = None

        if isinstance(html_text, bytes):
            try:
                html_text = html_text.decode("utf-8", errors="ignore")
            except Exception:
                html_text = ""
        invoice = parse_invoice(html_text or "")
        receipt_id = uuid.uuid4().hex[:8]
        filename_saved = None
        if html_file is not None and getattr(html_file, "filename", None):
            filename_saved = f"receipt-{receipt_id}.html"
            with (UPLOAD_DIR / filename_saved).open("wb") as fh:
                if file_bytes is not None:
                    fh.write(file_bytes)
                else:
                    fh.write(html_file.file.read())

        state = load_state()
        receipt = {
            "id": receipt_id,
            "title": title.strip() or invoice.get("invoice_number") or f"Receipt {dt.date.today()}",
            "supplier": invoice.get("supplier_name"),
            "paid_by": paid_by or (state["people"][0] if state["people"] else None),
            "currency": invoice.get("currency") or "EUR",
            "total_amount": invoice.get("total_amount") or 0,
            "items": invoice.get("items", []),
            "payment_method": invoice.get("payment_method"),
            "raw_html_file": filename_saved,
            "created_at": dt.datetime.utcnow().isoformat() + "Z",
        }
        state["receipts"].append(receipt)
        save_state(state)
        return self.send_json({"ok": True, "receipt": receipt})

    def handle_qr_decode(self):
        ctype, _pdict = cgi.parse_header(self.headers.get("Content-Type", ""))
        debug(f"qr decode hit path={self.path} content-type={ctype}")
        if not ctype.startswith("multipart/"):
            debug("qr decode: bad content-type (not multipart)")
            return self.send_json({"error": "Upload an image file"}, status=400)
        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": self.headers.get("Content-Type"),
                "CONTENT_LENGTH": self.headers.get("Content-Length", "0"),
            },
        )
        if "file" not in form:
            debug("qr decode: no file field")
            return self.send_json({"error": "No file provided"}, status=400)
        file_field = form["file"]
        if not getattr(file_field, "file", None):
            debug("qr decode: invalid file field (no file)")
            return self.send_json({"error": "Invalid file"}, status=400)
        file_bytes = file_field.file.read()
        size_bytes = len(file_bytes) if file_bytes else 0
        debug(f"qr decode filename={getattr(file_field, 'filename', '')} bytes={size_bytes}")
        if not file_bytes:
            return self.send_json({"error": "Empty file"}, status=400)
        if size_bytes > 1_200_000:
            debug("qr decode: warning image over recommended 1MB, API may reject")
        decoded_url = None
        try:
            decoded_url = post_qr_for_data(file_bytes, filename=file_field.filename or "qr.png")
            debug(f"qr decoded data={decoded_url}")
        except urllib.error.URLError as e:
            debug(f"qr decode URLError {e}")
            return self.send_json({"error": f"QR decode failed: {e}"}, status=502)
        if not decoded_url:
            debug("qr decode: could not read QR code (empty data)")
            return self.send_json({"error": "Could not read QR code"}, status=422)
        html_text = None
        try:
            if decoded_url.startswith("http://") or decoded_url.startswith("https://"):
                html_text = fetch_html(decoded_url)
                debug(f"qr decode fetched html len={len(html_text) if html_text else 0}")
        except urllib.error.URLError:
            debug("qr decode fetch html URLError")
            html_text = None
        return self.send_json({"ok": True, "qr_data": decoded_url, "html_text": html_text})

    def handle_update_participants(self, path):
        parts = path.rstrip("/").split("/")
        receipt_id = parts[3]
        data = self.read_json()
        item_id = data.get("item_id")
        participants = data.get("participants") or []
        state = load_state()
        receipt = next((r for r in state["receipts"] if r["id"] == receipt_id), None)
        if not receipt:
            return self.send_json({"error": "Receipt not found"}, status=404)
        item = next((i for i in receipt.get("items", []) if i["id"] == item_id), None)
        if not item:
            return self.send_json({"error": "Item not found"}, status=404)
        # Filter out unknown names
        valid = [p for p in participants if p in state["people"]]
        item["participants"] = valid
        save_state(state)
        return self.send_json({"ok": True})

    def handle_update_paid_by(self, path):
        parts = path.rstrip("/").split("/")
        receipt_id = parts[3]
        data = self.read_json()
        paid_by = (data.get("paid_by") or "").strip()
        state = load_state()
        receipt = next((r for r in state["receipts"] if r["id"] == receipt_id), None)
        if not receipt:
            return self.send_json({"error": "Receipt not found"}, status=404)
        if paid_by and paid_by in state["people"]:
            receipt["paid_by"] = paid_by
            save_state(state)
        return self.send_json({"ok": True})

    def handle_bulk_participants(self, path):
        parts = path.rstrip("/").split("/")
        receipt_id = parts[3]
        data = self.read_json()
        mode = data.get("mode")
        state = load_state()
        receipt = next((r for r in state["receipts"] if r["id"] == receipt_id), None)
        if not receipt:
            return self.send_json({"error": "Receipt not found"}, status=404)
        if mode == "all":
            for item in receipt.get("items", []):
                item["participants"] = list(state["people"])
        elif mode == "none":
            for item in receipt.get("items", []):
                item["participants"] = []
        else:
            return self.send_json({"error": "Invalid mode"}, status=400)
        save_state(state)
        return self.send_json({"ok": True})


def run(port=8000):
    ensure_dirs()
    server = ThreadingHTTPServer(("0.0.0.0", port), AppHandler)
    print(f"Server ready on http://localhost:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
    finally:
        server.server_close()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8005"))
    run(port)
