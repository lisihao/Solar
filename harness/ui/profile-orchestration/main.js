/* Profile Orchestration Dashboard — S04 main.js */
(function () {
  "use strict";

  const API_BASE = localStorage.getItem("PROFILE_API_BASE") || "/api/profile";
  const loaded = {};

  function esc(v) {
    return String(v == null || v === "" ? "N/A" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function short(v, n) {
    const t = String(v || "N/A");
    return t.length > n ? t.slice(0, n - 1) + "…" : t;
  }

  function badge(s) {
    return `<span class="badge ${esc(String(s || "pending").toLowerCase())}">${esc(s || "pending")}</span>`;
  }

  function scoreBar(v) {
    const pct = Math.min(100, Math.round((parseFloat(v) || 0) * 100));
    return `<span class="score-bar"><span class="score-bar-fill" style="width:${pct}%"></span></span> ${esc(v)}`;
  }

  function setFooter(id, route, updatedAt) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<strong>Source:</strong> ${esc(route)} · <strong>Updated:</strong> ${esc(updatedAt || "N/A")}`;
  }

  function showBanner(id, msg, type) {
    const el = document.getElementById(id);
    if (!el) return;
    if (msg) { el.textContent = msg; el.className = `banner ${type || ""}`; el.style.display = ""; }
    else el.style.display = "none";
  }

  async function apiFetch(path) {
    const r = await fetch(`${API_BASE}${path}`, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  // ── Registry ────────────────────────────────────────────────────────────────

  async function loadRegistry() {
    const route = `${API_BASE}/registry`;
    try {
      const d = await apiFetch("/registry");
      showBanner("registry-banner", d.available === false ? `S03 lib unavailable: ${d.reason || ""}` : null, "");
      const profiles = d.profiles || [];
      document.getElementById("registry-content").innerHTML = profiles.length ? `
        <table>
          <thead><tr><th>ID</th><th>Version</th><th>Digest</th><th>Status</th><th>Created</th></tr></thead>
          <tbody>${profiles.map(p => `<tr>
            <td><code>${esc(short(p.id, 32))}</code></td>
            <td>${esc(p.version)}</td>
            <td><code>${esc(short(p.digest, 16))}</code></td>
            <td>${badge(p.active ? "active" : p.status)}</td>
            <td>${esc(p.created_at)}</td>
          </tr>`).join("")}</tbody>
        </table>` : `<div style="color:#6e7681;padding:20px">No profiles in registry.</div>`;
      setFooter("registry-footer", route, d.generated_at);
    } catch (e) {
      document.getElementById("registry-content").innerHTML = `<div class="error-text">Failed: ${esc(e.message)}</div>`;
    }
  }

  // ── Pareto ─────────────────────────────────────────────────────────────────

  async function loadPareto() {
    const route = `${API_BASE}/pareto`;
    try {
      const d = await apiFetch("/pareto");
      showBanner("pareto-banner", d.available === false ? `Pareto data unavailable: ${d.reason || ""}` : null, "");
      const candidates = d.candidates || [];
      document.getElementById("pareto-content").innerHTML = candidates.length ? `
        <table>
          <thead><tr><th>Candidate ID</th><th>Profile</th><th>Scores</th><th>Hard Fail</th></tr></thead>
          <tbody>${candidates.map(c => {
            const scores = c.scores || {};
            const scoreStr = Object.entries(scores).map(([k, v]) => `${esc(k)}: ${scoreBar(v)}`).join("<br>");
            return `<tr>
              <td><code>${esc(short(c.candidate_id, 24))}</code></td>
              <td><code>${esc(short(c.profile_id, 24))}</code></td>
              <td>${scoreStr || "N/A"}</td>
              <td>${c.hard_fail ? '<span class="badge failed">hard fail</span>' : '<span class="badge active">ok</span>'}</td>
            </tr>`;
          }).join("")}</tbody>
        </table>` : `<div style="color:#6e7681;padding:20px">No Pareto candidates (S03 optimizer not yet run).</div>`;
      setFooter("pareto-footer", route, d.generated_at);
    } catch (e) {
      document.getElementById("pareto-content").innerHTML = `<div class="error-text">Failed: ${esc(e.message)}</div>`;
    }
  }

  // ── Governance ──────────────────────────────────────────────────────────────

  async function loadGovernance() {
    const route = `${API_BASE}/governance/events`;
    try {
      const d = await apiFetch("/governance/events?limit=50");
      showBanner("governance-banner", d.available === false ? `Governance events unavailable: ${d.reason || ""}` : null, "");
      const events = d.events || [];
      document.getElementById("governance-content").innerHTML = events.length ? `
        <table>
          <thead><tr><th>Time</th><th>Type</th><th>Profile / Sprint</th><th>Actor</th><th>Reason</th></tr></thead>
          <tbody>${events.map(ev => `<tr>
            <td style="white-space:nowrap;font-size:11px;">${esc(ev.ts || ev.collected_at || "")}</td>
            <td><span class="chip">${esc(ev.signal_type || ev.type || "N/A")}</span></td>
            <td><code>${esc(short(ev.profile_id || ev.sprint_id || ev.dispatch_id || "", 32))}</code></td>
            <td>${esc(ev.actor || ev.source || "N/A")}</td>
            <td>${esc(short(ev.reason || ev.kind || "", 64))}</td>
          </tr>`).join("")}</tbody>
        </table>` : `<div style="color:#6e7681;padding:20px">No governance events yet.</div>`;
      setFooter("governance-footer", route, d.generated_at);
    } catch (e) {
      document.getElementById("governance-content").innerHTML = `<div class="error-text">Failed: ${esc(e.message)}</div>`;
    }
  }

  // ── Capability ──────────────────────────────────────────────────────────────

  async function loadCapability() {
    const route = `${API_BASE}/capability-usage`;
    try {
      const d = await apiFetch("/capability-usage");
      showBanner("capability-banner", d.available === false ? `Capability data unavailable: ${d.reason || ""}` : null, "info");
      const usage = d.usage || [];
      document.getElementById("capability-content").innerHTML = usage.length ? `
        <table>
          <thead><tr><th>Capability</th><th>Sprint</th><th>Node</th><th>Source</th></tr></thead>
          <tbody>${usage.map(u => `<tr>
            <td><span class="chip">${esc(u.capability)}</span></td>
            <td><code>${esc(short(u.sprint_id || "", 40))}</code></td>
            <td>${esc(u.node_id || "N/A")}</td>
            <td>${esc(u.source || "N/A")}</td>
          </tr>`).join("")}</tbody>
        </table>` : `<div style="color:#6e7681;padding:20px">No capability usage data.</div>`;
      setFooter("capability-footer", route, d.generated_at);
    } catch (e) {
      document.getElementById("capability-content").innerHTML = `<div class="error-text">Failed: ${esc(e.message)}</div>`;
    }
  }

  // ── Blocked ─────────────────────────────────────────────────────────────────

  async function loadBlocked() {
    const route = `${API_BASE}/blocked-reasons`;
    try {
      const d = await apiFetch("/blocked-reasons");
      showBanner("blocked-banner", d.available === false ? `Blocked data unavailable: ${d.reason || ""}` : null, "");
      const blocked = d.blocked || [];
      document.getElementById("blocked-content").innerHTML = blocked.length ? `
        <table>
          <thead><tr><th>Sprint/Node</th><th>Blocked By</th><th>Reason</th><th>Since</th></tr></thead>
          <tbody>${blocked.map(b => `<tr>
            <td><code>${esc(short(b.sprint_id || "", 32))}</code><br><span style="color:#6e7681">${esc(b.node_id || "")}</span></td>
            <td>${esc(short(b.blocked_by || "", 40))}</td>
            <td>${esc(short(b.reason || "", 80))}</td>
            <td style="font-size:11px;">${esc(b.since || "N/A")}</td>
          </tr>`).join("")}</tbody>
        </table>` : `<div style="color:#56d364;padding:20px">✓ No blocked items.</div>`;
      setFooter("blocked-footer", route, d.generated_at);
    } catch (e) {
      document.getElementById("blocked-content").innerHTML = `<div class="error-text">Failed: ${esc(e.message)}</div>`;
    }
  }

  // ── Tab routing ─────────────────────────────────────────────────────────────

  const LOADERS = { registry: loadRegistry, pareto: loadPareto, governance: loadGovernance, capability: loadCapability, blocked: loadBlocked };

  window.loadTab = function (tab) {
    loaded[tab] = false;
    activateTab(tab);
  };

  function activateTab(tab) {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.id === `panel-${tab}`));
    if (!loaded[tab]) {
      loaded[tab] = true;
      LOADERS[tab]();
    }
  }

  document.querySelectorAll(".tab-btn").forEach(b => {
    b.addEventListener("click", () => activateTab(b.dataset.tab));
  });

  // ── Boot ────────────────────────────────────────────────────────────────────

  document.getElementById("last-refresh").textContent = "Loaded: " + new Date().toLocaleTimeString();
  activateTab("registry");

})();
