package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const gitTimeout = 15 * time.Second

type RepoStatus struct {
	RepoRoot      string       `json:"repoRoot"`
	CurrentBranch string       `json:"currentBranch"`
	Clean         bool         `json:"clean"`
	StagedCount   int          `json:"stagedCount"`
	UnstagedCount int          `json:"unstagedCount"`
	Files         []StatusFile `json:"files"`
}

type StatusFile struct {
	Path           string `json:"path"`
	OriginalPath   string `json:"originalPath,omitempty"`
	DisplayPath    string `json:"displayPath"`
	IndexStatus    string `json:"indexStatus"`
	WorktreeStatus string `json:"worktreeStatus"`
	Staged         bool   `json:"staged"`
	Unstaged       bool   `json:"unstaged"`
	Untracked      bool   `json:"untracked"`
	Renamed        bool   `json:"renamed"`
	Deleted        bool   `json:"deleted"`
	Label          string `json:"label"`
}

type CommitRequest struct {
	Message  string `json:"message"`
	StageAll bool   `json:"stageAll"`
}

type CommitResponse struct {
	Summary string `json:"summary"`
	Output  string `json:"output"`
}

type gitRunner struct {
	repoPath string
}

func newGitRunner(repoPath string) (*gitRunner, error) {
	info, err := os.Stat(repoPath)
	if err != nil {
		return nil, fmt.Errorf("stat repo path: %w", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("repo path is not a directory: %s", repoPath)
	}
	return &gitRunner{repoPath: repoPath}, nil
}

func (g *gitRunner) Status() (RepoStatus, error) {
	root, err := g.git("rev-parse", "--show-toplevel")
	if err != nil {
		return RepoStatus{}, err
	}
	branch, err := g.git("branch", "--show-current")
	if err != nil {
		return RepoStatus{}, err
	}
	porcelain, err := g.gitBytes("status", "--porcelain=v1", "-z")
	if err != nil {
		return RepoStatus{}, err
	}

	files, err := parsePorcelainV1(porcelain)
	if err != nil {
		return RepoStatus{}, err
	}

	var stagedCount, unstagedCount int
	for _, file := range files {
		if file.Staged {
			stagedCount++
		}
		if file.Unstaged || file.Untracked {
			unstagedCount++
		}
	}

	return RepoStatus{
		RepoRoot:      root,
		CurrentBranch: branch,
		Clean:         len(files) == 0,
		StagedCount:   stagedCount,
		UnstagedCount: unstagedCount,
		Files:         files,
	}, nil
}

func (g *gitRunner) Diff(path string, staged bool, untracked bool) (string, error) {
	if path == "" {
		if staged {
			return g.git("diff", "--cached")
		}
		return g.git("diff")
	}

	resolved, err := g.resolvePath(path)
	if err != nil {
		return "", err
	}

	if untracked && !staged {
		return g.diffUntracked(path, resolved)
	}

	args := []string{"diff"}
	if staged {
		args = append(args, "--cached")
	}
	args = append(args, "--", path)
	return g.git(args...)
}

func (g *gitRunner) Commit(req CommitRequest) (CommitResponse, error) {
	message := strings.TrimSpace(req.Message)
	if message == "" {
		return CommitResponse{}, errors.New("commit message is required")
	}

	if req.StageAll {
		if _, err := g.git("add", "-A"); err != nil {
			return CommitResponse{}, err
		}
	}

	output, err := g.git("commit", "-m", message)
	if err != nil {
		return CommitResponse{}, err
	}

	summary, err := g.git("log", "-1", "--oneline")
	if err != nil {
		return CommitResponse{}, err
	}

	return CommitResponse{
		Summary: summary,
		Output:  output,
	}, nil
}

func (g *gitRunner) git(args ...string) (string, error) {
	out, err := g.gitBytes(args...)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func (g *gitRunner) gitBytes(args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), gitTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", g.repoPath}, args...)...)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		return nil, fmt.Errorf("git command timed out: git %s", strings.Join(args, " "))
	}
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = strings.TrimSpace(stdout.String())
		}
		if msg == "" {
			msg = err.Error()
		}
		return nil, fmt.Errorf("git %s: %s", strings.Join(args, " "), msg)
	}

	return stdout.Bytes(), nil
}

