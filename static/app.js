const state = {
  people: [],
  receipts: [],
  summary: [],
  currentUser: null,
  verbose: false,
};

const CURRENT_USER_KEY = "trip-splitter:current-user";
const VERBOSE_KEY = "trip-splitter:verbose";

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
const currentUserLabel = document.getElementById("currentUserLabel");
const switchUserBtn = document.getElementById("switchUserBtn");
const userOverlay = document.getElementById("userOverlay");
const overlayPeople = document.getElementById("overlayPeople");
const overlayAddForm = document.getElementById("overlayAddForm");
const overlayNewPerson = document.getElementById("overlayNewPerson");
const overlayClose = document.getElementById("overlayClose");
const MAX_UPLOAD_BYTES = 950 * 1024; // target under 1MB

async function loadState() {
  const res = await fetch("/api/state");
  const data = await res.json();
  state.people = data.people || [];
  state.receipts = data.receipts || [];
  state.summary = data.summary || [];
  syncVerbose();
  syncCurrentUser();
  renderPeople();
  renderPaidBySelect();
  renderSummary();
  renderReceipts();
  renderOverlayPeople();
}

function syncCurrentUser() {
  if (!state.currentUser) {
    const stored = localStorage.getItem(CURRENT_USER_KEY);
    if (stored) {
      state.currentUser = stored;
    }
  }
  if (state.currentUser && !state.people.includes(state.currentUser)) {
    state.currentUser = null;
    localStorage.removeItem(CURRENT_USER_KEY);
  }
  renderCurrentUserLabel();
  if (!state.currentUser) {
    openUserOverlay();
  } else {
    closeUserOverlay();
  }
}

function syncVerbose() {
  state.verbose = localStorage.getItem(VERBOSE_KEY) === "1";
}

function renderCurrentUserLabel() {
  if (!currentUserLabel) return;
  currentUserLabel.textContent = state.currentUser ? state.currentUser : "Select yourself";
  if (switchUserBtn) {
    switchUserBtn.textContent = state.currentUser ? "Switch user" : "Choose user";
  }
}

function renderPeople() {
  const current = state.currentUser;
  if (!current) {
    peopleList.innerHTML = `<span class="muted small">Select who you are to start joining items.</span>`;
    return;
  }
  peopleList.innerHTML = `
    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
      <span class="chip">You: ${current}</span>
      <span class="muted small">Other participants hidden (only you can join/leave items)</span>
    </div>
  `;
}

function renderOverlayPeople() {
  if (!overlayPeople) return;
  if (!state.people.length) {
    overlayPeople.innerHTML = `<span class="muted small">No people yet. Add yourself below.</span>`;
    return;
  }
  overlayPeople.innerHTML = state.people
    .map(
      (p) =>
        `<button type="button" data-person="${p}" class="${state.currentUser === p ? "active" : ""}">${p}</button>`
    )
    .join("");
  overlayPeople.querySelectorAll("button[data-person]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setCurrentUser(btn.dataset.person);
    });
  });
  renderCurrentUserLabel();
}

function openUserOverlay() {
  if (!userOverlay) return;
  renderOverlayPeople();
  userOverlay.classList.remove("hidden");
  setTimeout(() => overlayNewPerson?.focus(), 120);
}

function closeUserOverlay() {
  if (!userOverlay) return;
  userOverlay.classList.add("hidden");
}

async function addPerson(name, setAsCurrent = false) {
  const cleaned = (name || "").trim();
  if (!cleaned) return;
  await fetch("/api/people", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: cleaned }),
  });
  if (setAsCurrent) {
    state.currentUser = cleaned;
    localStorage.setItem(CURRENT_USER_KEY, cleaned);
  }
  await loadState();
  if (setAsCurrent) {
    closeUserOverlay();
  }
}

function setCurrentUser(name) {
  const cleaned = (name || "").trim();
  if (!cleaned) return;
  if (!state.people.includes(cleaned)) return;
  state.currentUser = cleaned;
  localStorage.setItem(CURRENT_USER_KEY, cleaned);
  renderCurrentUserLabel();
  renderPaidBySelect();
  renderReceipts();
  closeUserOverlay();
}

