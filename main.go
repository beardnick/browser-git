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

func listenURL(listener net.Listener) string {
	addr := listener.Addr().(*net.TCPAddr)
	host := addr.IP.String()
	if host == "0.0.0.0" || host == "::" {
		host = "localhost"
	}
	return fmt.Sprintf("http://%s:%d", host, addr.Port)
}

func main() {
	addr := flag.String("addr", ":0", "HTTP listen address (default: random available port)")
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

	// Use net.Listen to bind the port first, so we know the actual port
	// before starting the HTTP server (especially important for :0).
	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		log.Fatalf("listen: %v", err)
	}

	url := listenURL(ln)
	log.Printf("browser-git listening on %s for repo %s", url, absRepoPath)

	if !*noBrowser {
		go openBrowser(url)
	}

	if err := http.Serve(ln, server.routes()); err != nil {
		log.Fatalf("serve: %v", err)
	}
}