func (g *gitRunner) diffUntracked(repoRelativePath string, absPath string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), gitTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "git", "-C", g.repoPath, "diff", "--no-index", "--", "/dev/null", absPath)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		return "", fmt.Errorf("git diff for untracked file timed out")
	}

	if err == nil {
		return normalizeUntrackedDiff(strings.TrimSpace(stdout.String()), repoRelativePath), nil
	}

	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) && exitErr.ExitCode() == 1 {
		return normalizeUntrackedDiff(strings.TrimSpace(stdout.String()), repoRelativePath), nil
	}

	msg := strings.TrimSpace(stderr.String())
	if msg == "" {
		msg = err.Error()
	}
	return "", fmt.Errorf("git diff --no-index: %s", msg)
}

func normalizeUntrackedDiff(diff string, repoRelativePath string) string {
	if diff == "" {
		return ""
	}

	lines := strings.Split(diff, "\n")
	for i, line := range lines {
		switch {
		case strings.HasPrefix(line, "diff --git "):
			lines[i] = fmt.Sprintf("diff --git a/%s b/%s", repoRelativePath, repoRelativePath)
		case strings.HasPrefix(line, "+++ "):
			lines[i] = fmt.Sprintf("+++ b/%s", repoRelativePath)
		}
	}

	return strings.Join(lines, "\n")
}

func (g *gitRunner) resolvePath(path string) (string, error) {
	if filepath.IsAbs(path) {
		return "", errors.New("absolute paths are not allowed")
	}

	cleaned := filepath.Clean(path)
	full := filepath.Join(g.repoPath, cleaned)
	abs, err := filepath.Abs(full)
	if err != nil {
		return "", fmt.Errorf("resolve file path: %w", err)
	}

	rel, err := filepath.Rel(g.repoPath, abs)
	if err != nil {
		return "", fmt.Errorf("check file path: %w", err)
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", errors.New("path escapes repository root")
	}
	return abs, nil
}

func parsePorcelainV1(data []byte) ([]StatusFile, error) {
	parts := bytes.Split(data, []byte{0})
	files := make([]StatusFile, 0, len(parts))

	for i := 0; i < len(parts); i++ {
		part := parts[i]
		if len(part) == 0 {
			continue
		}
		if len(part) < 3 {
			return nil, fmt.Errorf("unexpected porcelain entry: %q", string(part))
		}

		xy := string(part[:2])
		path := string(part[3:])
		originalPath := ""
		if xy[0] == 'R' || xy[0] == 'C' {
			if i+1 >= len(parts) {
				return nil, fmt.Errorf("missing original path for rename/copy entry")
			}
			i++
			originalPath = string(parts[i])
		}

		file := StatusFile{
			Path:           path,
			OriginalPath:   originalPath,
			DisplayPath:    path,
			IndexStatus:    string(xy[0]),
			WorktreeStatus: string(xy[1]),
			Staged:         xy[0] != ' ' && xy[0] != '?',
			Unstaged:       xy[1] != ' ',
			Untracked:      xy == "??",
			Renamed:        xy[0] == 'R' || xy[1] == 'R' || xy[0] == 'C' || xy[1] == 'C',
			Deleted:        xy[0] == 'D' || xy[1] == 'D',
			Label:          statusLabel(xy),
		}
		if file.Untracked {
			file.Unstaged = true
		}
		if originalPath != "" {
			file.DisplayPath = fmt.Sprintf("%s -> %s", originalPath, path)
		}

		files = append(files, file)
	}

	return files, nil
}

func statusLabel(xy string) string {
	switch {
	case xy == "??":
		return "Untracked"
	case strings.Contains(xy, "U"):
		return "Conflict"
	case strings.Contains(xy, "R"):
		return "Renamed"
	case strings.Contains(xy, "C"):
		return "Copied"
	case strings.Contains(xy, "D"):
		return "Deleted"
	case strings.Contains(xy, "A"):
		return "Added"
	case strings.Contains(xy, "M"):
		return "Modified"
	default:
		return "Changed"
	}
}
