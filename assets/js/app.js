const state = {
  status: null,
  selectedPath: "",
  selectedUntracked: false,
  diffMode: "unstaged",
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
  statusFlash: document.getElementById("statusFlash"),
  selectionHint: document.getElementById("selectionHint"),
  refreshButton: document.getElementById("refreshButton"),
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

function renderStatus(status) {
  state.status = status;

  els.branchName.textContent = status.currentBranch || "(detached HEAD)";
  els.repoRoot.textContent = status.repoRoot;
  els.changedCount.textContent = String(status.files.length);
  els.stagedCount.textContent = String(status.stagedCount);
  els.unstagedCount.textContent = String(status.unstagedCount);
  els.selectionHint.textContent = status.files.length
    ? "Select a file to inspect its diff."
    : "Working tree is clean.";

  if (!status.files.some((file) => file.path === state.selectedPath)) {
    state.selectedPath = "";
    state.selectedUntracked = false;
  }

  renderFileList(status.files);
}

function renderFileList(files) {
  if (!files.length) {
    els.fileList.innerHTML = '<li class="file-item"><div class="file-button"><span class="file-path">No local changes</span></div></li>';
    return;
  }

  els.fileList.innerHTML = files
    .map((file) => {
      const selected = file.path === state.selectedPath ? "selected" : "";
      const tagClass = file.label.toLowerCase();
      const meta = [];
      if (file.staged) meta.push('<span class="meta-pill">Staged</span>');
      if (file.unstaged && !file.untracked) meta.push('<span class="meta-pill">Unstaged</span>');
      if (file.untracked) meta.push('<span class="meta-pill">New file</span>');

      return `
        <li class="file-item">
          <button
            class="file-button ${selected}"
            type="button"
            data-path="${escapeHtml(file.path)}"
            data-untracked="${file.untracked ? "1" : "0"}"
          >
            <div class="file-row">
              <span class="file-path">${escapeHtml(file.displayPath)}</span>
              <span class="status-tag ${tagClass}">${escapeHtml(file.label)}</span>
            </div>
            <div class="status-meta">${meta.join("")}</div>
          </button>
        </li>
      `;
    })
    .join("");

  els.fileList.querySelectorAll(".file-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedPath = button.dataset.path || "";
      state.selectedUntracked = button.dataset.untracked === "1";
      loadDiff().catch((error) => setFlash(error.message, "error"));
      renderFileList(state.status.files);
    });
  });
}

function renderDiff(diffText) {
  if (!diffText) {
    els.diffOutput.innerHTML = '<span class="diff-line empty">No diff output for the current selection.</span>';
    return;
  }

  const lines = diffText.split("\n").map((line) => {
    let className = "diff-line";
    if (line.startsWith("@@")) {
      className += " hunk";
    } else if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) {
      className += " meta";
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      className += " add";
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      className += " remove";
    }

    return `<span class="${className}">${escapeHtml(line)}</span>`;
  });

  els.diffOutput.innerHTML = lines.join("");
}

function updateModeButtons() {
  const staged = state.diffMode === "staged";
  els.stagedModeButton.classList.toggle("selected", staged);
  els.unstagedModeButton.classList.toggle("selected", !staged);
}

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

els.refreshButton.addEventListener("click", () => {
  loadStatus().catch((error) => setFlash(error.message, "error"));
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

loadStatus().catch((error) => {
  renderDiff("");
  setFlash(error.message, "error");
});
