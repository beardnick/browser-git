package main

import (
	"embed"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
)

//go:embed assets/index.html assets/css/app.css assets/js/app.js assets/vendor/primer.css
var embeddedAssets embed.FS

func main() {
	addr := flag.String("addr", ":8080", "HTTP listen address")
	repo := flag.String("repo", "", "path to the git repository to manage")
	flag.Parse()

	repoPath := *repo
	if repoPath == "" {
		cwd, err := os.Getwd()
		if err != nil {
			log.Fatalf("get working directory: %v", err)
		}
		repoPath = cwd
	}

	absRepoPath, err := filepath.Abs(repoPath)
	if err != nil {
		log.Fatalf("resolve repo path: %v", err)
	}

	assets, err := fs.Sub(embeddedAssets, "assets")
	if err != nil {
		log.Fatalf("load embedded assets: %v", err)
	}

	server, err := NewServer(absRepoPath, assets)
	if err != nil {
		log.Fatalf("create server: %v", err)
	}

	log.Printf("browser-git listening on %s for repo %s", *addr, absRepoPath)
	if err := http.ListenAndServe(*addr, server.routes()); err != nil {
		log.Fatalf("listen: %v", err)
	}
}
