const state = {
  people: [],
  receipts: [],
  summary: [],
};

const peopleList = document.getElementById("peopleList");
const personForm = document.getElementById("personForm");
const personName = document.getElementById("personName");
const receiptsEl = document.getElementById("receipts");
const summaryList = document.getElementById("summaryList");
const qrForm = document.getElementById("qrForm");
const qrStatus = document.getElementById("qrStatus");
const qrPaidBy = document.getElementById("qrPaidBy");
const invoiceTitleInput = document.getElementById("invoiceTitle");
const notesInput = document.getElementById("invoiceNotes");
const MAX_UPLOAD_BYTES = 950 * 1024; // target under 1MB

async function loadState() {
  const res = await fetch("/api/state");
  const data = await res.json();
  state.people = data.people || [];
  state.receipts = data.receipts || [];
  state.summary = data.summary || [];
  renderPeople();
  renderPaidBySelect();
  renderSummary();
  renderReceipts();
}

function renderPeople() {
  peopleList.innerHTML = state.people.map((p) => `<span class="chip">${p}</span>`).join("");
}

function renderPaidBySelect() {
  const options = state.people.map((p) => `<option value="${p}">${p}</option>`).join("");
  if (qrPaidBy) {
    qrPaidBy.innerHTML = `<option value="">Paid by</option>` + options;
    if (!qrPaidBy.value && state.people.length) {
      qrPaidBy.value = state.people[0];
    }
  }
}

function renderSummary() {
  if (!state.summary.length) {
    summaryList.innerHTML = `<p class="muted">No balances yet.</p>`;
    return;
  }
  summaryList.innerHTML = state.summary
    .map((row) => {
      const netClass = row.net >= 0 ? "positive" : "negative";
      const netLabel = row.net >= 0 ? "should receive" : "owes";
      return `<div class="summary-row">
        <div class="name">${row.name}</div>
        <div class="muted small">Paid: EUR ${row.paid.toFixed(2)}</div>
        <div class="muted small">Joined: EUR ${row.consumed.toFixed(2)}</div>
        <div class="net ${netClass}">${netLabel} EUR ${Math.abs(row.net).toFixed(2)}</div>
      </div>`;
    })
    .join("");
}

function renderReceipts() {
  if (!state.receipts.length) {
    receiptsEl.innerHTML = `<p class="muted">No receipts yet. Add one above.</p>`;
    return;
  }

  receiptsEl.innerHTML = state.receipts
    .map((r) => {
      const items = r.items || [];
      const paidBy = r.paid_by || "";
      const total = r.total_amount ?? 0;
      const supplier = r.supplier ? `<span class="pill">${r.supplier}</span>` : "";
      const notes = r.notes ? `<p class="muted small" style="margin-top:6px;">${r.notes}</p>` : "";
      return `
      <article class="receipt-card" data-receipt="${r.id}">
        <div class="receipt-head">
          <div class="meta">
            <strong>${r.title || "Receipt"}</strong>
            <span class="muted small">${items.length} items - Total EUR ${total.toFixed(2)}</span>
            ${supplier}
          </div>
          <div class="muted small">Paid by
            <select class="paid-by" data-receipt="${r.id}">
              ${state.people
                .map((p) => `<option value="${p}" ${p === paidBy ? "selected" : ""}>${p}</option>`)
                .join("")}
            </select>
            <button class="btn ghost danger small" data-delete="${r.id}" title="Delete receipt">🗑</button>
          </div>
        </div>
        ${notes}
        <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
          <button class="btn ghost" data-bulk="all" data-receipt="${r.id}">Join all items for everyone</button>
          <button class="btn ghost" data-bulk="none" data-receipt="${r.id}">Clear selections</button>
        </div>
        <table class="items-table">
          <thead>
            <tr>
              <th style="width:35%">Item</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>People</th>
            </tr>
          </thead>
          <tbody>
            ${items
              .map((item) => {
                const badges = state.people
                  .map((p) => {
                    const checked = (item.participants || []).includes(p) ? "checked" : "";
                    return `<label><input type="checkbox" data-item="${item.id}" data-receipt="${r.id}" data-person="${p}" ${checked}> ${p}</label>`;
                  })
                  .join("");
                return `<tr>
                  <td>${item.description || "Item"}</td>
                  <td>${item.quantity ?? "-"}</td>
                  <td>EUR ${(item.price ?? 0).toFixed(2)}</td>
                  <td><div class="checkboxes">${badges}</div></td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </article>
      `;
    })
    .join("");

  receiptsEl.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => handleToggle(cb));
  });
  receiptsEl.querySelectorAll(".paid-by").forEach((sel) => {
    sel.addEventListener("change", () => handlePaidBy(sel));
  });
  receiptsEl.querySelectorAll("[data-bulk]").forEach((btn) => {
    btn.addEventListener("click", () => handleBulk(btn));
  });
  receiptsEl.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", () => handleDelete(btn.dataset.delete));
  });
}

async function handleToggle(cb) {
  const receiptId = cb.dataset.receipt;
  const itemId = cb.dataset.item;
  const itemCheckboxes = [...receiptsEl.querySelectorAll(`input[data-receipt="${receiptId}"][data-item="${itemId}"]`)];
  const participants = itemCheckboxes.filter((c) => c.checked).map((c) => c.dataset.person);
  await fetch(`/api/receipts/${receiptId}/participants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_id: itemId, participants }),
  });
  await loadState();
}

