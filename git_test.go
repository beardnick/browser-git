package main

import "testing"

func TestParsePorcelainV1(t *testing.T) {
	data := []byte(" M assets/js/app.js\x00A  go.mod\x00?? README.md\x00R  assets/next.js\x00assets/old.js\x00")

	files, err := parsePorcelainV1(data)
	if err != nil {
		t.Fatalf("parsePorcelainV1 returned error: %v", err)
	}

	if len(files) != 4 {
		t.Fatalf("expected 4 files, got %d", len(files))
	}

	if !files[0].Unstaged || files[0].Label != "Modified" {
		t.Fatalf("unexpected first file: %+v", files[0])
	}

	if !files[1].Staged || files[1].Label != "Added" {
		t.Fatalf("unexpected second file: %+v", files[1])
	}

	if !files[2].Untracked || files[2].DisplayPath != "README.md" {
		t.Fatalf("unexpected third file: %+v", files[2])
	}

	if !files[3].Renamed || files[3].OriginalPath != "assets/old.js" || files[3].DisplayPath != "assets/old.js -> assets/next.js" {
		t.Fatalf("unexpected fourth file: %+v", files[3])
	}
}

func TestNormalizeUntrackedDiff(t *testing.T) {
	raw := "diff --git a/tmp/example/new.txt b/tmp/example/new.txt\nnew file mode 100644\nindex 0000000..fa49b07\n--- /dev/null\n+++ b/tmp/example/new.txt\n@@ -0,0 +1 @@\n+new file"
	got := normalizeUntrackedDiff(raw, "new.txt")

	if got == raw {
		t.Fatalf("expected normalized diff to change")
	}

	if want := "diff --git a/new.txt b/new.txt"; got[:len(want)] != want {
		t.Fatalf("unexpected diff header: %q", got)
	}
}
