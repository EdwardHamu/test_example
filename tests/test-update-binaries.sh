#!/usr/bin/env bash
# Offline tests using disposable text fixtures with binary-like extensions.
set -Eeuo pipefail
SCRIPT=${1:-"$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/update-binaries.sh"}
SCRIPT=$(cd -- "$(dirname -- "$SCRIPT")" && pwd)/$(basename -- "$SCRIPT")
TMP=$(mktemp -d)
trap 'rm -rf -- "$TMP"' EXIT
COUNT=0
ok() { COUNT=$((COUNT+1)); printf 'PASS %s\n' "$1"; }
fixture() {
  ROOT="$TMP/$1 project space"
  SRC="$ROOT/ArenaModelProbe-2026.9.17.8-x64-extracted/{app}"
  mkdir -p "$SRC/assets" "$ROOT/assets"
  cp -- "$SCRIPT" "$ROOT/update-binaries.sh"
  printf old-exe > "$ROOT/中文应用.exe"
  printf old-dll > "$ROOT/a.dll"
  printf old-config > "$ROOT/中文应用.exe.config"
  printf new-exe > "$SRC/中文应用.exe"
  printf new-dll > "$SRC/a.dll"
  printf new-config > "$SRC/中文应用.exe.config"
  printf new-only > "$SRC/NEW.DLL"
  printf untouched > "$ROOT/assets/a.js"
  printf do-not-copy > "$SRC/assets/a.js"
  printf do-not-copy > "$SRC/notes.txt"
}
run() {
  if [[ "${1:-}" == apply && " $* " != *" --source "* ]]; then bash "$ROOT/update-binaries.sh" "$@" --source "$SRC" > "$TMP/log" 2>&1;
  else bash "$ROOT/update-binaries.sh" "$@" > "$TMP/log" 2>&1; fi
}
fixture normal
run apply --dry-run
[[ $(cat "$ROOT/a.dll") == old-dll && ! -e "$ROOT/.binary-backups" && ! -e "$ROOT/.binary-update.lock" ]]
ok 'dry run does not change payloads or create backups'
(cd / && bash "$ROOT/update-binaries.sh" apply --source "$SRC" > "$TMP/log" 2>&1)
[[ $(cat "$ROOT/a.dll") == new-dll && $(cat "$ROOT/中文应用.exe.config") == new-config && -f "$ROOT/NEW.DLL" ]]
[[ $(cat "$ROOT/assets/a.js") == untouched && ! -e "$ROOT/notes.txt" ]]
ID=$(cat "$ROOT/.binary-backups/latest")
[[ $(cat "$ROOT/.binary-backups/$ID/files/a.dll") == old-dll ]]
ok 'apply handles spaces/Chinese names/configs and ignores nested assets'
run list; grep -q "$ID" "$TMP/log"
ok 'list exposes snapshot ID'
run rollback latest
[[ $(cat "$ROOT/a.dll") == old-dll && $(cat "$ROOT/中文应用.exe") == old-exe && ! -e "$ROOT/NEW.DLL" ]]
[[ -f "$ROOT/.binary-backups/$ID/files/a.dll" ]]
run rollback "$ID"
ok 'rollback restores originals, deletes only added payloads and is idempotent'
fixture changed
run apply
printf user-change > "$ROOT/a.dll"
if run rollback latest; then echo 'Expected modified-file refusal' >&2; exit 1; fi
[[ $(cat "$ROOT/a.dll") == user-change && $(cat "$ROOT/中文应用.exe") == new-exe ]]
run rollback latest --force
[[ $(cat "$ROOT/a.dll") == old-dll ]]
ok 'rollback refuses later edits unless force is explicitly provided'
fixture corrupt
run apply; ID=$(cat "$ROOT/.binary-backups/latest")
printf broken > "$ROOT/.binary-backups/$ID/files/a.dll"
if run rollback latest --force; then echo 'Expected corrupt-backup refusal' >&2; exit 1; fi
[[ $(cat "$ROOT/a.dll") == new-dll ]]
ok 'backup hash mismatch blocks rollback even with force'
fixture lock
mkdir "$ROOT/.binary-update.lock"
if run apply; then echo 'Expected lock refusal' >&2; exit 1; fi
[[ $(cat "$ROOT/a.dll") == old-dll ]]
ok 'existing lock prevents concurrent deployment'
fixture manifest
run apply; ID=$(cat "$ROOT/.binary-backups/latest")
printf '../bad.exe\t0\t-\t%s\n' "$(printf '%064d' 0)" >> "$ROOT/.binary-backups/$ID/manifest.tsv"
if run rollback latest; then echo 'Expected invalid-manifest refusal' >&2; exit 1; fi
[[ $(cat "$ROOT/a.dll") == new-dll ]]
ok 'manifest traversal is rejected'
fixture failure
REAL_MV=$(command -v mv)
mkdir "$TMP/shims"
cat > "$TMP/shims/mv" <<'SHIM'
#!/usr/bin/env bash
for arg in "$@"; do
  if [[ "$arg" == */stage/a.dll && ! -e "$FAIL_MARK" ]]; then
    : > "$FAIL_MARK"
    exit 23
  fi
done
exec "$REAL_MV" "$@"
SHIM
chmod +x "$TMP/shims/mv"
if PATH="$TMP/shims:$PATH" REAL_MV="$REAL_MV" FAIL_MARK="$TMP/failed" bash "$ROOT/update-binaries.sh" apply --source "$SRC" > "$TMP/log" 2>&1; then
  echo 'Expected simulated replacement failure' >&2; exit 1
