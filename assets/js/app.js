const state = {
  status: null,
  selectedPath: "",
  selectedUntracked: false,
  diffMode: "unstaged",
  lastDiffKey: "",   // track last diff request to skip redundant rerenders
  lastDiffText: "",  // track last diff content
};

const els = {
  branchName: document.getElementById("branchName"),
  repoRoot: document.getElementById("repoRoot"),
  changedCount: document.getElementById("changedCount"),
  stagedCount: document.getElementById("stagedCount"),
  unstagedCount: document.getElementById("unstagedCount"),
  fileList: document.getElementById("fileList"),
  diffTitle: document.getElementById("diffTitle"),
  diffSubtitle: document.getElementById("diffSubtitle"),
  diffOutput: document.getElementById("diffOutput"),
  diffActions: document.getElementById("diffActions"),
  statusFlash: document.getElementById("statusFlash"),
  selectionHint: document.getElementById("selectionHint"),
  refreshButton: document.getElementById("refreshButton"),
  stageAllButton: document.getElementById("stageAllButton"),
  unstageAllButton: document.getElementById("unstageAllButton"),
  unstagedModeButton: document.getElementById("unstagedModeButton"),
  stagedModeButton: document.getElementById("stagedModeButton"),
  commitForm: document.getElementById("commitForm"),
  commitMessage: document.getElementById("commitMessage"),
  stageAllCheckbox: document.getElementById("stageAllCheckbox"),
  commitButton: document.getElementById("commitButton"),
  commitResult: document.getElementById("commitResult"),
};

function escapeHtml(input) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function requestJSON(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }

  return payload;
}

function setFlash(message, type = "warn") {
  if (!message) {
    els.statusFlash.className = "flash flash-warn app-flash hidden";
    els.statusFlash.textContent = "";
    return;
  }

  const className = type === "error" ? "flash flash-error app-flash" : "flash flash-warn app-flash";
  els.statusFlash.className = className;
  els.statusFlash.textContent = message;
}

function setCommitResult(message, isError = false) {
  els.commitResult.textContent = message;
  els.commitResult.className = isError ? "commit-result color-fg-danger" : "commit-result color-fg-success";
}

function currentFile() {
  if (!state.status || !state.selectedPath) {
    return null;
  }
  return state.status.files.find((file) => file.path === state.selectedPath) || null;
}

function shortStatusLabel(file) {
  if (file.untracked) return "?";

  switch (file.label) {
    case "Modified":
      return "M";
    case "Added":
      return "A";
    case "Deleted":
      return "D";
    case "Renamed":
      return "R";
    case "Copied":
      return "C";
    case "Conflict":
      return "!";
    default:
      return ".";
  }
}

/* ---------- Status / header counters (cheap text updates) ---------- */

function renderStatus(status) {
  state.status = status;

  els.branchName.textContent = status.currentBranch || "(detached HEAD)";
  els.repoRoot.textContent = status.repoRoot;
  els.changedCount.textContent = String(status.files.length);
  els.stagedCount.textContent = String(status.stagedCount);
  els.unstagedCount.textContent = String(status.unstagedCount);
  els.selectionHint.textContent = status.files.length
    ? "Files auto-select as you move through changes."
    : "Working tree is clean.";

  if (!status.files.some((file) => file.path === state.selectedPath)) {
    state.selectedPath = "";
    state.selectedUntracked = false;
  }
  if (!state.selectedPath && status.files.length) {
    state.selectedPath = status.files[0].path;
    state.selectedUntracked = status.files[0].untracked;
  }

  renderFileList(status.files);
  renderDiffActions();
}

/* ---------- File list – patch existing DOM instead of innerHTML ---------- */

function fileItemKey(file) {
  // Unique key combining path + current stage/unstage state
  return `${file.path}|${file.staged ? "S" : ""}${file.unstaged ? "U" : ""}${file.untracked ? "N" : ""}|${file.label}`;
}

