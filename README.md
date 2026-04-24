# Browser Git

A browser-based Git client served by Go, with embedded static assets and a GitHub-style UI built on a vendored copy of Primer CSS.

## Features

- Browse changed files in the current repository.
- Inspect unstaged and staged diffs from the browser.
- Create commits from the UI, optionally staging all changes first.
- Ship as a single Go binary with frontend assets embedded via `embed`.

## Run

```bash
go run . -repo /path/to/git/repo
```

If `-repo` is omitted, the server manages the current working directory.

The app listens on `:8080` by default:

```bash
go run . -addr :8080
```

Then open `http://127.0.0.1:8080`.

## Notes

- UI styling uses a vendored copy of `@primer/css` from GitHub's Primer design system in [assets/vendor/primer.css](/media/qianz/linux_data/data/browser-git/assets/vendor/primer.css).
- The backend shells out to the local `git` binary, so Git must be installed and available on `PATH`.
