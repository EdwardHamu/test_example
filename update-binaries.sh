#!/usr/bin/env bash
# Git Bash / Bash 4+: backup-first deployment. Never executes the packaged programs.
set -Eeuo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
SOURCE=""; SOURCE_GIVEN=0
STORE="$ROOT/.binary-backups"
LOCK="$ROOT/.binary-update.lock"
SNAP=""; LOCKED=0; MUTATING=0; DRY_RUN=0; FORCE=0; RESTORE_STAGE=""
declare -a NAMES=() EXISTS=() OLD=() NEW=()

usage() {
  cat <<'HELP'
Usage (run with Git Bash):
  bash update-binaries.sh                         # select source and confirm apply
  bash update-binaries.sh sources                 # list available source folders
  bash update-binaries.sh apply --dry-run [--source DIR]
  bash update-binaries.sh apply [--source DIR]
  bash update-binaries.sh list
  bash update-binaries.sh rollback latest
  bash update-binaries.sh rollback SNAPSHOT_ID [--force]

Without --source, apply scans the current working directory and prompts for a number.
It recognizes immediate child folders containing payloads, or their {app} subfolder.
No newest-version guessing; 0/q cancels. Non-interactive EOF cancels without changes.
Explicit --source skips selection/confirmation for automation.
Only top-level *.exe, *.dll and *.exe.config are copied (case-insensitive).
The destination is always the folder containing this script, not the current cwd.
Close the application before apply/rollback. No EXE is executed; assets are untouched.
Backups and SHA-256 manifests: .binary-backups/snap-*/
Rollback refuses to overwrite files changed after deployment unless --force is given.
Backups are never automatically deleted. No Git add/commit/push is performed.
HELP
}
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
is_payload() {
  case "${1,,}" in *.exe|*.dll|*.exe.config) return 0;; *) return 1;; esac
}
valid_name() {
  [[ -n "$1" && "$1" != *'/'* && "$1" != *'\'* && "$1" != *$'\t'* && "$1" != *$'\n'* && "$1" != *$'\r'* ]] && is_payload "$1"
}
hash() { local v; v=$(sha256sum -- "$1") || return 1; printf '%s' "${v:0:64}"; }
regular_or_absent() { [[ ! -L "$1" && ( ! -e "$1" || -f "$1" ) ]]; }
status() { printf '%s\n' "$1" > "$SNAP/status"; }
lock() {
  [[ ! -L "$LOCK" ]] || fail 'Lock path is a symlink.'
  mkdir -- "$LOCK" 2>/dev/null || fail 'Another operation may be active. Inspect .binary-update.lock; do not remove it while an operation runs.'
  LOCKED=1
  printf 'PID=%s\nSTART=%s\n' "$$" "$(date -u +%FT%TZ)" > "$LOCK/owner.txt"
}
# Validate the entire snapshot before any rollback mutation. Never source its manifest.
load_snapshot() {
  local n ex old new extra
  declare -A seen=()
  NAMES=(); EXISTS=(); OLD=(); NEW=()
  [[ -d "$SNAP" && ! -L "$SNAP" && -d "$SNAP/files" && ! -L "$SNAP/files" && -f "$SNAP/manifest.tsv" && ! -L "$SNAP/manifest.tsv" ]] || return 1
  while IFS=$'\t' read -r n ex old new extra; do
    valid_name "$n" && [[ -z "$extra" && -z "${seen[$n]+x}" && "$new" =~ ^[0-9a-f]{64}$ ]] || return 1
    [[ "$ex" == 0 || "$ex" == 1 ]] || return 1
    if [[ "$ex" == 1 ]]; then
      [[ "$old" =~ ^[0-9a-f]{64}$ && -f "$SNAP/files/$n" && ! -L "$SNAP/files/$n" ]] || return 1
      [[ "$(hash "$SNAP/files/$n")" == "$old" ]] || return 1
    else
      [[ "$old" == '-' ]] || return 1
    fi
    seen[$n]=1; NAMES+=("$n"); EXISTS+=("$ex"); OLD+=("$old"); NEW+=("$new")
  done < "$SNAP/manifest.tsv"
  ((${#NAMES[@]} > 0))
}
# auto=1 restores only journaled targets; manual rollback restores all snapshot targets.
restore() {
  local auto="$1" i n current stage_file
  declare -A selected=()
  load_snapshot || { printf 'Backup verification failed; refusing rollback.\n' >&2; return 1; }
  if [[ "$auto" == 1 ]]; then
    [[ -f "$SNAP/journal.txt" && ! -L "$SNAP/journal.txt" ]] || return 1
    while IFS= read -r n; do selected[$n]=1; done < "$SNAP/journal.txt"
  else
    for n in "${NAMES[@]}"; do selected[$n]=1; done
  fi
  for i in "${!NAMES[@]}"; do
    n=${NAMES[$i]}; [[ -n "${selected[$n]+x}" ]] || continue
    regular_or_absent "$ROOT/$n" || { printf 'Unsafe target: %s\n' "$n" >&2; return 1; }
    if [[ -f "$ROOT/$n" ]]; then
      current=$(hash "$ROOT/$n") || return 1
      if [[ "$current" != "${NEW[$i]}" && !( "${EXISTS[$i]}" == 1 && "$current" == "${OLD[$i]}" ) && "$FORCE" != 1 ]]; then
        printf 'Changed since deployment: %s (save it first, or use rollback --force).\n' "$n" >&2; return 1
      fi
    fi
  done
  RESTORE_STAGE=$(mktemp -d "$ROOT/.binary-restore-XXXXXX") || return 1
  # Prepare all restore copies first, retaining immutable backup originals.
  for i in "${!NAMES[@]}"; do
    n=${NAMES[$i]}; [[ -n "${selected[$n]+x}" && "${EXISTS[$i]}" == 1 ]] || continue
    cp -p -- "$SNAP/files/$n" "$RESTORE_STAGE/$n" || return 1
    [[ "$(hash "$RESTORE_STAGE/$n")" == "${OLD[$i]}" ]] || return 1
  done
  for i in "${!NAMES[@]}"; do
    n=${NAMES[$i]}; [[ -n "${selected[$n]+x}" ]] || continue
    if [[ "${EXISTS[$i]}" == 1 ]]; then
      mv -f -- "$RESTORE_STAGE/$n" "$ROOT/$n" || return 1
      [[ "$(hash "$ROOT/$n")" == "${OLD[$i]}" ]] || return 1
    else
      rm -f -- "$ROOT/$n" || return 1
      [[ ! -e "$ROOT/$n" && ! -L "$ROOT/$n" ]] || return 1
    fi
    printf 'Restored: %s\n' "$n"
  done
  status rolled_back || return 1
  return 0
}
cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  set +e
  if (( rc != 0 && MUTATING == 1 )); then
    printf 'Deployment failed; attempting rollback from %s\n' "$SNAP" >&2
    if restore 1; then
      printf 'Automatic rollback completed.\n' >&2
    else
      status recovery_required
      printf 'ROLLBACK INCOMPLETE. Close the application, preserve backups, then run:\nbash "%s/update-binaries.sh" rollback "%s"\n' "$ROOT" "${SNAP##*/}" >&2
    fi
  fi
  [[ -z "$RESTORE_STAGE" ]] || rm -rf -- "$RESTORE_STAGE"
  if (( LOCKED )); then rm -f -- "$LOCK/owner.txt"; rmdir -- "$LOCK"; fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Discover only immediate child directories and their literal {app} payload folder.
# Never recurse into assets, backup snapshots, or bundled prerequisite installers.
declare -a SOURCES=() SOURCE_COUNTS=()
SCAN_ROOT=$(pwd -P)
SELECTED_INTERACTIVELY=0
payload_count() {
  local dir="$1" f n count=0
  for f in "$dir"/*; do
    [[ -f "$f" && ! -L "$f" ]] || continue
    n=${f##*/}
    if valid_name "$n"; then count=$((count+1)); fi
  done
  printf '%s' "$count"
}
discover_sources() {
  local d candidate count
  SOURCES=(); SOURCE_COUNTS=()
  for d in "$SCAN_ROOT"/*; do
    [[ -d "$d" && ! -L "$d" ]] || continue
    case "${d##*/}" in assets|docs|tests|node_modules|build|dist|target) continue;; esac
    candidate="$d"
    if [[ -d "$d/{app}" && ! -L "$d/{app}" ]]; then candidate="$d/{app}"; fi
    [[ "$candidate" != "$ROOT" ]] || continue
    count=$(payload_count "$candidate")
    if (( count > 0 )); then SOURCES+=("$candidate"); SOURCE_COUNTS+=("$count"); fi
  done
}
show_sources() {
  local i
  printf 'Scan directory: %s\nAvailable source folders:\n' "$SCAN_ROOT"
  for i in "${!SOURCES[@]}"; do
    printf '  %d) %s (%s payload files)\n' "$((i+1))" "${SOURCES[$i]#"$SCAN_ROOT"/}" "${SOURCE_COUNTS[$i]}"
  done
  if ((${#SOURCES[@]} == 0)); then printf '  (none)\n'; fi
}
choose_source() {
  local answer i
  discover_sources; show_sources
  ((${#SOURCES[@]} > 0)) || fail 'No usable source folders found. Change directory or use --source DIR.'
  printf '  0) Cancel\n'
  while true; do
    printf 'Select a folder number (0/q to cancel): '
    if ! IFS= read -r answer; then fail 'No selection received; cancelled. Use --source DIR for unattended runs.'; fi
    answer=${answer%$'\r'}
    case "$answer" in 0|q|Q) printf 'Cancelled; no files changed.\n'; exit 0;; esac
    for i in "${!SOURCES[@]}"; do
      if [[ "$answer" == "$((i+1))" ]]; then
        SOURCE=${SOURCES[$i]}; SELECTED_INTERACTIVELY=1; return
      fi
    done
    printf 'Invalid selection; enter one of the listed numbers.\n'
  done
}

command=${1:-apply}; (($# == 0)) || shift
case "$command" in
  help|-h|--help) usage; exit 0;;
  apply)
    while (($#)); do
      case "$1" in
        --dry-run) DRY_RUN=1; shift;;
        --source) (($# >= 2)) || fail '--source requires a directory'; [[ -n "$2" ]] || fail "--source requires a non-empty directory"; SOURCE=$2; SOURCE_GIVEN=1; shift 2;;
        *) fail "Unknown apply option: $1";;
      esac
    done;;
  rollback)
    (($# >= 1)) || fail 'Specify a snapshot ID or latest.'
    ID=$1; shift
    if (($#)); then [[ "$1" == --force && $# == 1 ]] || fail 'Only --force is allowed after the snapshot ID.'; FORCE=1; fi;;
  sources) (($# == 0)) || fail 'sources accepts no arguments'; discover_sources; show_sources; exit 0;;
  list) (($# == 0)) || fail 'list accepts no arguments';;
  *) usage; fail "Unknown command: $command";;
esac
for tool in sha256sum cp mv mkdir mktemp date; do command -v "$tool" >/dev/null || fail "Missing tool: $tool"; done
[[ ! -L "$STORE" ]] || fail 'Backup directory must not be a symlink.'
if [[ "$command" == list ]]; then
  shopt -s nullglob
  for d in "$STORE"/snap-*; do
    [[ -d "$d" && ! -L "$d" ]] || continue
    s=unknown; [[ ! -f "$d/status" || -L "$d/status" ]] || read -r s < "$d/status"
    printf '%s\t%s\n' "${d##*/}" "$s"
  done
  exit 0
fi
if [[ "$command" == apply && "$SOURCE_GIVEN" == 0 ]]; then choose_source; fi
lock
if [[ "$command" == rollback ]]; then
  if [[ "$ID" == latest ]]; then
    [[ -f "$STORE/latest" && ! -L "$STORE/latest" ]] || fail 'No successful deployment pointer; use list and an explicit snapshot ID.'
    read -r ID < "$STORE/latest"
  fi
  [[ "$ID" =~ ^snap-[A-Za-z0-9_-]+$ ]] || fail 'Invalid snapshot ID.'
  SNAP="$STORE/$ID"
  if [[ -f "$SNAP/status" && ! -L "$SNAP/status" && "$(cat "$SNAP/status")" == rolled_back ]]; then
    printf 'Snapshot already rolled back: %s (no changes).\n' "$ID"; exit 0
  fi
  (( FORCE == 0 )) || printf 'WARNING: --force allows overwriting post-deployment changes.\n' >&2
  restore 0 || fail "Rollback failed or refused. Backup retained: $SNAP"
  printf 'Rollback complete: %s\n' "$ID"
  exit 0
fi
[[ -d "$SOURCE" && ! -L "$SOURCE" ]] || fail "Source directory missing or unsafe: $SOURCE"
SOURCE=$(cd -- "$SOURCE" && pwd -P)
[[ "$SOURCE" != "$ROOT" ]] || fail 'Source and destination are the same directory.'
shopt -s nullglob dotglob
for f in "$SOURCE"/*; do
  n=${f##*/}; is_payload "$n" || continue
  valid_name "$n" || fail "Unsupported filename: $n"
  [[ -f "$f" && ! -L "$f" ]] || fail "Source is not a regular file: $n"
  regular_or_absent "$ROOT/$n" || fail "Destination is not a regular file: $n"
  NAMES+=("$n")
done
((${#NAMES[@]} > 0)) || fail 'No EXE, DLL or EXE.config files found.'
printf 'Source: %s\nDestination: %s\nClose the application before proceeding.\n' "$SOURCE" "$ROOT"
for n in "${NAMES[@]}"; do
  if [[ -f "$ROOT/$n" ]]; then printf 'REPLACE %s\n' "$n"; else printf 'ADD     %s\n' "$n"; fi
done
if (( DRY_RUN )); then printf 'Dry run: no program files or backups changed.\n'; exit 0; fi
if (( SELECTED_INTERACTIVELY )); then
  printf 'Back up and replace the listed files? Close the app first. [y/N]: '
  if ! IFS= read -r answer; then fail 'No confirmation received; cancelled.'; fi
  answer=${answer%$'\r'}
  case "$answer" in y|Y|yes|YES) ;; *) printf 'Cancelled; no program files or backups changed.\n'; exit 0;; esac
fi
mkdir -p -- "$STORE"
SNAP=$(mktemp -d "$STORE/snap-$(date -u +%Y%m%d-%H%M%S)-XXXXXX")
mkdir -- "$SNAP/files" "$SNAP/stage"
printf '%s\n' "$SOURCE" > "$SNAP/source.txt"
: > "$SNAP/manifest.tsv"; : > "$SNAP/journal.txt"; status preparing
for n in "${NAMES[@]}"; do
  ex=0; old=-
  if [[ -f "$ROOT/$n" ]]; then
    ex=1; old=$(hash "$ROOT/$n")
    cp -p -- "$ROOT/$n" "$SNAP/files/$n"
    [[ "$(hash "$SNAP/files/$n")" == "$old" ]] || fail "Backup checksum mismatch: $n"
  fi
  expected=$(hash "$SOURCE/$n")
  cp -p -- "$SOURCE/$n" "$SNAP/stage/$n"
  new=$(hash "$SNAP/stage/$n")
  [[ "$new" == "$expected" ]] || fail "Source changed during staging: $n"
  printf '%s\t%s\t%s\t%s\n' "$n" "$ex" "$old" "$new" >> "$SNAP/manifest.tsv"
done
load_snapshot || fail 'Snapshot verification failed; no destination files replaced.'
status prepared
printf 'Verified backup: %s\n' "$SNAP"
# Each file is replaced via a same-volume rename; the whole set is NOT an atomic transaction.
for i in "${!NAMES[@]}"; do
  n=${NAMES[$i]}
  regular_or_absent "$ROOT/$n" || fail "Unsafe destination: $n"
  if [[ "${EXISTS[$i]}" == 1 ]]; then
    [[ -f "$ROOT/$n" && "$(hash "$ROOT/$n")" == "${OLD[$i]}" ]] || fail "Destination changed after backup: $n"
  else
    [[ ! -e "$ROOT/$n" ]] || fail "Destination appeared after backup: $n"
  fi
  # Write ahead: an interruption between the journal and rename is safe to recover.
  printf '%s\n' "$n" >> "$SNAP/journal.txt"
  MUTATING=1
  status applying
  mv -f -- "$SNAP/stage/$n" "$ROOT/$n"
  [[ "$(hash "$ROOT/$n")" == "${NEW[$i]}" ]] || fail "Installed checksum mismatch: $n"
  printf 'Installed: %s\n' "$n"
done
status applied
printf '%s\n' "${SNAP##*/}" > "$STORE/latest.tmp"
mv -f -- "$STORE/latest.tmp" "$STORE/latest"
MUTATING=0
printf 'Deployment complete. Backup ID: %s\nRollback: bash "%s/update-binaries.sh" rollback "%s"\n' "${SNAP##*/}" "$ROOT" "${SNAP##*/}"
