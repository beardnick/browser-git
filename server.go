package main

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"strings"
)

type server struct {
	git    *gitRunner
	assets fs.FS
}

func NewServer(repoPath string, assets fs.FS) (*server, error) {
	git, err := newGitRunner(repoPath)
	if err != nil {
		return nil, err
	}
	return &server{
		git:    git,
		assets: assets,
	}, nil
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/status", s.handleStatus)
	mux.HandleFunc("/api/diff", s.handleDiff)
	mux.HandleFunc("/api/commit", s.handleCommit)
	mux.Handle("/css/", http.FileServer(http.FS(s.assets)))
	mux.Handle("/js/", http.FileServer(http.FS(s.assets)))
	mux.Handle("/vendor/", http.FileServer(http.FS(s.assets)))
	mux.HandleFunc("/", s.handleIndex)
	return mux
}

func (s *server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}

	data, err := fs.ReadFile(s.assets, "index.html")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(data)
}

func (s *server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	status, err := s.git.Status()
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, status)
}

func (s *server) handleDiff(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	path := strings.TrimSpace(r.URL.Query().Get("path"))
	staged := r.URL.Query().Get("staged") == "1"
	untracked := r.URL.Query().Get("untracked") == "1"

	diff, err := s.git.Diff(path, staged, untracked)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"diff": diff})
}

func (s *server) handleCommit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req CommitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	resp, err := s.git.Commit(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
