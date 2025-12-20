const state = {
  people: [],
  receipts: [],
  summary: [],
};

const peopleList = document.getElementById("peopleList");
const personForm = document.getElementById("personForm");
const personName = document.getElementById("personName");
const receiptForm = document.getElementById("receiptForm");
const paidBySelect = document.getElementById("paidBySelect");
const receiptsEl = document.getElementById("receipts");
const summaryList = document.getElementById("summaryList");
const qrForm = document.getElementById("qrForm");
const qrStatus = document.getElementById("qrStatus");
const htmlTextArea = document.querySelector('textarea[name="html_text"]');
const qrPaidBy = document.getElementById("qrPaidBy");

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
  if (paidBySelect) paidBySelect.innerHTML = options;
  if (qrPaidBy) qrPaidBy.innerHTML = `<option value="">Paid by</option>` + options;
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
      return `
      <article class="receipt-card" data-receipt="${r.id}">
        <div class="receipt-head">
          <div class="meta">
            <strong>${r.title || "Receipt"}</strong>
            <span class="muted small">${items.length} items · Total EUR ${total.toFixed(2)}</span>
            ${supplier}
          </div>
          <div class="muted small">Paid by
            <select class="paid-by" data-receipt="${r.id}">
              ${state.people
                .map((p) => `<option value="${p}" ${p === paidBy ? "selected" : ""}>${p}</option>`)
                .join("")}
            </select>
          </div>
        </div>
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

receiptForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const formData = new FormData(receiptForm);
  const res = await fetch("/api/receipts", {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    alert("Could not add receipt. Please check your HTML input.");
    return;
  }
  receiptForm.reset();
  await loadState();
});

if (qrForm) {
  qrForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(qrForm);
    qrStatus.textContent = "Decoding QR...";
    qrStatus.style.color = "";
    try {
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
      if (data.html_text) {
        htmlTextArea.value = data.html_text;
        parts.push("HTML fetched and loaded below.");
        if (qrPaidBy && paidBySelect) {
          const selected = qrPaidBy.value || paidBySelect.value;
          if (selected) paidBySelect.value = selected;
        }
      } else {
        parts.push("No HTML fetched, but QR decoded.");
      }
      qrStatus.textContent = parts.join(" ");
    } catch (err) {
      qrStatus.textContent = err.message || "QR decode failed";
      qrStatus.style.color = "#f28b82";
    }
  });
}

loadState();