fi
[[ -f "$TMP/failed" && $(cat "$ROOT/a.dll") == old-dll && $(cat "$ROOT/中文应用.exe") == old-exe && ! -e "$ROOT/NEW.DLL" ]]
grep -q 'Automatic rollback completed' "$TMP/log"
[[ ! -e "$ROOT/.binary-update.lock" ]]
ok 'partial deployment failure automatically rolls back and releases lock'
fixture missing
if run apply --source "$ROOT/missing"; then echo 'Expected missing-source refusal' >&2; exit 1; fi
if run apply --source "$ROOT"; then echo 'Expected same-source refusal' >&2; exit 1; fi
[[ ! -e "$ROOT/.binary-backups" ]]
ok 'missing or same-as-target source is rejected'
fixture selection
NEW_SRC="$ROOT/Z 新版 package/{app}"
mkdir -p "$NEW_SRC/assets" "$ROOT/.binary-backups/snap-fake/files" "$ROOT/assets/ignored"
printf latest-dll > "$NEW_SRC/a.dll"
printf do-not-copy > "$ROOT/.binary-backups/snap-fake/files/backup.dll"
printf ignored > "$ROOT/assets/ignore.dll"
(cd "$ROOT" && bash update-binaries.sh sources > "$TMP/log" 2>&1)
grep -q '1).*2026.9.17.8.*4 payload files' "$TMP/log"
grep -q '2).*Z 新版 package.*1 payload files' "$TMP/log"
[[ $(grep -c 'payload files)' "$TMP/log") == 2 ]]
ok 'discovery lists multiple packages and excludes assets and backups'
(cd "$ROOT" && printf 'bad\n999999999999999999999999\n2\n' | bash update-binaries.sh apply --dry-run > "$TMP/log" 2>&1)
grep -q 'Invalid selection' "$TMP/log"; grep -q "Source: $NEW_SRC" "$TMP/log"
[[ $(cat "$ROOT/a.dll") == old-dll && ! -e "$ROOT/.binary-update.lock" && ! -e "$ROOT/.binary-backups/latest" ]]
ok 'invalid selections retry safely and chosen-source dry run does not deploy'
(cd "$ROOT" && printf 'q\n' | bash update-binaries.sh > "$TMP/log" 2>&1)
[[ $(cat "$ROOT/a.dll") == old-dll && ! -e "$ROOT/.binary-update.lock" ]]
ok 'menu cancel leaves files and lock untouched'
if (cd "$ROOT" && bash update-binaries.sh apply </dev/null > "$TMP/log" 2>&1); then echo 'Expected EOF refusal' >&2; exit 1; fi
[[ $(cat "$ROOT/a.dll") == old-dll && ! -e "$ROOT/.binary-update.lock" ]]
ok 'EOF never auto-selects a source'
(cd "$ROOT" && printf '2\nn\n' | bash update-binaries.sh > "$TMP/log" 2>&1)
[[ $(cat "$ROOT/a.dll") == old-dll && ! -e "$ROOT/.binary-backups/latest" && ! -e "$ROOT/.binary-update.lock" ]]
ok 'declining confirmation creates no backup or replacement'
if (cd "$ROOT" && printf '2\n' | bash update-binaries.sh > "$TMP/log" 2>&1); then echo 'Expected confirmation EOF refusal' >&2; exit 1; fi
[[ $(cat "$ROOT/a.dll") == old-dll && ! -e "$ROOT/.binary-backups/latest" && ! -e "$ROOT/.binary-update.lock" ]]
ok 'EOF at confirmation cancels and releases lock'
(cd "$ROOT" && printf '2\ny\n' | bash update-binaries.sh > "$TMP/log" 2>&1)
[[ $(cat "$ROOT/a.dll") == latest-dll && $(cat "$ROOT/中文应用.exe") == old-exe ]]
ID=$(cat "$ROOT/.binary-backups/latest")
[[ $(cat "$ROOT/.binary-backups/$ID/source.txt") == "$NEW_SRC" ]]
run rollback latest
[[ $(cat "$ROOT/a.dll") == old-dll ]]
ok 'default invocation deploys only selected payloads after confirmation and can roll back'
mkdir -p "$TMP/scan elsewhere/Direct files" "$TMP/scan elsewhere/No binaries" "$TMP/empty"
printf direct > "$TMP/scan elsewhere/Direct files/a.DLL"
(cd "$TMP/scan elsewhere" && bash "$ROOT/update-binaries.sh" sources > "$TMP/log" 2>&1)
grep -q 'Direct files (1 payload files)' "$TMP/log"
[[ $(grep -c 'payload files)' "$TMP/log") == 1 ]]
(cd "$TMP/scan elsewhere" && printf '1\n' | bash "$ROOT/update-binaries.sh" apply --dry-run > "$TMP/log" 2>&1)
grep -q "Destination: $ROOT" "$TMP/log"
ok 'scan uses current working directory; direct payload folders work and target stays script directory'
if (cd "$TMP/empty" && bash "$ROOT/update-binaries.sh" apply </dev/null > "$TMP/log" 2>&1); then echo 'Expected no-source refusal' >&2; exit 1; fi
grep -q 'No usable source folders' "$TMP/log"
[[ $(cat "$ROOT/a.dll") == old-dll && ! -e "$ROOT/.binary-update.lock" ]]
ok 'empty discovery fails without falling back to an old hard-coded source'
printf '%s test groups passed. Only temporary fixture files were modified.\n' "$COUNT"