function renderPaidBySelect() {
  const options = state.people.map((p) => `<option value="${p}">${p}</option>`).join("");
  if (qrPaidBy) {
    qrPaidBy.innerHTML = `<option value="">Paid by</option>` + options;
    const preferred = state.currentUser && state.people.includes(state.currentUser) ? state.currentUser : state.people[0];
    if (preferred) qrPaidBy.value = preferred;
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
  const toolbar = `
    <div class="receipts-toolbar">
      <label class="switch">
        <input type="checkbox" id="verboseToggle" ${state.verbose ? "checked" : ""} />
        <span class="slider" aria-hidden="true"></span>
        <span class="label">Show verbose</span>
      </label>
    </div>
  `;

  if (!state.receipts.length) {
    receiptsEl.innerHTML = toolbar + `<p class="muted">No receipts yet. Add one above.</p>`;
    wireVerboseToggle();
    return;
  }

  receiptsEl.innerHTML = toolbar + state.receipts
    .map((r) => {
      const items = r.items || [];
      const paidBy = r.paid_by || "";
      const total = r.total_amount ?? 0;
      const supplier = r.supplier ? `<span class="pill">${r.supplier}</span>` : "";
      const notes = r.notes ? `<p class="muted small" style="margin-top:6px;">${r.notes}</p>` : "";
      return `
      <article class="receipt-card ${state.verbose ? "show-verbose" : ""}" data-receipt="${r.id}">
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
          <button class="btn ghost" data-join-me="${r.id}">Join all items (me)</button>
          <button class="btn ghost" data-bulk="all" data-receipt="${r.id}">Join all items for everyone</button>
          <button class="btn ghost" data-bulk="none" data-receipt="${r.id}">Clear selections</button>
        </div>
        <table class="items-table">
          <thead>
            <tr>
              <th class="mobile-join">Add</th>
              <th style="width:35%">Item</th>
              <th class="qty-col">Qty</th>
              <th class="unit-col">Unit</th>
              <th class="people-col">People</th>
            </tr>
          </thead>
          <tbody>
            ${items
              .map((item) => {
                const participants = item.participants || [];
                const joined = state.currentUser && participants.includes(state.currentUser);
                const chips = participants.length
                  ? `<div class="participant-list">${participants
                      .map((p) => `<span class="chip ${p === state.currentUser ? "me" : ""}">${p}</span>`)
                      .join("")}</div>`
                  : `<span class="muted small">No one yet</span>`;
                const joinButton = state.currentUser
                  ? `<button class="btn small ${joined ? "primary" : "ghost"}" data-join data-receipt="${r.id}" data-item="${item.id}">
                        ${joined ? "Joined — Leave" : "Join this item"}
                     </button>`
                  : `<span class="muted small">Pick who you are to join</span>`;
                return `<tr>
                  <td class="mobile-join">
                    <input type="checkbox" data-join-checkbox data-joined="${joined ? "1" : "0"}" data-receipt="${r.id}" data-item="${item.id}" ${
                      joined ? "checked" : ""
                    } aria-label="Join ${item.description || "item"}">
                  </td>
                  <td>${item.description || "Item"}</td>
                  <td class="qty-col">${item.quantity ?? "-"}</td>
                  <td class="unit-col">EUR ${(item.price ?? 0).toFixed(2)}</td>
                  <td class="people-col">
                    <div class="join-actions">
                      ${chips}
                      ${joinButton}
                    </div>
                  </td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </article>
      `;
    })
    .join("");

  receiptsEl.querySelectorAll(".paid-by").forEach((sel) => {
    sel.addEventListener("change", () => handlePaidBy(sel));
  });
  receiptsEl.querySelectorAll("[data-bulk]").forEach((btn) => {
    btn.addEventListener("click", () => handleBulk(btn));
  });
  receiptsEl.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", () => handleDelete(btn.dataset.delete));
  });
  receiptsEl.querySelectorAll("[data-join-me]").forEach((btn) => {
    btn.addEventListener("click", () => handleJoinMe(btn.dataset.joinMe));
  });
  receiptsEl.querySelectorAll("[data-join]").forEach((btn) => {
    btn.addEventListener("click", () => handleJoin(btn));
  });
  receiptsEl.querySelectorAll("[data-join-checkbox]").forEach((input) => {
    input.addEventListener("change", () => handleJoinCheckbox(input));
  });
  wireVerboseToggle();
}

async function toggleParticipation(receiptId, itemId, forceJoin) {
  if (!state.currentUser) {
    openUserOverlay();
    return false;
  }
  const receipt = state.receipts.find((r) => r.id === receiptId);
  const item = receipt?.items?.find((it) => it.id === itemId);
  if (!item) return false;
  let participants = Array.isArray(item.participants) ? [...item.participants] : [];
  const alreadyIn = participants.includes(state.currentUser);
  const shouldJoin = typeof forceJoin === "boolean" ? forceJoin : !alreadyIn;
  if (shouldJoin && !alreadyIn) {
    participants.push(state.currentUser);
  } else if (!shouldJoin && alreadyIn) {
    participants = participants.filter((p) => p !== state.currentUser);
  }
  await fetch(`/api/receipts/${receiptId}/participants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_id: itemId, participants }),
  });
  await loadState();
  return true;
}