async function handlePaidBy(sel) {
  const receiptId = sel.dataset.receipt;
  const paid_by = sel.value;
  await fetch(`/api/receipts/${receiptId}/paid_by`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paid_by }),
  });
  await loadState();
}

async function handleBulk(btn) {
  const receiptId = btn.dataset.receipt;
  const mode = btn.dataset.bulk;
  await fetch(`/api/receipts/${receiptId}/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  await loadState();
}

personForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = personName.value.trim();
  if (!name) return;
  await fetch("/api/people", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  personName.value = "";
  await loadState();
});

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function resizeImageIfNeeded(file, maxBytes = MAX_UPLOAD_BYTES) {
  if (!file || file.size <= maxBytes) return file;
  try {
    const dataUrl = await readFileAsDataURL(file);
    const img = await loadImage(dataUrl);
    let scale = 1.0;
    const minDim = 800;
    const makeBlob = async (s, q) => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * s));
      canvas.height = Math.max(1, Math.round(img.height * s));
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", q));
    };

    let bestBlob = null;
    while (scale >= minDim / Math.max(img.width, img.height)) {
      for (let quality of [0.92, 0.85, 0.75, 0.65, 0.55]) {
        const blob = await makeBlob(scale, quality);
        if (blob && (!bestBlob || blob.size < bestBlob.size)) {
          bestBlob = blob;
        }
        if (blob && blob.size <= maxBytes) {
          const name = (file.name || "upload").replace(/\.(png|jpe?g|webp)$/i, "") + ".jpg";
          return new File([blob], name, { type: "image/jpeg" });
        }
      }
      scale = Math.max(scale - 0.15, minDim / Math.max(img.width, img.height));
    }
    if (bestBlob && bestBlob.size < file.size) {
      const name = (file.name || "upload").replace(/\.(png|jpe?g|webp)$/i, "") + ".jpg";
      return new File([bestBlob], name, { type: "image/jpeg" });
    }
  } catch (err) {
    console.warn("resize failed, using original file", err);
  }
  return file;
}

async function createReceiptFromHtml(htmlText, paidBy) {
  const formData = new FormData();
  formData.append("html_text", htmlText || "");
  if (paidBy) formData.append("paid_by", paidBy);
  if (invoiceTitleInput?.value) formData.append("title", invoiceTitleInput.value);
  if (notesInput?.value) formData.append("notes", notesInput.value);
  const res = await fetch("/api/receipts", {
    method: "POST",
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Could not add receipt.");
  }
  await loadState();
  return data.receipt;
}

async function handleDelete(receiptId) {
  await fetch(`/api/receipts/${receiptId}`, { method: "DELETE" });
  await loadState();
}

if (qrForm) {
  qrForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fileInput = document.getElementById("qrFile");
    const file = fileInput?.files?.[0];
    if (!file) {
      qrStatus.textContent = "Please choose a receipt image first.";
      qrStatus.style.color = "#f28b82";
      return;
    }
    qrStatus.textContent = "Preparing image...";
    qrStatus.style.color = "";
    try {
      const resized = await resizeImageIfNeeded(file);
      const formData = new FormData();
      formData.append("file", resized, resized.name || file.name || "receipt.jpg");
      if (qrPaidBy) formData.append("paid_by", qrPaidBy.value);

      if (resized.size < file.size) {
        const kb = Math.round(resized.size / 1024);
        qrStatus.textContent = `Uploading compressed image (~${kb} KB)...`;
      } else {
        qrStatus.textContent = "Uploading receipt image...";
      }

      const res = await fetch("/api/qr/decode", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to decode QR");
      }
      const parts = [];
      if (data.qr_data) parts.push(`QR: ${data.qr_data}`);
      if (!data.html_text) throw new Error("No HTML returned from QR decode.");

      const paidBy = qrPaidBy ? qrPaidBy.value : "";
      qrStatus.textContent = "Parsing and saving receipt...";
      const receipt = await createReceiptFromHtml(data.html_text, paidBy);
      parts.push(`Receipt saved (${receipt.title || "Receipt"})`);
      if (invoiceTitleInput) invoiceTitleInput.value = "";
      if (notesInput) notesInput.value = "";
      if (fileInput) fileInput.value = "";
      qrStatus.textContent = parts.join(" ");
    } catch (err) {
      qrStatus.textContent = err.message || "QR decode failed";
      qrStatus.style.color = "#f28b82";
    }
  });
}

loadState();
