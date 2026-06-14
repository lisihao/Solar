/* Solar orchestration Hero dashboard */
(function () {
  "use strict";

  const BASE = "/orchestration";
  const state = { sprintId: new URLSearchParams(location.search).get("sprint_id") || "" };
  const LEASE_STATE_BRANCHES = [
    ["READY", "READY"],
    ["LEASED", "LEASED"],
    ["RUNNING", "RUNNING"],
    ["FINALIZING", "FINALIZING"],
    ["STALE", "STALE"],
    ["CRASHED", "CRASHED"],
    ["QUOTA", "QUOTA_BLOCKED"],
    ["AUTH", "AUTH_BLOCKED"],
    ["POLICY", "POLICY_BLOCKED"],
    ["HUMAN", "HUMAN_REQUIRED"],
  ];

  function esc(value) {
    return String(value == null || value === "" ? "N/A" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function shortText(value, max) {
    const text = String(value || "N/A");
    return text.length > max ? `${text.slice(0, max - 1)}...` : text;
  }

  async function fetchDashboard() {
    const query = state.sprintId ? `?sprint_id=${encodeURIComponent(state.sprintId)}` : "";
    const response = await fetch(`${BASE}/dashboard${query}`, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function badge(status) {
    const normalized = String(status || "pending").toLowerCase();
    return `<span class="badge ${esc(normalized)}">${esc(normalized)}</span>`;
  }

  function renderList(values, emptyText = "N/A") {
    const list = (values || []).filter((x) => String(x).trim() !== "");
    return list.length ? list.map((v) => esc(shortText(v, 42))).join(", ") : emptyText;
  }

  function reasonKind(rawKind) {
    const kind = String(rawKind || "").toLowerCase();
    if (kind === "dependency" || kind === "node_dependency") return "upstream";
    if (kind === "capability") return "capability_mismatch";
    if (kind === "spec_missing" || kind === "state_missing" || kind === "task_graph") return "gate_pending";
    return kind;
  }

  function renderSelect(data) {
    const select = document.getElementById("sprint-select");
    const options = data.active_sprints || [];
    if (!options.includes(data.focus_sprint_id) && data.focus_sprint_id) options.unshift(data.focus_sprint_id);
    select.innerHTML = options.length
      ? options.map((sid) => `<option value="${esc(sid)}"${sid === data.focus_sprint_id ? " selected" : ""}>${esc(shortText(sid, 96))}</option>`).join("")
      : '<option value="">N/A</option>';
    select.onchange = () => {
      state.sprintId = select.value;
      const next = state.sprintId ? `?sprint_id=${encodeURIComponent(state.sprintId)}` : location.pathname;
      history.replaceState(null, "", next);
      refresh();
    };
  }

  function renderHero(data) {
    const progress = data.progress || {};
    const resources = data.resources || {};
    document.getElementById("hero-subtitle").textContent =
      `${data.title || "N/A"} · ${data.epic_id || "N/A"} · ${data.focus_sprint_id || "N/A"} · status=${data.sprint_status || "N/A"} · phase=${data.phase || "N/A"}`;
    document.getElementById("metric-nodes").textContent = progress.total_nodes ?? "N/A";
    document.getElementById("metric-passed").textContent = progress.passed_nodes ?? "N/A";
    document.getElementById("metric-blocked").textContent = progress.blocked_nodes ?? "N/A";
    document.getElementById("metric-cost").textContent = resources.estimated_total_cost ?? "N/A";
  }

  function sourceChip(child) {
    const lineage = child.source_lineage || child._source_lineage;
    if (!lineage || !lineage.is_antigravity_desktop) return "";
    const conv = lineage.conversation_id ? `conv:${esc(lineage.conversation_id)}` : "";
    const proj = lineage.project_id ? `proj:${esc(lineage.project_id)}` : "";
    const tags = [conv, proj].filter(Boolean).join(" ");
    return ` <span class="chip source-antigravity">antigravity-app</span>${tags ? " <span class=\"muted\">" + tags + "</span>" : ""}`;
  }

  function renderEpicChildren(data) {
    const children = data.child_sprints || [];
    const summary = data.child_sprint_gate_summary || {};
    const blocked = (data.blocked_reasons || []).filter(Boolean);
    const lineageMap = data.per_child_source_lineage || {};
    document.getElementById("epic-child-count").textContent = `${children.length} child sprints · blocked=${summary.blocked ?? "N/A"}`;
    const container = document.getElementById("epic-child-list");
    const childRows = children.length ? children.map((item) => {
      const blockedBy = renderList(item.blocked_by);
      const readyNodes = renderList(item.ready_nodes);
      const blockedNodes = renderList((item.blocked_nodes || (item.blocked_nodes_with_reason || []).map((i) => i.node)));
      const blockedReason = renderList(item.blocked_reason, "N/A");
      const requiredCaps = renderList(item.required_capabilities, "N/A");
      const missingCaps = renderList(item.missing_capabilities, "N/A");
      const lin = lineageMap[item.sprint_id];
      if (lin) item._source_lineage = lin;
      const srcChip = sourceChip(item);
      return `<section class="stack-row">
        <div>
          <strong>${esc(item.sprint_id || "N/A")}${srcChip}</strong>
          <div class="muted">${esc(item.phase || "N/A")} · ${esc(item.priority || "N/A")}</div>
          <div class="muted">status: ${esc(item.status || "N/A")} · blocked_by: ${esc(blockedBy)}</div>
          <div class="muted">required caps: ${esc(requiredCaps)} · missing caps: ${esc(missingCaps)}</div>
          <div class="muted">ready nodes: ${esc(readyNodes)} · blocked nodes: ${esc(blockedNodes)}</div>
          <div class="muted">blocked reason: ${esc(blockedReason)}</div>
        </div>
        <span>${esc(item.status || "N/A")}</span>
      </section>`;
    }).join("") : '<div class="muted">No child sprints linked.</div>';

    const blockSummary = blocked.length
      ? `<section class="diagnostic warn"><h3>Blocked reasons</h3><ol>${blocked.map((reason) => `<li>${esc(reason)}</li>`).join("")}</ol></section>`
      : "";
    container.innerHTML = `${childRows}${blockSummary}`;
  }

  function renderDag(data) {
    const dag = data.dag || {};
    const nodes = dag.nodes || [];
    const blockedMap = Object.fromEntries((data.progress && data.progress.blocked_nodes_with_reason || []).map((item) => [item.node, item.reason]));
    document.getElementById("gate-summary").textContent = (dag.required_gates || []).join(" / ") || "N/A";
    document.getElementById("dag-flow").innerHTML = nodes.length ? nodes.map((node) => {
      const caps = (node.required_capabilities || []).map((cap) => `<span class="chip">${esc(cap)}</span>`).join("");
      const missing = (node.missing_capabilities || []).map((cap) => `<span class="chip">${esc(cap)}</span>`).join("");
      const deps = (node.depends_on || []).join(", ") || "ROOT";
      const ready = node.hit === undefined ? "N/A" : (node.hit ? "hit" : "miss");
      const blockedReason = blockedMap[node.id] || "N/A";

      // O3: actor runtime spine fields
      const dispatchPath = node.dispatch_path || "";
      const selectedActor = node.selected_actor || "";
      const logicalOp = node.logical_operator || "";
      const hostType = node.host_type || "";
      const compatFallback = node.compat_fallback === true;
      const fallbackReason = node.fallback_reason || "";
      const schedulerDecision = node.scheduler_decision || "";
      const leaseRef = node.lease_ref || "";
      const mailboxRef = node.mailbox_ref || "";
      const ctxRef = node.context_packet_ref
        ? (typeof node.context_packet_ref === "object" ? (node.context_packet_ref.path || node.context_packet_ref.packet_id || "") : String(node.context_packet_ref))
        : "";
      const evidencePath = node.evidence_ledger_path || "";
      const verifGate = node.verification_gate || "";
      const runtimeMissing = node.runtime_sources_missing || [];

      const runtimeSpineBadge = compatFallback
        ? '<span class="badge warn" data-badge-type="compatibility_fallback">FALLBACK</span>'
        : (selectedActor ? '<span class="badge passed">ACTOR_RUNTIME</span>' : '<span class="badge pending">PENDING</span>');

      const evidenceRefs = [evidencePath, leaseRef, ctxRef].filter(Boolean);
      const evidenceHtml = evidenceRefs.length
        ? evidenceRefs.map((r) => `<span class="chip runtime-ref">${esc(shortText(r, 48))}</span>`).join("")
        : '<span class="chip">N/A</span>';

      const missingRuntimeHtml = runtimeMissing.length
        ? runtimeMissing.map((m) => `<span class="chip runtime-missing">${esc(m)}</span>`).join("")
        : "";

      return `<section class="dag-node${compatFallback ? " dag-node-fallback" : ""}">
        <div class="node-top"><span class="node-id">${esc(node.id)}</span>${badge(node.status)} ${runtimeSpineBadge}</div>
        <div class="node-goal">${esc(shortText(node.goal, 170))}</div>
        <div class="node-meta">
          <span>depends: ${esc(deps)}</span>
          <span>gate: ${esc(node.gate || "N/A")}</span>
          <span>pane: ${esc(node.target_pane || "N/A")} · decision: ${esc(node.decision || "N/A")}</span>
          <span>capability: ${esc(ready)}</span>
          <span>cost: ${esc(node.estimated_cost ?? "N/A")}</span>
        </div>
        <div class="node-meta">
          <span>required: ${esc(node.required_capabilities && node.required_capabilities.length ? node.required_capabilities.join(", ") : "N/A")}</span>
          <span>missing: ${missing ? missing : "N/A"}</span>
        </div>
        <div class="node-runtime-spine">
          <span class="muted">operator: ${esc(logicalOp || "N/A")} · actor: ${esc(selectedActor || "N/A")} · host: ${esc(hostType || "N/A")}</span>
          ${dispatchPath ? `<span class="muted">dispatch: ${esc(shortText(dispatchPath, 52))}</span>` : ""}
          ${fallbackReason ? `<span class="muted fallback-reason">fallback: ${esc(fallbackReason)}</span>` : ""}
          ${schedulerDecision ? `<span class="muted">scheduler: ${esc(schedulerDecision)}</span>` : ""}
          ${verifGate ? `<span class="muted">verif_gate: ${esc(verifGate)}</span>` : ""}
        </div>
        <div class="node-meta">
          <span>blocked reason: ${esc(blockedReason)}</span>
        </div>
        <div class="node-evidence-refs">
          <span class="muted">evidence:</span> ${evidenceHtml}
          ${mailboxRef ? `<span class="chip runtime-ref">${esc(shortText(mailboxRef, 48))}</span>` : ""}
        </div>
        ${missingRuntimeHtml ? `<div class="node-runtime-missing"><span class="muted">missing:</span> ${missingRuntimeHtml}</div>` : ""}
        <div class="chips">${caps || '<span class="chip">N/A</span>'}</div>
      </section>`;
    }).join("") : '<div class="muted">No task graph nodes available.</div>';
  }

  function renderStack(targetId, rows, formatter) {
    const target = document.getElementById(targetId);
    const entries = Object.entries(rows || {});
    const max = Math.max(1, ...entries.map(([, count]) => Number(count) || 0));
    target.innerHTML = entries.length ? entries.map(([name, count]) => {
      const width = Math.max(6, Math.round(((Number(count) || 0) / max) * 100));
      return `<div class="stack-row">
        <div><strong>${esc(formatter ? formatter(name) : name)}</strong><div class="bar"><span style="width:${width}%"></span></div></div>
        <span>${esc(count)}</span>
      </div>`;
    }).join("") : '<div class="muted">N/A</div>';
  }

  function renderCapabilities(data) {
    const caps = (data.capabilities || {}).demand || {};
    const total = Object.values(caps).reduce((sum, item) => sum + (Number(item) || 0), 0);
    document.getElementById("capability-total").textContent = `${total} demand`;
    renderStack("capability-list", caps);
  }

  function renderActorRuntimeSummary(data) {
    const summary = data.actor_lease_summary || {};
    const states = summary.states || {};
    const summaryPairs = Object.entries(states).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const runtime = data.actor_runtime || [];
    document.getElementById("actor-runtime-summary").textContent =
      `${summary.actors_seen ?? 0} actors · ${summary.conflict_count ?? 0} conflict · total ${runtime.length}`;
    document.getElementById("actor-runtime-list").innerHTML = summaryPairs.length
      ? summaryPairs.map(([name, count]) => {
        const safeName = esc(name);
        return `<section class="stack-row"><div><strong>${safeName}</strong><div class="muted">state_count</div></div><span>${esc(count)}</span></section>`;
      }).join("")
      : '<div class="muted">N/A</div>';
  }

  function normalizedLeaseState(value) {
    const raw = String(value || "N/A").trim().toUpperCase();
    if (raw === "QUOTA") return "QUOTA_BLOCKED";
    if (raw === "AUTH") return "AUTH_BLOCKED";
    if (raw === "POLICY") return "POLICY_BLOCKED";
    if (raw === "HUMAN") return "HUMAN_REQUIRED";
    return raw || "N/A";
  }

  function renderActorLeaseStateMatrix(data) {
    const summaryStates = ((data.actor_lease_summary || {}).states) || {};
    const runtime = data.actor_runtime || [];
    const counts = {};
    for (const [stateName, count] of Object.entries(summaryStates)) {
      counts[normalizedLeaseState(stateName)] = Number(count) || 0;
    }
    for (const item of runtime) {
      const leaseState = normalizedLeaseState(item.lease_state);
      if (!(leaseState in counts)) counts[leaseState] = 0;
    }

    const total = LEASE_STATE_BRANCHES.reduce((sum, [, stateName]) => sum + (counts[stateName] || 0), 0);
    const countEl = document.getElementById("actor-lease-state-count");
    const matrixEl = document.getElementById("actor-lease-state-matrix");
    if (countEl) countEl.textContent = `${total} visible states`;
    if (!matrixEl) return;

    matrixEl.innerHTML = LEASE_STATE_BRANCHES.map(([label, stateName]) => {
      const matching = runtime.filter((item) => normalizedLeaseState(item.lease_state) === stateName);
      const refs = matching
        .map((item) => `${item.actor_id || "N/A"}:${item.node_id || "N/A"}`)
        .filter((value) => value !== "N/A:N/A");
      return `<section class="lease-state-cell" data-lease-state="${esc(stateName)}">
        <div class="lease-state-top">
          <span class="badge ${esc(stateName.toLowerCase())}">${esc(label)}</span>
          <strong>${esc(counts[stateName] || 0)}</strong>
        </div>
        <div class="muted">${esc(refs.length ? refs.join(", ") : "N/A")}</div>
      </section>`;
    }).join("");
  }

  function renderLeaseConflicts(data) {
    const conflicts = data.lease_conflicts || [];
    document.getElementById("lease-conflict-count").textContent = `${conflicts.length} conflicts`;
    const target = document.getElementById("lease-conflict-list");
    target.innerHTML = conflicts.length
      ? conflicts.map((item) => `
        <section class="stack-row">
          <div>
            <strong>${esc(item.actor_id || "N/A")}</strong>
            <div class="muted">state=${esc(renderList(item.lease_states, ""))} · leases=${esc(renderList(item.lease_ids, ""))}</div>
          </div>
          <span>${esc((item.nodes || []).join(", "))}</span>
        </section>`).join("")
      : '<div class="muted">N/A</div>';
  }

  function renderPaneFallbacks(data) {
    const fallbacks = data.pane_carrier_fallbacks || [];
    const runtimeByNode = Object.fromEntries((data.actor_runtime || []).map((item) => [`${item.node_id || "N/A"}:${item.actor_id || "N/A"}`, item]));
    document.getElementById("pane-fallback-count").textContent = `${fallbacks.length} fallback records`;
    document.getElementById("pane-fallback-list").innerHTML = fallbacks.length
      ? fallbacks.map((item) => {
        const runtime = runtimeByNode[`${item.node_id || "N/A"}:${item.actor_id || "N/A"}`] || {};
        const evidence = runtime.evidence_path || runtime.lease_ref || "N/A";
        return `<section class="stack-row">
          <div>
            <strong>${esc(item.actor_id || "N/A")}@${esc(item.target_pane || "N/A")}</strong>
            <div class="muted">node=${esc(item.node_id || "N/A")} · reason=${esc(item.fallback_reason || "N/A")}</div>
            <div class="muted">carrier=${esc(item.fallback_to_pane || item.target_pane || "N/A")} · evidence=${esc(evidence)}</div>
          </div>
          <span>${esc(item.reason || "pane_carrier")}</span>
        </section>`;
      }).join("")
      : '<div class="muted">N/A</div>';
  }

  function renderTrifaceSurfaces(data) {
    const triface = data.triface || data.triface_reader || {};
    const closureCard = data.closure_card || {};
    const progress = data.progress || {};
    const dag = data.dag || {};
    const nodes = dag.nodes || [];

    // Spec Surface — topology
    const specEl = document.getElementById("spec-surface-content");
    const specTier = document.getElementById("spec-tier");
    if (specTier) specTier.textContent = triface.source_tier || "legacy";
    if (specEl) {
      const specPath = triface.spec_path || "N/A";
      const mirrorReason = triface.mirror_fallback_reason || "";
      const mirrorBadge = mirrorReason ? ` <span class="badge warn" data-badge-type="mirror_fallback">MIRROR FALLBACK</span>` : "";
      const nodeRows = nodes.map((n) => {
        const deps = (n.depends_on || []).join(", ") || "ROOT";
        return `<section class="stack-row">
          <div>
            <strong>${esc(n.id)}</strong>
            <div class="muted">depends: ${esc(deps)}</div>
            <div class="muted">caps: ${esc((n.required_capabilities || []).join(", ") || "N/A")}</div>
          </div>
          <span>${esc(n.estimated_cost || "N/A")}</span>
        </section>`;
      }).join("");
      specEl.innerHTML = `
        <div class="muted">spec_path: ${esc(specPath)}${mirrorBadge}</div>
        <div class="muted">source_tier: ${esc(triface.source_tier || "legacy")}</div>
        ${nodes.length ? nodeRows : '<div class="muted">No spec nodes available.</div>'}`;
    }

    // State Surface — runtime
    const stateEl = document.getElementById("state-surface-content");
    const stateTier = document.getElementById("state-tier");
    if (stateTier) stateTier.textContent = triface.source_tier || "legacy";
    if (stateEl) {
      const statePath = triface.state_path || "N/A";
      const gateResults = progress.gate_results || {};
      const gateRows = Object.entries(gateResults).map(([gate, status]) =>
        `<section class="stack-row"><div><strong>${esc(gate)}</strong></div><span>${esc(status)}</span></section>`
      ).join("");
      const readyHtml = (progress.ready_nodes || []).map((n) => `<span class="chip">${esc(n)}</span>`).join("");
      const blockedHtml = (progress.blocked_nodes_with_reason || []).map((b) =>
        `<section class="stack-row"><div><strong>${esc(b.node)}</strong><div class="muted">${esc(b.reason)}</div></div><span>blocked</span></section>`
      ).join("");
      stateEl.innerHTML = `
        <div class="muted">state_path: ${esc(statePath)}</div>
        <div class="muted">closure_complete: ${progress.closure_complete ? "yes" : "no"} · closed: ${progress.closed ? "yes" : "no"}</div>
        <div class="muted">ready_nodes: ${readyHtml || "N/A"}</div>
        ${gateRows || '<div class="muted">No gate results.</div>'}
        ${blockedHtml || '<div class="muted">No blocked nodes.</div>'}`;
    }

    // Closure Surface — verdict (from closure.json ONLY, no NLP)
    const closureEl = document.getElementById("closure-surface-content");
    const closureTier = document.getElementById("closure-tier");
    if (closureTier) closureTier.textContent = closureCard.status || "pending";
    if (closureEl) {
      const allPassed = closureCard.all_nodes_passed === true;
      const allGates = closureCard.all_required_gates_passed === true;
      const complete = closureCard.closure_complete === true;
      const verdictStatus = complete ? "passed" : (closureCard.status || "pending");
      const verdictHtml = `<span class="badge ${esc(verdictStatus)}">${esc(verdictStatus).toUpperCase()}</span>`;
      const openNodes = (closureCard.open_nodes || []).map((n) => `<span class="chip">${esc(n)}</span>`).join("");
      const missingGates = (closureCard.missing_gates || []).map((g) => `<span class="chip">${esc(g)}</span>`).join("");
      const missingFields = (closureCard.missing_fields || []).map((f) => `<span class="chip">${esc(f)}</span>`).join("");
      const tests = (closureCard.tests || []).map((t) => `<span class="chip">${esc(typeof t === "string" ? t : JSON.stringify(t))}</span>`).join("");
      const evals = (closureCard.evals || []).map((e) => `<span class="chip">${esc(typeof e === "string" ? e : JSON.stringify(e))}</span>`).join("");
      const changedFiles = (closureCard.changed_files || []).map((f) => `<span class="chip">${esc(typeof f === "string" ? f : JSON.stringify(f))}</span>`).join("");
      const risks = (closureCard.residual_risks || []).map((r) => `<li>${esc(typeof r === "string" ? r : JSON.stringify(r))}</li>`).join("");

      closureEl.innerHTML = `
        <div class="verdict-banner" data-role="closure-verdict">${verdictHtml} <span class="muted">verdict from closure.json — all_nodes_passed=${allPassed} · all_gates_passed=${allGates} · complete=${complete}</span></div>
        <div class="muted">closed_at: ${esc(closureCard.closed_at || "N/A")}</div>
        ${openNodes ? `<div class="muted">open_nodes: ${openNodes}</div>` : ""}
        ${missingGates ? `<div class="muted">missing_gates: ${missingGates}</div>` : ""}
        ${missingFields ? `<div class="muted">missing_fields: ${missingFields}</div>` : ""}
        ${tests ? `<div class="muted">tests: ${tests}</div>` : ""}
        ${evals ? `<div class="muted">evals: ${evals}</div>` : ""}
        ${changedFiles ? `<div class="muted">changed_files: ${changedFiles}</div>` : ""}
        ${risks ? `<div class="muted">residual_risks:</div><ol>${risks}</ol>` : ""}`;
    }
  }

  function renderCloseoutWarnings(data) {
    const triface = data.triface || data.triface_reader || {};
    const closureCard = data.closure_card || {};
    const diagnostics = data.blocker_diagnostics || [];
    const container = document.getElementById("closeout-warning-list");
    const badge = document.getElementById("closeout-badge-count");
    if (!container) return;

    const warnings = [];

    if (triface.mirror_fallback_reason) {
      warnings.push({
        kind: "mirror_fallback",
        title: "Mirror Fallback Active",
        detail: triface.mirror_fallback_reason,
        severity: "warn",
      });
    }
    if (closureCard.closure_complete === false || closureCard.missing_fields && closureCard.missing_fields.length) {
      warnings.push({
        kind: "closeout_incomplete",
        title: "Closure Incomplete",
        detail: `missing_fields: ${(closureCard.missing_fields || []).join(", ") || "N/A"} · open_nodes: ${(closureCard.open_nodes || []).join(", ") || "none"}`,
        severity: "warn",
      });
    }

    const driftDiagnostics = diagnostics.filter((d) =>
      d.kind === "spec_missing" || d.kind === "state_missing" || d.kind === "closeout_incomplete" || d.kind === "mirror_fallback"
    );
    for (const d of driftDiagnostics) {
      if (!warnings.find((w) => w.kind === d.kind)) {
        warnings.push({ kind: d.kind, title: d.title, detail: d.detail, severity: d.severity });
      }
    }

    if (badge) badge.textContent = `${warnings.length} warnings`;

    if (!warnings.length) {
      container.innerHTML = '<div class="diagnostic"><h3>No closeout or drift warnings</h3><p>Closure face is complete and no mirror fallback is active.</p></div>';
      return;
    }

    container.innerHTML = warnings.map((w) => `<section class="diagnostic ${esc(w.severity || "warn")}" data-diagnostic-kind="${esc(w.kind)}">
      <h3>${esc(w.title)}</h3>
      <p>${esc(w.detail)}</p>
    </section>`).join("");
  }

  function renderActorRuntimeCards(data) {
    const rows = data.actor_runtime || [];
    document.getElementById("actor-runtime-cards").innerHTML = rows.length
      ? rows.map((item) => {
          const tags = [];
          if (item.compat_fallback) {
            tags.push("compat_fallback");
          }
          if (item.lease_id && item.lease_id !== "N/A") {
            tags.push(`lease=${esc(item.lease_id)}`);
          }
          const tagHtml = tags.length ? tags.map((tag) => `<span class="chip">${tag}</span>`).join("") : '<span class="chip">N/A</span>';
          return `<section class="actor-card">
            <div class="actor-top">
              <span class="badge ${esc(String(item.lease_state || "pending").toLowerCase())}">${esc(item.lease_state || "N/A")}</span>
              <span class="muted">${esc(item.logical_operator || "N/A")}</span>
            </div>
            <div class="actor-meta">
              <span>actor=${esc(item.actor_id || "N/A")} · task=${esc(item.task_id || "N/A")}</span>
              <span>node=${esc(item.node_id || "N/A")} · sprint=${esc(item.sprint_id || "N/A")}</span>
              <span>lease_ref=${esc(item.lease_ref || "N/A")} · proof=${esc(item.evidence_path || "N/A")}</span>
              <span>pane=${esc(item.fallback_to_pane || "N/A")} · host=${esc(item.host_id || "N/A")}</span>
              <span class="muted">${tagHtml}</span>
              <span>context=${esc((item.context_packet_ref && item.context_packet_ref.path) || item.context_packet_ref || "N/A")}</span>
            </div>
          </section>`;
        }).join("")
      : '<div class="muted">N/A</div>';
  }

  function renderCapabilityEvidence(data) {
    const evidence = (data.capabilities || {}).capability_evidence || [];
    document.getElementById("capability-evidence-count").textContent = `${evidence.length} capabilities`;
    document.getElementById("capability-evidence").innerHTML = evidence.length ? evidence.map((item) => {
      const ev = (item.evidence_refs || []).join(", ") || "N/A";
      const sprintCount = item.sprint_count ?? 0;
      return `<section class="stack-row">
        <div>
          <strong>${esc(item.capability || "N/A")}</strong>
          <div class="muted">sprints: ${esc(sprintCount)} · ${item.sprints ? esc(item.sprints.join(", ")) : "N/A"}</div>
          <div class="muted">evidence: ${esc(ev)}</div>
        </div>
        <span>${esc(sprintCount)}</span>
      </section>`;
    }).join("") : '<div class="muted">No evidence map yet.</div>';
  }

  function renderResources(data) {
    const resources = data.resources || {};
    document.getElementById("routing-count").textContent = `${resources.routing_records_for_sprint || 0} sprint routes`;
    renderStack("resource-list", resources.cost_by_status || {});
  }

  function renderDiagnostics(data) {
    const items = data.blocker_diagnostics || [];
    const blockedReasons = (data.blocked_reasons || []).filter(Boolean);
    const total = items.length + blockedReasons.length;
    document.getElementById("blocker-count").textContent = `${total} findings`;

    const BLOCKER_REASON_LABELS = {
      upstream: "Upstream dependency not passed",
      gate_pending: "Required gate has not passed",
      capability_mismatch: "Required capability not provided by any pane",
      closeout_incomplete: "Closure face is incomplete or missing fields",
      mirror_fallback: "Dashboard using compatibility mirror (triface face missing)",
    };

    document.getElementById("blocker-list").innerHTML = items.length ? items.map((item) => {
      const guidance = (item.guidance || []).map((step) => `<li>${esc(step)}</li>`).join("");
      const kind = reasonKind(item.kind || "");
      const reasonText = BLOCKER_REASON_LABELS[kind] || "";
      const reasonBadge = reasonText ? ` <span class="badge warn" data-badge-type="${esc(kind)}">${esc(kind).toUpperCase()}</span>` : "";
      return `<section class="diagnostic ${esc(item.severity || "warn")}" data-diagnostic-kind="${esc(kind)}">
        <h3>${esc(item.title || item.kind || "Diagnostic")}${reasonBadge}</h3>
        <p>${esc(item.detail || "N/A")}</p>
        ${reasonText ? `<p class="muted">Reason: ${esc(reasonText)}</p>` : ""}
        <ol>${guidance || "<li>N/A</li>"}</ol>
      </section>`;
    }).join("") + (blockedReasons.length ? `<section class="diagnostic warn"><h3>Blocked reasons</h3><ol>${blockedReasons.map((reason) => `<li>${esc(reason)}</li>`).join("")}</ol></section>` : "") : "";
    if (!items.length && !blockedReasons.length) {
      document.getElementById("blocker-list").innerHTML = '<div class="diagnostic"><h3>No active blockers detected</h3><p>Current status and graph files do not report unresolved dependencies.</p><ol><li>Keep graph validation and handoff evidence attached before closing the node.</li></ol></div>';
    }
  }

  function renderSupplyChain(data) {
    const sc = data.execution_supply_chain || {};
    const nodes = sc.nodes || [];
    const countEl = document.getElementById("supply-chain-count");
    const contentEl = document.getElementById("supply-chain-content");
    if (!countEl || !contentEl) return;
    countEl.textContent = `${nodes.length} nodes`;
    if (!nodes.length) {
      contentEl.innerHTML = '<div class="muted">No execution supply chain data.</div>';
      return;
    }
    contentEl.innerHTML = nodes.map((node) => {
      const cls = node.classification || {};
      const skills = Array.isArray(node.skills) ? node.skills : [];
      const mcp = node.mcp || {};
      const mcpRequired = Array.isArray(mcp.required) ? mcp.required : [];
      const capsule = node.capsule || {};
      const physOp = node.physical_operator || {};
      const evPolicy = node.evidence_policy || {};
      const workflowStages = Array.isArray(node.workflow_stages) ? node.workflow_stages : [];

      const skillRows = skills.map((s) => {
        const stage = esc(s.stage || "N/A");
        const sel = esc(s.selected || "N/A");
        const cands = (s.candidates || []).map((c) => esc(typeof c === "string" ? c : JSON.stringify(c))).join(", ") || "N/A";
        const rej = (s.rejected || []).map((r) => esc(typeof r === "string" ? r : JSON.stringify(r))).join(", ") || "N/A";
        return `<div class="muted">stage=${stage} · selected=${sel} · candidates=${cands} · rejected=${rej}</div>`;
      }).join("");

      const mcpRows = mcpRequired.map((m) => {
        const cap = esc(m.capability || "N/A");
        const st = esc(m.state || "N/A");
        const why = esc(m.why || "N/A");
        const providers = (m.provider_candidates || []).map((p) => esc(p)).join(", ") || "N/A";
        const unresolved = m.unresolved_reason ? ` · unresolved: ${esc(m.unresolved_reason)}` : "";
        return `<div class="muted">${cap} · ${st} · why=${why} · providers=${providers}${unresolved}</div>`;
      }).join("");

      const capsuleCands = Array.isArray(capsule.candidates) ? capsule.candidates : [];
      const capsuleRows = capsuleCands.map((c) => {
        const cid = esc(c.capsule_id || "N/A");
        const sel = c.selected ? "selected" : "rejected";
        const rat = esc(c.selection_rationale || c.rejection_rationale || "N/A");
        return `<div class="muted">${cid} · ${sel} · rationale=${rat}</div>`;
      }).join("");

      const physCands = Array.isArray(physOp.candidates) ? physOp.candidates : [];
      const physRows = physCands.map((c) => {
        const oid = esc(c.operator_id || "N/A");
        const sel = c.selected ? "selected" : "rejected";
        const rat = esc(c.rejection_rationale || "N/A");
        return `<div class="muted">${oid} · ${sel} · rationale=${rat}</div>`;
      }).join("");

      const proofObs = Array.isArray(evPolicy.proof_obligations) ? evPolicy.proof_obligations.map((p) => esc(p)).join(", ") : esc(evPolicy.proof_obligations || "N/A");
      const verifyCmds = Array.isArray(evPolicy.verification_commands) ? evPolicy.verification_commands.map((c) => esc(c)).join(", ") : esc(evPolicy.verification_commands || "N/A");

      const workflowHtml = workflowStages.map((s) => {
        const name = esc(s.stage_name || "N/A");
        const op = esc(s.operator || "N/A");
        return `<div class="muted">${name} → ${op}</div>`;
      }).join("");

      const fallbackBadge = capsule.fallback_used ? ' <span class="badge warn">FALLBACK</span>' : '';

      return `<section class="stack-row supply-chain-node">
        <div>
          <strong>${esc(node.node_id || "N/A")}</strong> · ${esc(node.logical_operator || "N/A")} · class=${esc(cls.primary_class || "N/A")} · conf=${esc(cls.confidence || "N/A")}${fallbackBadge}
          <div class="muted">goal: ${esc(shortText(node.goal || "N/A", 120))}</div>
          ${workflowHtml ? `<div class="muted"><em>Workflow:</em></div>${workflowHtml}` : ""}
          ${skillRows ? `<div class="muted"><em>Skills:</em></div>${skillRows}` : ""}
          ${mcpRows ? `<div class="muted"><em>MCP:</em></div>${mcpRows}` : ""}
          ${capsuleRows ? `<div class="muted"><em>Capsule:</em> selected=${esc(capsule.selected || "N/A")}${capsule.fallback_reason && capsule.fallback_reason !== "N/A" ? " · fallback_reason=" + esc(capsule.fallback_reason) : ""}</div>${capsuleRows}` : `<div class="muted"><em>Capsule:</em> selected=${esc(capsule.selected || "N/A")}${fallbackBadge}</div>`}
          ${physRows ? `<div class="muted"><em>Physical Op:</em> selected=${esc(physOp.selected || "N/A")}</div>${physRows}` : `<div class="muted"><em>Physical Op:</em> selected=${esc(physOp.selected || "N/A")}</div>`}
          <div class="muted"><em>Evidence:</em> proof=${proofObs} · verify=${verifyCmds}</div>
        </div>
      </section>`;
    }).join("");
  }

  function renderPanes(data) {
    const panes = ((data.capabilities || {}).pane_supply || []);
    document.getElementById("pane-count").textContent = `${panes.length} panes`;
    document.getElementById("pane-supply").innerHTML = panes.length ? panes.map((pane) => {
      const caps = (pane.provided_capabilities || []).slice(0, 6).map((cap) => `<span class="chip">${esc(cap)}</span>`).join("");
      return `<section class="pane-card">
        <strong>${esc(pane.pane_id || "N/A")}</strong>
        <span class="muted">${esc(pane.role || "N/A")} · ${esc(pane.model || "N/A")} · ${esc(pane.state || "N/A")}</span>
        <div class="chips">${caps || '<span class="chip">N/A</span>'}</div>
      </section>`;
    }).join("") : '<div class="muted">N/A</div>';
  }

  async function fetchRunEvidence(sid) {
    if (!sid) return null;
    try {
      const res = await fetch(`${BASE}/sprints/${encodeURIComponent(sid)}/run-evidence`, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!res.ok) return null;
      const env = await res.json();
      return env.data || null;
    } catch (_) {
      return null;
    }
  }

  const EVIDENCE_STATUS_CLASS = {
    full: "passed",
    partial: "warn",
    legacy_jsonl_only: "warn",
    run_dir_missing: "warn",
    manifest_partial: "warn",
    manifest_corrupt: "error",
    scrub_failure: "error",
    concurrent_node_dirs: "warn",
  };

  function renderDispatches(evData) {
    const dispatchEl = document.getElementById("dispatch-summary");
    const countEl = document.getElementById("dispatch-entry-count");
    if (!dispatchEl || !countEl) return;
    if (!evData) {
      countEl.textContent = "N/A";
      dispatchEl.innerHTML = '<div class="muted">No dispatch data.</div>';
      return;
    }
    const d = evData.dispatches || {};
    countEl.textContent = `${d.entry_count || 0} entries`;
    dispatchEl.innerHTML = `<section class="stack-row">
      <div>
        <strong>JSONL Dispatch Index</strong>
        <div class="muted">entries: ${esc(d.entry_count || 0)} · latest_event: ${esc(d.latest_event_type || "N/A")}</div>
        <div class="muted">actor: ${esc(d.latest_actor_id || "N/A")} · task: ${esc(d.latest_task_id || "N/A")}</div>
        <div class="muted">node: ${esc(d.latest_node_id || "N/A")}</div>
        ${d.jsonl_path ? `<div class="muted">path: ${esc(d.jsonl_path)}</div>` : ""}
      </div>
      <span>${esc(d.entry_count || 0)}</span>
    </section>`;
  }

  function renderRunEvidence(evData) {
    const statusBadgeEl = document.getElementById("run-evidence-status-badge");
    const actorEl = document.getElementById("run-evidence-actor");
    const nodesEl = document.getElementById("run-evidence-nodes");
    const reviewEl = document.getElementById("run-evidence-review");
    if (!statusBadgeEl || !actorEl || !nodesEl || !reviewEl) return;
    if (!evData) {
      statusBadgeEl.textContent = "N/A";
      actorEl.innerHTML = nodesEl.innerHTML = reviewEl.innerHTML = '<div class="muted">No run evidence data.</div>';
      return;
    }
    const status = evData.run_evidence_status || "N/A";
    const statusClass = EVIDENCE_STATUS_CLASS[status] || "muted";
    statusBadgeEl.textContent = status;
    statusBadgeEl.className = `evidence-badge badge ${statusClass}`;

    const re = evData.run_evidence || {};
    const degraded = (evData.degraded_sources || []).filter(Boolean);
    const degradedHtml = degraded.length
      ? `<div class="muted">degraded: ${esc(degraded.join(", "))}</div>`
      : "";

    actorEl.innerHTML = `<section class="stack-row">
      <div>
        <strong>Actor Selection</strong>
        <div class="muted">selected: ${esc(re.selected_actor || "N/A")} · manifest: ${esc(re.manifest_status || "N/A")} · scrub_ok: ${esc(re.scrub_ok == null ? "N/A" : String(re.scrub_ok))}</div>
        <div class="muted">run_dir: ${esc(re.run_dir || "N/A")}</div>
        ${re.selection_summary ? `<div class="muted">selection: ${esc(re.selection_summary)}</div>` : ""}
        ${re.rejected_candidates && re.rejected_candidates.length ? `<div class="muted">rejected: ${esc(re.rejected_candidates.join(", "))}</div>` : ""}
        ${degradedHtml}
      </div>
    </section>`;

    const nodeArtifacts = re.node_artifacts || {};
    const nodeIds = Object.keys(nodeArtifacts);
    nodesEl.innerHTML = nodeIds.length ? nodeIds.map((nid) => {
      const entry = nodeArtifacts[nid] || {};
      const dirs = (entry.dirs || []).join(", ") || "N/A";
      const files = (entry.files || []).slice(0, 6);
      const fileHtml = files.map((f) => `<div class="muted">${esc(f)}</div>`).join("");
      return `<section class="stack-row">
        <div>
          <strong>${esc(nid)}</strong>
          <div class="muted">dirs: ${esc(dirs)}</div>
          ${fileHtml}
        </div>
      </section>`;
    }).join("") : '<div class="muted">No node artifacts.</div>';

    const review = evData.review || {};
    const decisions = (review.review_decisions || []);
    const finalReport = review.final_report || {};
    reviewEl.innerHTML = `<section class="stack-row">
      <div>
        <strong>Review &amp; Final Report</strong>
        <div class="muted">review decisions: ${esc(decisions.length)} · final_report: ${esc(finalReport.exists ? "exists" : "missing")}</div>
        ${finalReport.exists && finalReport.path ? `<div class="muted">report: ${esc(finalReport.path)}</div>` : ""}
        ${decisions.slice(0, 3).map((d) => `<div class="muted">review: ${esc(d._review_dir || "N/A")} · verdict: ${esc(d.verdict || d.decision || "N/A")}</div>`).join("")}
      </div>
    </section>`;
  }

  function renderAntigravityBridgeCard(data) {
    const badgeEl = document.getElementById("bridge-state-badge");
    const contentEl = document.getElementById("bridge-card-content");
    if (!badgeEl || !contentEl) return;
    const sourceSummary = data.source_summary || {};
    const children = data.child_sprints || [];
    const lineageMap = data.per_child_source_lineage || {};
    const agCount = sourceSummary["antigravity-app"] || 0;
    if (agCount === 0 && Object.keys(sourceSummary).length === 0) {
      badgeEl.textContent = "no lineage data";
      contentEl.innerHTML = '<div class="muted">No Antigravity source lineage available for this epic.</div>';
      return;
    }
    const state = agCount > 0 ? "active" : "pending";
    badgeEl.innerHTML = `<span class="badge ${state}">${esc(state.toUpperCase())}</span>`;
    const agChildren = children.filter((c) => {
      const lin = lineageMap[c.sprint_id];
      return lin && lin.is_antigravity_desktop;
    });
    const rows = agChildren.length ? agChildren.map((c) => {
      const lin = lineageMap[c.sprint_id] || {};
      const conv = lin.conversation_id || "N/A";
      const proj = lin.project_id || "N/A";
      return `<section class="stack-row">
        <div>
          <strong>${esc(c.sprint_id)}</strong> <span class="chip source-antigravity">antigravity-app</span>
          <div class="muted">status: ${esc(c.status || "N/A")} · conv: ${esc(conv)} · proj: ${esc(proj)}</div>
        </div>
        <span>${esc(c.status || "N/A")}</span>
      </section>`;
    }).join("") : '<div class="muted">No Antigravity-desktop-sourced sprints found.</div>';
    contentEl.innerHTML = `
      <div class="muted">Antigravity-desktop-sourced sprints: ${esc(agCount)} · total sources: ${esc(Object.entries(sourceSummary).map(([k,v]) => `${k}=${v}`).join(", ") || "N/A")}</div>
      ${rows}
      <div class="muted"><em>Antigravity desktop app is a requirement-source, not an execution backend (agy/Gemini physical operator).</em></div>`;
  }

  async function refresh() {
    const marker = document.getElementById("refresh-state");
    marker.textContent = "pending";
    try {
      const [envelope, evData] = await Promise.all([
        fetchDashboard(),
        fetchRunEvidence(state.sprintId),
      ]);
      const data = envelope.data || {};
      renderSelect(data);
      renderHero(data);
      renderDag(data);
      renderEpicChildren(data);
      renderCapabilities(data);
      renderCapabilityEvidence(data);
      renderResources(data);
      renderDiagnostics(data);
      renderTrifaceSurfaces(data);
      renderCloseoutWarnings(data);
      renderPanes(data);
      renderSupplyChain(data);
      renderActorRuntimeSummary(data);
      renderActorLeaseStateMatrix(data);
      renderActorRuntimeCards(data);
      renderLeaseConflicts(data);
      renderPaneFallbacks(data);
      renderDispatches(evData);
      renderRunEvidence(evData);
      renderAntigravityBridgeCard(data);
      marker.textContent = `ok · ${envelope.generated_at || new Date().toISOString()}`;
    } catch (error) {
      marker.textContent = `error · ${error.message}`;
      document.getElementById("blocker-list").innerHTML =
        `<div class="diagnostic error"><h3>Dashboard API unreachable</h3><p>${esc(error.message)}</p><ol><li>Check that status-server is running on port 8765.</li><li>Open /healthz and run the orchestration route tests.</li></ol></div>`;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    refresh();
    setInterval(refresh, 15000);
  });
})();