async function handleJoin(btn) {
  await toggleParticipation(btn.dataset.receipt, btn.dataset.item);
}

async function handleJoinCheckbox(input) {
  const prevJoined = input.dataset.joined === "1";
  const receiptId = input.dataset.receipt;
  const itemId = input.dataset.item;
  const ok = await toggleParticipation(receiptId, itemId, input.checked);
  if (!ok) {
    input.checked = prevJoined;
  }
}

async function handleJoinMe(receiptId) {
  if (!state.currentUser) {
    openUserOverlay();
    return;
  }
  const receipt = state.receipts.find((r) => r.id === receiptId);
  if (!receipt || !receipt.items?.length) return;
  const promises = receipt.items.map((item) => {
    const participants = Array.isArray(item.participants) ? [...item.participants] : [];
    if (!participants.includes(state.currentUser)) {
      participants.push(state.currentUser);
    }
    return fetch(`/api/receipts/${receiptId}/participants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_id: item.id, participants }),
    });
  });
  await Promise.all(promises);
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

function wireVerboseToggle() {
  const verboseToggle = document.getElementById("verboseToggle");
  if (!verboseToggle) return;
  verboseToggle.addEventListener("change", () => handleVerboseToggle(verboseToggle), { once: true });
}

function handleVerboseToggle(input) {
  state.verbose = !!input.checked;
  localStorage.setItem(VERBOSE_KEY, state.verbose ? "1" : "0");
  renderReceipts();
}

personForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = personName.value.trim();
  if (!name) return;
  await addPerson(name, false);
  personName.value = "";
  await loadState();
});

if (switchUserBtn) {
  switchUserBtn.addEventListener("click", () => openUserOverlay());
}

if (overlayClose) {
  overlayClose.addEventListener("click", () => closeUserOverlay());
}

if (userOverlay) {
  userOverlay.addEventListener("click", (e) => {
    if (e.target === userOverlay && state.currentUser) {
      closeUserOverlay();
    }
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !userOverlay.classList.contains("hidden")) {
      if (state.currentUser) closeUserOverlay();
    }
  });
}

if (overlayAddForm) {
  overlayAddForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = overlayNewPerson.value.trim();
    if (!name) return;
    await addPerson(name, true);
    overlayNewPerson.value = "";
  });
}

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
    if (!state.currentUser) {
      qrStatus.textContent = "Pick who you are first.";
      qrStatus.style.color = "#f28b82";
      openUserOverlay();
      return;
    }
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
      const paidByValue = (qrPaidBy?.value || state.currentUser || "").trim();
      if (qrPaidBy) qrPaidBy.value = paidByValue;
      formData.append("paid_by", paidByValue);

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

      const paidBy = qrPaidBy ? qrPaidBy.value : paidByValue;
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
