import html as html_lib
import re
import uuid

from .state_service import clean, parse_number


def extract_single(field, html):
  pattern = rf'<span class="field field-{re.escape(field)}[\s\S]*?<span class="value">([\s\S]*?)<\/span>'
  match = re.search(pattern, html, re.IGNORECASE)
  return clean(match.group(1)) if match else None


def parse_invoice_mymarket(html_text):
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


def parse_invoice_entersoft(html_text):
  """Parser for Entersoft-hosted Sklavenitis invoices."""
  html = html_text or ""
  supplier_name = None
  supplier_vat = None
  invoice_number = None
  invoice_date = None
  payment_method = None
  total_amount = None
  items = []

  # Header fields
  supplier_block = re.search(r'id="Seller"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>', html, re.IGNORECASE)
  if supplier_block:
    supplier_text = clean(supplier_block.group(1))
    supplier_name = supplier_text

  vat_match = re.search(r'ΑΦΜ:\s*([A-Z0-9]+)', html, re.IGNORECASE)
  if vat_match:
    supplier_vat = vat_match.group(1)

  date_match = re.search(r'Ημερομηνία[:\s]*<\/div>\s*<div[^>]*>\s*([^<]+)', html, re.IGNORECASE)
  if date_match:
    invoice_date = clean(date_match.group(1))

  number_match = re.search(r'Αρ\.\s*Παραστατικού[:\s]*<\/div>\s*<div[^>]*>\s*([^<]+)', html, re.IGNORECASE)
  if number_match:
    invoice_number = clean(number_match.group(1))

  payment_match = re.search(r'Τρόπος\s+Πληρωμής[:\s]*<\/div>\s*<div[^>]*>\s*([^<]+)', html, re.IGNORECASE)
  if payment_match:
    payment_method = clean(payment_match.group(1))

  total_match = re.search(r'Συνολική\s+Αξία[:\s]*<\/div>\s*<div[^>]*>\s*([^<]+)', html, re.IGNORECASE)
  if total_match:
    total_amount = parse_number(total_match.group(1))

  # Items table
  items_section = re.search(r'id="Items"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>', html, re.IGNORECASE)
  if items_section:
    rows = re.findall(r"<tr[^>]*>([\s\S]*?)<\/tr>", items_section.group(1), re.IGNORECASE)
    for row in rows:
      cols = re.findall(r"<td[^>]*>([\s\S]*?)<\/td>", row, re.IGNORECASE)
      if len(cols) < 6:
        continue
      description = clean(cols[1])
      qty = parse_number(clean(cols[2]))
      unit_price = parse_number(clean(cols[3]))
      line_total = parse_number(clean(cols[5]))
      if description is None:
        continue
      items.append(
        {
          "id": uuid.uuid4().hex[:10],
          "description": description,
          "quantity": qty,
          "price": unit_price,
          "total": line_total,
          "participants": []
        }
      )

  if total_amount is None:
    running = sum((it.get("total") or 0) for it in items)
    total_amount = round(running, 2)

  return {
    "supplier_name": supplier_name,
    "supplier_vat": supplier_vat,
    "invoice_number": invoice_number,
    "invoice_date": invoice_date,
    "currency": "EUR",
    "total_amount": total_amount,
    "payment_method": payment_method,
    "items": items
  }


def extract_html_from_mhtml(raw_bytes):
  """
  Attempt to extract the first text/html part from an MHTML (multipart/related) blob.
  Returns HTML string or None.
  """
  from email import message_from_bytes, policy

  def _decode_part(part):
    payload = part.get_payload(decode=True)
    if payload is None:
      return None
    charset = part.get_content_charset() or "utf-8"
    try:
      return payload.decode(charset)
    except Exception:
      try:
        return payload.decode("utf-8", errors="ignore")
      except Exception:
        return None

  try:
    msg = message_from_bytes(raw_bytes, policy=policy.default)
  except Exception:
    return None

  best_html = None
  best_len = -1
  try:
    parts = list(msg.walk()) if msg.is_multipart() else [msg]
    for part in parts:
      if part.get_content_type() != "text/html":
        continue
      decoded = _decode_part(part)
      if decoded:
        dlen = len(decoded)
        if dlen > best_len:
          best_len = dlen
          best_html = decoded
    if best_html:
      return best_html
  except Exception:
    return None
  return best_html


def ensure_plain_html(html_input):
  """
  If input appears to be MHTML, try to extract the HTML part. Otherwise ensure string.
  """
  if html_input is None:
    return ""
  if isinstance(html_input, bytes):
    raw_bytes = html_input
    hint = raw_bytes[:2048].decode("utf-8", errors="ignore")
  else:
    hint = str(html_input)
    raw_bytes = hint.encode("utf-8", errors="ignore")
  looks_mhtml = "Content-Type: multipart/related" in hint[:2048] or "Snapshot-Content-Location:" in hint[:2048]
  if looks_mhtml:
    extracted = extract_html_from_mhtml(raw_bytes)
    if extracted:
      return extracted
  return hint


PARSERS = {
  "mymarket": parse_invoice_mymarket,
  "entersoft": parse_invoice_entersoft,
}


def detect_parser(html_text):
  html_lower = (html_text or "").lower()
  if "entersoft" in html_lower or "e-invoicing.gr" in html_lower or "sklavenitis" in html_lower:
    return "entersoft"
  if "field-registeredname" in html_lower or "field-totalgrossvalue" in html_lower:
    return "mymarket"
  return "mymarket"


def parse_invoice(html_text):
  html_clean = ensure_plain_html(html_text or "")
  parser_key = detect_parser(html_clean)
  parser_fn = PARSERS.get(parser_key, parse_invoice_mymarket)
  invoice = parser_fn(html_clean or "")
  invoice["parser"] = parser_key
  return invoice