function buildFileItemHTML(file) {
  const selected = file.path === state.selectedPath ? "selected" : "";
  const tagClass = file.label.toLowerCase();
  const meta = [];
  if (file.staged) meta.push('<span class="meta-pill">S</span>');
  if (file.unstaged && !file.untracked) meta.push('<span class="meta-pill">U</span>');
  if (file.untracked) meta.push('<span class="meta-pill">NEW</span>');
  const actions = [];
  if (file.unstaged || file.untracked) {
    actions.push(`<button class="btn btn-sm compact-action stage-action file-action" type="button" data-action="stage" title="Stage file" aria-label="Stage file">
      <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2Z"/></svg>
    </button>`);
  }
  if (file.staged) {
    actions.push(`<button class="btn btn-sm compact-action unstage-action file-action" type="button" data-action="unstage" title="Unstage file" aria-label="Unstage file">
      <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M2 7.75A.75.75 0 0 1 2.75 7h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 7.75Z"/></svg>
    </button>`);
  }

  return `
    <div
      class="file-button ${selected}"
      role="button"
      tabindex="0"
      data-path="${escapeHtml(file.path)}"
      data-untracked="${file.untracked ? "1" : "0"}"
      title="${escapeHtml(file.displayPath)}"
    >
      <div class="file-row-actions">${actions.join("")}</div>
      <div class="file-main">
        <span class="file-state ${tagClass}">${shortStatusLabel(file)}</span>
        <span class="file-path">${escapeHtml(file.displayPath)}</span>
      </div>
      <div class="status-meta">
        <span class="status-tag ${tagClass}">${escapeHtml(file.label)}</span>
        ${meta.join("")}
      </div>
    </div>
  `;
}

function attachFileItemListeners(li) {
  const el = li.querySelector(".file-button");
  if (!el) return;
  el.addEventListener("click", (e) => {
    if (e.target.closest(".file-action")) return;
    state.selectedPath = el.dataset.path || "";
    state.selectedUntracked = el.dataset.untracked === "1";
    loadDiff().catch((error) => setFlash(error.message, "error"));
    renderFileList(state.status.files);
    renderDiffActions();
  });

  li.querySelectorAll(".file-action").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      event.preventDefault();
      const row = button.closest(".file-item")?.querySelector(".file-button");
      const path = row?.dataset.path || "";
      const untracked = row?.dataset.untracked === "1";
      state.selectedPath = path;
      state.selectedUntracked = untracked;
      const action = button.dataset.action;
      await runFileAction(action, path);
    });
  });
}

function renderFileList(files) {
  if (!files.length) {
    els.fileList.innerHTML = `
      <li class="file-item">
        <div class="file-button" style="justify-content:center;padding:24px 12px;color:var(--app-faint);">
          <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" style="margin-right:8px;opacity:0.5;"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>
          <span class="file-path" style="color:var(--app-faint);">No local changes</span>
        </div>
      </li>`;
    return;
  }

  // Build a map of existing DOM items keyed by file path
  const existingItems = new Map();
  els.fileList.querySelectorAll("li.file-item").forEach((li) => {
    const btn = li.querySelector(".file-button");
    if (btn) {
      existingItems.set(btn.dataset.path, li);
    }
  });

  const newChildren = [];
  for (const file of files) {
    const key = fileItemKey(file);
    const existingLi = existingItems.get(file.path);

    if (existingLi && existingLi.dataset.key === key) {
      // Same state – just update selected class without recreating
      const btn = existingLi.querySelector(".file-button");
      if (btn) {
        btn.classList.toggle("selected", file.path === state.selectedPath);
      }
      newChildren.push(existingLi);
      existingItems.delete(file.path);
    } else {
      // New or changed – create fresh element
      const li = document.createElement("li");
      li.className = "file-item";
      li.dataset.key = key;
      li.innerHTML = buildFileItemHTML(file);
      attachFileItemListeners(li);
      newChildren.push(li);
      existingItems.delete(file.path);
    }
  }

  // Replace children in one batch (avoids flicker vs clearing + appending)
  els.fileList.replaceChildren(...newChildren);
}

/* ---------- Diff actions (small, OK to innerHTML) ---------- */

function renderDiffActions() {
  const file = currentFile();
  if (!file) {
    els.diffActions.innerHTML = "";
    return;
  }

  const actions = [];
  if (file.unstaged || file.untracked) {
    actions.push(`<button class="btn btn-sm compact-action stage-action" type="button" data-action="stage-current" title="Stage file" aria-label="Stage file">
      <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2Z"/></svg>
    </button>`);
  }
  if (file.staged) {
    actions.push(`<button class="btn btn-sm compact-action unstage-action" type="button" data-action="unstage-current" title="Unstage file" aria-label="Unstage file">
      <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M2 7.75A.75.75 0 0 1 2.75 7h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 7.75Z"/></svg>
    </button>`);
  }

  els.diffActions.innerHTML = actions.join("");
  els.diffActions.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.action === "stage-current" ? "stage" : "unstage";
      await runFileAction(action, file.path);
    });
  });
}

