package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

//go:embed assets/index.html assets/css/app.css assets/js/app.js assets/vendor/primer.css
var embeddedAssets embed.FS

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default: // linux, freebsd, etc.
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		log.Printf("failed to open browser: %v", err)
	}
}

func resolveListenURL(addr string) string {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Sprintf("http://localhost%s", addr)
	}
	if host == "" || host == "0.0.0.0" {
		host = "localhost"
	}
	return fmt.Sprintf("http://%s:%s", host, port)
}

func main() {
	addr := flag.String("addr", ":8080", "HTTP listen address")
	repo := flag.String("repo", "", "path to the git repository to manage")
	noBrowser := flag.Bool("no-browser", false, "do not open browser on startup")
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

	listenURL := resolveListenURL(*addr)
	log.Printf("browser-git listening on %s for repo %s", *addr, absRepoPath)

	if !*noBrowser {
		go openBrowser(listenURL)
	}

	if err := http.ListenAndServe(*addr, server.routes()); err != nil {
		log.Fatalf("listen: %v", err)
	}
}
