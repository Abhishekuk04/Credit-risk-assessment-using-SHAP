const form = document.getElementById("form");
const go = document.getElementById("go");
const el = id => document.getElementById(id);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

const presets = {
  low:  {person_age:35, person_income:85000, person_home_ownership:"MORTGAGE", person_emp_length:10,
         loan_intent:"HOMEIMPROVEMENT", loan_grade:"A", loan_amnt:8000, loan_int_rate:7.5,
         cb_person_default_on_file:"N", cb_person_cred_hist_length:12},
  high: {person_age:22, person_income:24000, person_home_ownership:"RENT", person_emp_length:0,
         loan_intent:"PERSONAL", loan_grade:"E", loan_amnt:12000, loan_int_rate:17.5,
         cb_person_default_on_file:"Y", cb_person_cred_hist_length:2}
};

/* ---------- money fields: accept 53430, 53,430, 6000, 6,00,000 ---------- */
const moneyInputs = [...form.querySelectorAll(".money")];

// "53,430" -> 53430 (NaN if empty/invalid)
function num(value) {
  const clean = String(value ?? "").replace(/[^0-9.]/g, "");
  return clean === "" ? NaN : parseFloat(clean);
}

// Show the number with Indian grouping (1,00,000) while keeping the cursor in place
function formatMoney(input) {
  const raw = input.value;
  const pos = input.selectionStart ?? raw.length;
  const digitsBefore = raw.slice(0, pos).replace(/[^0-9.]/g, "").length;

  let clean = raw.replace(/[^0-9.]/g, "");
  const parts = clean.split(".");
  clean = parts[0] + (parts.length > 1 ? "." + parts.slice(1).join("").slice(0, 2) : "");

  const [intPart, decPart] = clean.split(".");
  const formatted =
    (intPart ? Number(intPart).toLocaleString("en-IN", {maximumFractionDigits: 0}) : "") +
    (decPart !== undefined ? "." + decPart : "");
  input.value = formatted;

  if (document.activeElement === input) {
    let count = 0, np = 0;
    while (np < formatted.length && count < digitsBefore) {
      if (/[0-9.]/.test(formatted[np])) count++;
      np++;
    }
    input.setSelectionRange(np, np);
  }
}
moneyInputs.forEach(i => i.addEventListener("input", () => formatMoney(i)));

/* ---------- form helpers ---------- */
function fill(p) {
  for (const [k, v] of Object.entries(p)) {
    const f = form.elements[k];
    if (!f) continue;
    f.value = v;
  }
  moneyInputs.forEach(formatMoney);
  updateShare();
}

function loanShare() {
  const inc = num(form.person_income.value), amt = num(form.loan_amnt.value);
  return inc > 0 && amt >= 0 ? amt / inc : null;
}
function updateShare() {
  const s = loanShare();
  el("share").textContent = s === null ? "–" : (s * 100).toFixed(0) + "%";
}
form.addEventListener("input", updateShare);
document.querySelectorAll("[data-fill]").forEach(b =>
  b.addEventListener("click", () => fill(presets[b.dataset.fill])));

function setZones(t) {
  const cut = Math.max(0, Math.min(1, t)) * 100;
  el("arc-safe").style.strokeDasharray = `${cut} 100`;
  el("arc-risk").style.strokeDasharray = `0 ${cut} ${100 - cut} 100`;
}

function countTo(target) {
  const out = el("pct");
  if (reduced) { out.textContent = target.toFixed(1); return; }
  const start = performance.now(), dur = 1200;
  (function tick(now) {
    const k = Math.min(1, (now - start) / dur), ease = 1 - Math.pow(1 - k, 3);
    out.textContent = (target * ease).toFixed(1);
    if (k < 1) requestAnimationFrame(tick);
  })(start);
}

function showError(text) {
  const m = el("msg");
  m.textContent = text; m.classList.add("error");
}

function showResult(d) {
  const p = d.default_probability ?? d.defaul_probability;
  const t = d.threshold, high = d.default_prediction === 1;
  setZones(t);
  el("needle").style.transform = `rotate(${-90 + p * 180}deg)`;
  countTo(p * 100);
  const v = el("verdict");
  v.textContent = high ? "High risk" : "Low risk";
  v.className = "verdict " + (high ? "high" : "low");
  const m = el("msg");
  m.classList.remove("error");
  m.textContent = high
    ? `The estimated default chance is above the model's ${(t * 100).toFixed(1)}% cutoff. This application is flagged for review.`
    : `The estimated default chance is below the model's ${(t * 100).toFixed(1)}% cutoff. This application looks safe to approve.`;
}

form.addEventListener("submit", async e => {
  e.preventDefault();
  form.querySelectorAll("input").forEach(i => i.classList.add("touched"));
  if (!form.reportValidity()) return;

  const income = num(form.person_income.value);
  const amount = num(form.loan_amnt.value);
  if (!(income > 0)) return showError("Enter a yearly income above zero.");
  if (!(amount > 0)) return showError("Enter a loan amount above zero.");
  const share = amount / income;

  const fd = new FormData(form);
  const body = {
    person_age: parseInt(fd.get("person_age"), 10),
    person_income: income,
    person_home_ownership: fd.get("person_home_ownership"),
    person_emp_length: parseFloat(fd.get("person_emp_length")),
    loan_intent: fd.get("loan_intent"),
    loan_grade: fd.get("loan_grade"),
    loan_amnt: amount,
    loan_int_rate: parseFloat(fd.get("loan_int_rate")),
    loan_percent_income: Number(share.toFixed(2)),
    cb_person_default_on_file: fd.get("cb_person_default_on_file"),
    cb_person_cred_hist_length: parseInt(fd.get("cb_person_cred_hist_length"), 10)
  };

  go.disabled = true; go.textContent = "Checking…";
  try {
    const res = await fetch("/predict", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(body)
    });
    if (res.status === 422) {
      const err = (await res.json()).detail?.[0];
      return showError(`Check "${err?.loc?.slice(-1)[0] ?? "a field"}": ${err?.msg ?? "invalid value"}.`);
    }
    if (!res.ok) throw new Error(res.status);
    showResult(await res.json());
  } catch {
    showError("The model could not be reached. Check that the server is running, then try again.");
  } finally {
    go.disabled = false; go.textContent = "Check risk";
  }
});

updateShare();