/* ---------- Stage / Unstage actions ---------- */

async function mutatePath(endpoint, path = "") {
  await requestJSON(endpoint, {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

async function runFileAction(action, path) {
  const isStage = action === "stage";
  const endpoint = isStage ? "/api/stage" : "/api/unstage";
  const verb = isStage ? "Stage" : "Unstage";

  try {
    await mutatePath(endpoint, path);
    // Only refresh status (file list patches in-place) and diff
    await loadStatus();
  } catch (error) {
    setFlash(error.message, "error");
  }
}

/* ---------- Diff parser ---------- */

function parseDiff(diffText) {
  const lines = diffText.split("\n");
  const files = [];
  let currentFile = null;
  let currentHunk = null;
  let oldLine = 0;
  let newLine = 0;

  function ensureFile() {
    if (!currentFile) {
      currentFile = {
        path: state.selectedPath || "Repository",
        meta: [],
        hunks: [],
        additions: 0,
        deletions: 0,
      };
    }
  }

  function finishHunk() {
    if (currentFile && currentHunk) {
      currentFile.hunks.push(currentHunk);
      currentHunk = null;
    }
  }

  function finishFile() {
    if (!currentFile) {
      return;
    }
    finishHunk();
    if (!currentFile.path) {
      currentFile.path = state.selectedPath || "Repository";
    }
    files.push(currentFile);
    currentFile = null;
  }

  for (const raw of lines) {
    if (raw.startsWith("diff --git")) {
      finishFile();
      ensureFile();
      continue;
    }

    if (raw.startsWith("---") || raw.startsWith("+++")) {
      ensureFile();
      if (raw.startsWith("+++ b/")) {
        currentFile.path = raw.slice(6);
      }
      continue;
    }

    if (raw.startsWith("@@")) {
      ensureFile();
      finishHunk();
      const match = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      oldLine = match ? parseInt(match[1], 10) : 0;
      newLine = match ? parseInt(match[2], 10) : 0;
      currentHunk = { header: raw, lines: [] };
      continue;
    }

    if (
      raw.startsWith("index ") ||
      raw.startsWith("old mode") ||
      raw.startsWith("new mode") ||
      raw.startsWith("new file mode") ||
      raw.startsWith("deleted file mode") ||
      raw.startsWith("similarity index") ||
      raw.startsWith("rename from") ||
      raw.startsWith("rename to") ||
      raw.startsWith("Binary files")
    ) {
      ensureFile();
      currentFile.meta.push(raw);
      continue;
    }

    if (!currentHunk) {
      continue;
    }

    if (raw.startsWith("+")) {
      currentHunk.lines.push({
        type: "add",
        oldNumber: "",
        newNumber: String(newLine),
        sign: "+",
        content: raw.slice(1),
      });
      newLine++;
      if (currentFile) currentFile.additions++;
    } else if (raw.startsWith("-")) {
      currentHunk.lines.push({
        type: "remove",
        oldNumber: String(oldLine),
        newNumber: "",
        sign: "-",
        content: raw.slice(1),
      });
      oldLine++;
      if (currentFile) currentFile.deletions++;
    } else if (raw.startsWith("\\")) {
      currentHunk.lines.push({
        type: "note",
        oldNumber: "",
        newNumber: "",
        sign: "",
        content: raw,
      });
    } else {
      const content = raw.startsWith(" ") ? raw.slice(1) : raw;
      currentHunk.lines.push({
        type: "context",
        oldNumber: String(oldLine),
        newNumber: String(newLine),
        sign: " ",
        content,
      });
      oldLine++;
      newLine++;
    }
  }

  finishFile();
  return files;
}

/* ---------- Diff renderer – skip rerender when content unchanged ---------- */

function renderDiff(diffText) {
  // Skip rerender if diff content is identical
  if (diffText === state.lastDiffText) {
    return;
  }
  state.lastDiffText = diffText;

  if (!diffText || !diffText.trim()) {
    els.diffOutput.innerHTML = `
      <div class="diff-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
        <span>No diff output for the current selection.</span>
      </div>`;
    return;
  }

  const files = parseDiff(diffText);
  if (!files.length) {
    els.diffOutput.innerHTML = `
      <div class="diff-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span>Diff exists but could not be rendered.</span>
      </div>`;
    return;
  }

  const renderedFiles = files.map((file) => {
    const meta = file.meta.length
      ? `<div class="diff-meta">${escapeHtml(file.meta.join("\n"))}</div>`
      : "";
    const hunks = file.hunks.map((hunk) => {
      const rows = hunk.lines.map((line) => `
        <div class="diff-row ${line.type}">
          <div class="diff-num">${escapeHtml(line.oldNumber)}</div>
          <div class="diff-num">${escapeHtml(line.newNumber)}</div>
          <div class="diff-sign">${escapeHtml(line.sign)}</div>
          <div class="diff-code">${escapeHtml(line.content)}</div>
        </div>
      `).join("");

      return `
        <section class="diff-hunk">
          <div class="diff-hunk-header">${escapeHtml(hunk.header)}</div>
          ${rows}
        </section>
      `;
    }).join("");

    return `
      <section class="diff-file">
        <header class="diff-file-header">
          <div class="diff-file-path">${escapeHtml(file.path)}</div>
          <div class="diff-file-stats">
            <span>${file.hunks.length} hunk${file.hunks.length === 1 ? "" : "s"}</span>
            <span class="diff-stat add">+${file.additions}</span>
            <span class="diff-stat remove">-${file.deletions}</span>
          </div>
        </header>
        ${meta}
        ${hunks || '<div class="diff-empty">No line-level changes to render.</div>'}
      </section>
    `;
  }).join("");

  els.diffOutput.innerHTML = `<div class="diff-list">${renderedFiles}</div>`;
}

/* ---------- Mode buttons ---------- */

function updateModeButtons() {
  const staged = state.diffMode === "staged";
  els.stagedModeButton.classList.toggle("selected", staged);
  els.unstagedModeButton.classList.toggle("selected", !staged);
}

/* ---------- Load status & diff ---------- */

async function loadStatus() {
  const status = await requestJSON("/api/status");
  renderStatus(status);
  setFlash("");
  await loadDiff();
}

async function loadDiff() {
  updateModeButtons();

  const params = new URLSearchParams();
  if (state.selectedPath) {
    params.set("path", state.selectedPath);
  }
  if (state.diffMode === "staged") {
    params.set("staged", "1");
  }
  if (state.selectedUntracked && state.diffMode === "unstaged") {
    params.set("untracked", "1");
  }

  const target = state.selectedPath || "Repository";
  els.diffTitle.textContent = state.selectedPath ? target : "Diff";
  els.diffSubtitle.textContent = state.selectedPath
    ? `Showing ${state.diffMode} changes for ${target}.`
    : `Showing ${state.diffMode} changes across the repository.`;

  try {
    const payload = await requestJSON(`/api/diff?${params.toString()}`);
    renderDiff(payload.diff);
  } catch (error) {
    renderDiff("");
    throw error;
  }
}

/* ---------- Commit ---------- */

async function handleCommit(event) {
  event.preventDefault();
  const message = els.commitMessage.value.trim();
  if (!message) {
    setCommitResult("Commit message is required.", true);
    return;
  }

  els.commitButton.disabled = true;
  setCommitResult("Creating commit...");

  try {
    const payload = await requestJSON("/api/commit", {
      method: "POST",
      body: JSON.stringify({
        message,
        stageAll: els.stageAllCheckbox.checked,
      }),
    });

    els.commitMessage.value = "";
    setCommitResult(`Created ${payload.summary}`);
    state.selectedPath = "";
    state.selectedUntracked = false;
    state.diffMode = "unstaged";
    await loadStatus();
  } catch (error) {
    setCommitResult(error.message, true);
  } finally {
    els.commitButton.disabled = false;
  }
}

/* ---------- Event listeners ---------- */

els.refreshButton.addEventListener("click", () => {
  loadStatus().catch((error) => setFlash(error.message, "error"));
});

els.stageAllButton.addEventListener("click", () => {
  runFileAction("stage", "");
});

els.unstageAllButton.addEventListener("click", () => {
  runFileAction("unstage", "");
});

els.unstagedModeButton.addEventListener("click", () => {
  state.diffMode = "unstaged";
  loadDiff().catch((error) => setFlash(error.message, "error"));
});

els.stagedModeButton.addEventListener("click", () => {
  state.diffMode = "staged";
  loadDiff().catch((error) => setFlash(error.message, "error"));
});

els.commitForm.addEventListener("submit", handleCommit);

/* ---------- Initial load ---------- */

loadStatus().catch((error) => {
  renderDiff("");
  setFlash(error.message, "error");
});
