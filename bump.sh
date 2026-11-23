#!/bin/sh
# One release number for both apps, in every place it appears. Run it from the repo root:
#
#   sh bump.sh 3.1            set the release to 3.1, then check
#   sh bump.sh --major 4.0    the same, for a new first number
#   sh bump.sh --check        change nothing: only run the checks on the files as they are
#
# Overload (the training app, in the repo root) and Fuel (the diet app, in fuel/) are always released
# together under one number. A release number is two whole numbers with a dot, like 3.1: no leading zero
# (3.01 is refused), no third part. It must be higher than the current one, compared number by number
# (3.10 comes after 3.9), the way the start-up rescue in both pages compares them. A new first number needs
# --major: the rescue only falls back to an older release with the same first number, so a phone whose
# update to 4.0 arrives only half has nothing to fall back to.
# For a new number this script changes:
#   - the ?v= on every file address in index.html, sw.js, fuel/index.html and fuel/sw.js;
#   - VERSION in overload.js and in fuel/fuel.js (a line  const VERSION = '3.0';  in each), and the release
#     in sync.js, backup.js and connector.js (a line  release: '3.0',  in window.__overloadSync,
#     window.__overloadBackup and window.__overloadConn: overload.js uses no such module of another release);
#   - the first line  /* release 3.0 ... */  of every other file with ?v= in a worker's install list (scripts
#     and stylesheets of both apps and shared/): the workers store and run such a file only when it names the
#     release of its address;
#   - both offline cache names by one step: overload-vN in sw.js and fuel-vN in fuel/sw.js. Both, also when
#     only one app changed: a worker file that did not change is never installed again, and a page with a
#     new ?v= cannot be stored by a worker that still expects the old one.
# Then it checks, and fails loudly (exit code 1) when:
#   - a ?v= with another number is left in those four files, or a VERSION, the release in sync.js, backup.js
#     or connector.js or the first line of another versioned file differs, or one of these marks is not there
#     exactly once;
#   - sw.js or fuel/sw.js differs from the published one (origin/main: GitHub Pages serves main) while its
#     cache name is the same: phones would install the changed worker into the cache the running one serves
#     from. Skipped where git or origin/main is not there, and for a worker that is new since then;
#   - the release was published before (VERSION in overload.js of a commit on origin/main's own line, the
#     newest such commit: after a roll-back to an older release, phones that had this one still keep it) and a
#     page, a file with ?v= in an install list or a worker under the same cache name differs from that copy: a
#     phone that has the release keeps its stored copies of the ?v= files for the whole release and runs them
#     under the new page. Skipped like the check above, and for the page and files of a worker that is new
#     since then (no phone stored them). Before these two it fetches origin/main (a pull request merged on
#     GitHub is published too; BUMP_NO_FETCH=1 compares with the copy here as it is), and it names the
#     published commit and release it compared with;
#   - app.js, styles.css or food.js is at the root: v2.8's page asks the server for these names, and its
#     worker would run (and store) whatever answers there in the v2.8 page;
#   - a file in a worker's install list (ASSETS in sw.js and fuel/sw.js, one address per line) is not on
#     disk: that install fails on every phone, and nobody gets the release. In a git repository (run from its
#     root), also when such a file, a page or a worker is not tracked by git: the published site would not
#     have it. Files among them with changes that are not committed yet are named (a warning, not a failure);
#   - a page loads a versioned file that its worker's install list does not name: the file would be missing
#     when the app starts with no signal;
#   - the food list's ?db= differs between fuel/food.js and fuel/sw.js: food search would stop working
#     offline. (This script never changes ?db=; that number moves by hand when the food list is rebuilt, and
#     then the release moves on too: sh bump.sh <next release>.)
# A file of the diet app that does not exist is skipped and named, so the script also works on a tree where
# fuel/ is not complete. Commit the result.
#
# Every change to a file the workers store needs a new number: a worker answers an address with ?v= from its
# own stored copy for the whole release and never asks the server for it again. (The pages are not stored that
# way: a phone takes a changed page from the server and runs it with its old copies of the other files.)

set -f   # no file name expansion: the words handled below hold "?"

FAILED=0
SKIPPED=""
say()  { printf '%s\n' "$*"; }
fail() { printf 'bump.sh: FAILED: %s\n' "$*" >&2; FAILED=1; }
die()  { printf 'bump.sh: %s\n' "$*" >&2; exit 1; }

# Is the file there? If not, remember it as skipped.
have() {
  [ -f "$1" ] && return 0
  case " $SKIPPED " in *" $1 "*) ;; *) SKIPPED="$SKIPPED $1" ;; esac
  return 1
}
version_of() { sed -n "s/.*const VERSION = '\([^']*\)'.*/\1/p" "$1"; }
release_of() { sed -n "s/^[[:space:]]*release: '\([^']*\)'.*/\1/p" "$1"; }
# cache_of FILE PREFIX: the number in  const CACHE = 'PREFIX-v<number>'
cache_of() { sed -n "s/.*const CACHE = '$2-v\([0-9][0-9]*\)'.*/\1/p" "$1"; }
lines() { printf '%s\n' "$1" | grep -c .; }
# How often a text occurs in a file (the workers' installs find the release by it and want it exactly once).
occurs() { grep -o "$2" "$1" | grep -c .; }
# Rewrites a file through sed. (Not sed -i: GNU and BSD sed disagree about its form.)
edit() { sed "$2" "$1" > "$1.bump.tmp" && cat "$1.bump.tmp" > "$1" && rm -f "$1.bump.tmp" || die "could not rewrite $1"; }
# The ?v= numbers (or ?db= numbers) a file carries, each once. A full stop that ends a sentence is not part of one.
stamps() { grep -o "?$2=[0-9A-Za-z._-][0-9A-Za-z._-]*" "$1" | sed 's/\.$//' | sort -u; }
# The addresses of a worker's install list: the lines of  const ASSETS = [ ... ];  that start with a quote.
assets_of() { sed -n "/const ASSETS = \[/,/^\];/p" "$1" | sed -n "s/^[[:space:]]*'\([^']*\)'.*/\1/p"; }
# The path from the repo root of an address in the install list of the worker in folder $1 (. or fuel).
in_tree() {
  p=${2%%\?*}; p=${p#./}
  case "$1" in
    .) printf '%s\n' "$p" ;;
    *) case "$p" in ../*) printf '%s\n' "${p#../}" ;; *) printf '%s\n' "$1/$p" ;; esac ;;
  esac
}
# Every file with ?v= in the workers' install lists, each once. The main scripts and sync.js carry their own
# marks (VERSION, release); every other one carries the first line  /* release <number> ... */.
versioned() {
  for a in $(assets_of sw.js); do case "$a" in *'?v='*) in_tree . "$a" ;; esac; done
  if [ -f fuel/sw.js ]; then for a in $(assets_of fuel/sw.js); do case "$a" in *'?v='*) in_tree fuel "$a" ;; esac; done; fi
}
first_line_marked() { versioned | sort -u | grep -v -x -F -e overload.js -e sync.js -e fuel/fuel.js; }
mark_count() { grep -o '/\* release ' "$1" | grep -c .; }
mark_of() { sed -n 's|^/\* release \([^ ]*\) .*|\1|p' "$1"; }
# A name v2.8's page asks for that is on disk, if any.
v28_name() { for f in app.js styles.css food.js; do [ -e "$f" ] && { printf '%s' "$f"; return 0; }; done; return 1; }
V28_WHY="v2.8's page asks for it, and its worker would run this file in the v2.8 page and keep it there. Leave the name unused"
# Is it a release number? Two whole numbers of at most four digits with a dot, no leading zero in either.
is_release() {
  case "$1" in *.*) ;; *) return 1 ;; esac
  for n in "${1%%.*}" "${1#*.}"; do
    case "$n" in ''|*[!0-9]*|0?*|?????*) return 1 ;; esac
  done
  return 0
}

[ -f overload.js ] && [ -f sw.js ] && [ -f index.html ] || die "run it from the repo root (overload.js, sw.js and index.html are not here)"

STAMPED="index.html sw.js fuel/index.html fuel/sw.js"
# The modules that say their release in a line  release: '3.0',  (overload.js reads it there).
RELEASED="sync.js backup.js connector.js"
# Run from the root of a git repository: what GitHub Pages publishes is what git has, not what is on disk.
IN_GIT=0
if command -v git >/dev/null 2>&1 && [ "$(git rev-parse --show-toplevel 2>/dev/null)" = "$(pwd -P)" ]; then IN_GIT=1; fi
tracked() { git ls-files --error-unmatch -- "$1" >/dev/null 2>&1; }
# Exit 1 from git diff --quiet: the file differs from the last commit (staged or not).
uncommitted() { git diff --quiet HEAD -- "$1" >/dev/null 2>&1; [ $? = 1 ]; }
UNCOMMITTED=""

MODE=bump MAJOR=0 NEW=""
for a in "$@"; do
  case "$a" in
    --check) MODE=check ;;
    --major) MAJOR=1 ;;
    -*|'') die "usage: sh bump.sh <version>   or   sh bump.sh --major <version>   or   sh bump.sh --check" ;;
    *) [ -z "$NEW" ] || die "one release number, please (got $NEW and $a)"; NEW=$a ;;
  esac
done
if [ "$MODE" = check ]; then
  [ -z "$NEW" ] && [ "$MAJOR" = 0 ] || die "--check takes nothing else"
elif [ -z "$NEW" ]; then
  die "usage: sh bump.sh <version>   or   sh bump.sh --major <version>   or   sh bump.sh --check"
fi

# ---------------------------------------------------------------------------
# The change
# ---------------------------------------------------------------------------
if [ "$MODE" = bump ]; then
  is_release "$NEW" || die "\"$NEW\" is not a release number (two numbers with a dot, like 3.1; no leading zero, no third part)"

  # Everything that will be changed must be found before anything is changed.
  if F=$(v28_name); then die "$F is at the root: $V28_WHY"; fi
  OLD=$(version_of overload.js)
  [ "$(lines "$OLD")" = 1 ] || die "overload.js must have exactly one line  const VERSION = '...'"
  is_release "$OLD" || die "overload.js says VERSION '$OLD', which is not a release number: set it by hand first"
  for f in $RELEASED; do
    [ "$(lines "$(release_of "$f")")" = 1 ] || die "$f must have exactly one line  release: '...',"
  done
  N=$(cache_of sw.js overload)
  [ "$(lines "$N")" = 1 ] || die "sw.js must have exactly one line  const CACHE = 'overload-v<number>'"
  if have fuel/fuel.js; then
    [ "$(lines "$(version_of fuel/fuel.js)")" = 1 ] || die "fuel/fuel.js must have exactly one line  const VERSION = '...'"
  fi
  if have fuel/sw.js; then
    M=$(cache_of fuel/sw.js fuel)
    [ "$(lines "$M")" = 1 ] || die "fuel/sw.js must have exactly one line  const CACHE = 'fuel-v<number>'"
  fi
  MARKED=$(first_line_marked)
  for f in $MARKED; do
    if [ ! -f "$f" ]; then case "$f" in fuel/*) have "$f"; continue ;; esac; die "$f is in sw.js's install list but not on disk"; fi
    [ "$(mark_count "$f")" = 1 ] && [ -n "$(mark_of "$f")" ] || die "$f must have exactly one first line  /* release <number> ... */  (the workers refuse the file otherwise)"
  done

  # Higher than the current release, number by number; a new first number only with --major.
  OMAJ=${OLD%%.*} OMIN=${OLD#*.} NMAJ=${NEW%%.*} NMIN=${NEW#*.}
  if [ "$NMAJ" -lt "$OMAJ" ] || { [ "$NMAJ" -eq "$OMAJ" ] && [ "$NMIN" -le "$OMIN" ]; }; then
    die "$NEW is not higher than the current release $OLD (compared number by number, as the start-up rescue does)"
  fi
  if [ "$NMAJ" -ne "$OMAJ" ] && [ "$MAJOR" = 0 ]; then
    die "$OLD -> $NEW changes the first number. The start-up rescue then has no older release to fall back to on a phone whose update arrives half. If that is meant, run: sh bump.sh --major $NEW"
  fi
  if [ "$NMAJ" -eq "$OMAJ" ] && [ "$MAJOR" = 1 ]; then
    die "--major is for a new first number; $OLD -> $NEW keeps it: run sh bump.sh $NEW"
  fi

  # Every ?v=<number> becomes the new one, whatever number it was: after this the four files agree.
  for f in $STAMPED; do
    if have "$f"; then edit "$f" "s/?v=[0-9][0-9]*\(\.[0-9][0-9]*\)*/?v=$NEW/g"; fi
  done
  edit overload.js "s/const VERSION = '[^']*'/const VERSION = '$NEW'/"
  for f in $RELEASED; do edit "$f" "s/^\([[:space:]]*release: '\)[^']*'/\1$NEW'/"; done
  if have fuel/fuel.js; then edit fuel/fuel.js "s/const VERSION = '[^']*'/const VERSION = '$NEW'/"; fi
  for f in $MARKED; do
    if [ -f "$f" ]; then edit "$f" "s|^/\* release [^ ]* |/* release $NEW |"; fi
  done
  edit sw.js "s/const CACHE = 'overload-v$N'/const CACHE = 'overload-v$((N + 1))'/"
  CACHES="overload-v$((N + 1))"
  if have fuel/sw.js; then
    edit fuel/sw.js "s/const CACHE = 'fuel-v$M'/const CACHE = 'fuel-v$((M + 1))'/"
    CACHES="$CACHES, fuel-v$((M + 1))"
  fi
  say "$OLD -> $NEW, caches: $CACHES"
  WANT=$NEW
else
  WANT=$(version_of overload.js)
  [ "$(lines "$WANT")" = 1 ] || die "overload.js must have exactly one line  const VERSION = '...'"
  say "checking release $WANT (nothing is changed)"
fi

# ---------------------------------------------------------------------------
# The checks
# ---------------------------------------------------------------------------
# 1. One number everywhere.
is_release "$WANT" || fail "the release '$WANT' is not a release number (two numbers with a dot, like 3.1)"
for f in $STAMPED; do
  have "$f" || continue
  FOUND=$(stamps "$f" v)
  if [ -z "$FOUND" ]; then fail "$f carries no ?v= at all (a worker stores its page only when the page asks for this release's files)"; continue; fi
  for t in $FOUND; do
    [ "$t" = "?v=$WANT" ] || fail "$f still carries $t; the release is $WANT"
  done
done
[ "$(version_of overload.js)" = "$WANT" ] || fail "overload.js says VERSION '$(version_of overload.js)'; the release is $WANT"
[ "$(release_of sync.js)" = "$WANT" ] || fail "sync.js says release '$(release_of sync.js)'; the release is $WANT (overload.js refuses to remove the old food log beside another release's sync module)"
for f in backup.js connector.js; do
  [ "$(release_of "$f")" = "$WANT" ] || fail "$f says release '$(release_of "$f")'; the release is $WANT (overload.js does not use a $f of another release)"
  [ "$(occurs "$f" "release: '")" = 1 ] || fail "$f has \"release: '\" $(occurs "$f" "release: '") times; overload.js reads the module's release from it, so exactly once"
done
if have fuel/fuel.js; then
  [ "$(version_of fuel/fuel.js)" = "$WANT" ] || fail "fuel/fuel.js says VERSION '$(version_of fuel/fuel.js)'; the release is $WANT"
fi
# The workers' installs read the release from these words and refuse a file where they are not there exactly once.
for m in "overload.js:const VERSION = '" "sync.js:release: '" "fuel/fuel.js:const VERSION = '"; do
  f=${m%%:*} w=${m#*:}
  have "$f" || continue
  [ "$(occurs "$f" "$w")" = 1 ] || fail "$f has \"$w\" $(occurs "$f" "$w") times; its worker's install wants it exactly once, or it refuses the file"
done
# Every other file with ?v= in an install list says its release in its first line, exactly once.
for f in $(first_line_marked); do
  have "$f" || continue
  n=$(mark_count "$f")
  if [ "$n" != 1 ]; then fail "$f has \"/* release \" $n times; the workers want it exactly once, in its first line  /* release $WANT ... */, or they refuse the file"; continue; fi
  r=$(mark_of "$f")
  [ "$r" = "$WANT" ] || fail "$f says release '$r' in its first line  /* release ... */; the release is $WANT (the workers refuse the file)"
done

# 2. Names v2.8's page asks for are not answered.
for f in app.js styles.css food.js; do
  if [ -e "$f" ]; then fail "$f is at the root: $V28_WHY"; fi
done

# 3. Each worker's install list: every file is on disk, and every versioned file its page loads is in it.
# check_worker WORKER FOLDER PAGE (addresses in the list are relative to the worker's folder)
check_worker() {
  LIST=$(assets_of "$1")
  if [ -z "$LIST" ]; then fail "$1: the install list could not be read (const ASSETS = [ ... ]; with one address per line)"; return; fi
  for a in $LIST; do
    p=${a%%\?*}
    case "$p" in */) p="${p}index.html" ;; esac
    p="$2/${p#./}"
    if [ ! -f "$p" ]; then fail "$1 lists $a, but ${p#./} is not on disk: the install would fail on every phone"; continue; fi
    [ "$IN_GIT" = 1 ] || continue
    q=${p#./}; case "$q" in */../*) q=${q#*/../} ;; esac   # the path from the root (fuel/../shared/ui.css is shared/ui.css)
    case " $CHECKED " in *" $q "*) continue ;; esac
    CHECKED="$CHECKED $q"
    if ! tracked "$q"; then fail "$q is not in git: the published site would not have it. git add it"
    elif uncommitted "$q"; then UNCOMMITTED="$UNCOMMITTED $q"; fi
  done
  [ -f "$3" ] || return
  for u in $(grep -E -o '(src|href)="[^"]*[?]v=[^"]*"' "$3" | sed 's/^[a-z]*="//; s/"$//'); do
    hit=0
    for a in $LIST; do [ "${a#./}" = "${u#./}" ] && hit=1; done
    [ "$hit" = 1 ] || fail "$3 loads $u, but the install list in $1 does not name it: it would be missing offline"
  done
}
CHECKED=""
check_worker sw.js . index.html
if have fuel/sw.js; then check_worker fuel/sw.js fuel fuel/index.html; fi
# The workers themselves are published too.
if [ "$IN_GIT" = 1 ]; then
  for f in sw.js fuel/sw.js; do
    [ -f "$f" ] || continue
    if ! tracked "$f"; then fail "$f is not in git: the published site would not have it. git add it"
    elif uncommitted "$f"; then UNCOMMITTED="$UNCOMMITTED $f"; fi
  done
fi

# 4. The food list is asked for under the address it is stored under.
if have fuel/food.js; then HAVE_FOOD=1; else HAVE_FOOD=0; fi
if have fuel/sw.js && [ "$HAVE_FOOD" = 1 ]; then
  A=$(stamps fuel/food.js db | tr '\n' ' ')
  B=$(stamps fuel/sw.js db | tr '\n' ' ')
  if [ "$(lines "$(stamps fuel/food.js db)")" != 1 ]; then fail "fuel/food.js must ask for the food list under exactly one ?db= (found: ${A:-none})"
  elif [ "$A" != "$B" ]; then fail "the food list is ${A}in fuel/food.js but ${B:-not }in fuel/sw.js: food search would not work offline"
  fi
fi

# 5. What is published: origin/main (GitHub Pages serves main). It is fetched first, so that a pull request merged
# on GitHub counts; BUMP_NO_FETCH=1 leaves the copy here as it is (a copy of the repository that must not reach
# GitHub, or a test). Without git or origin/main these checks are skipped.
PUBLISHED=origin/main
FETCH=""
if [ "$IN_GIT" = 1 ] && git config --get remote.origin.url >/dev/null 2>&1; then
  if [ -n "${BUMP_NO_FETCH:-}" ]; then FETCH=off
  else
    LIMIT=""; if command -v timeout >/dev/null 2>&1; then LIMIT="timeout 20"; fi
    # No password prompt, and at most about 20 seconds (a stalled download ends too where there is no timeout).
    if GIT_TERMINAL_PROMPT=0 $LIMIT git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20 fetch -q origin main >/dev/null 2>&1; then FETCH=done
    else FETCH=failed; fi
  fi
fi
# The release a commit's overload.js says, if any.
release_at() { git show "$1:overload.js" 2>/dev/null | sed -n "s/.*const VERSION = '\([^']*\)'.*/\1/p"; }
# The newest commit on origin/main's own line (its first parents: each of them was the published site for a while)
# whose overload.js says  const VERSION = '$1', or nothing. Not only the newest commit: after a roll-back to an older
# release, phones that had this one keep its stored files, and they get them again when it is published again.
released_at() {
  git rev-list --first-parent "$PUBLISHED" 2>/dev/null | sed 's|.*|&:overload.js &|' \
    | git cat-file --batch-check='%(objectname) %(rest)' 2>/dev/null | {
      last="" v=""
      while read -r b c; do
        if [ "$c" = missing ]; then last=""; continue; fi   # no overload.js in that commit (2.8 and before)
        if [ "$b" != "$last" ]; then last=$b; v=$(git cat-file blob "$b" | sed -n "s/.*const VERSION = '\([^']*\)'.*/\1/p"); fi
        if [ "$v" = "$1" ]; then printf '%s\n' "$c"; break; fi
      done
    }
}
# A worker that changed since a published one has a new cache name. Otherwise a phone installs the changed worker
# into the cache the running one serves from, and an install that fails there (one file not arriving on a weak
# signal) leaves the app with nothing to start from offline. A worker new since then is not compared.
# same_cache COMMIT WHAT
same_cache() {
  for m in sw.js:overload fuel/sw.js:fuel; do
    f=${m%%:*} pre=${m#*:}
    [ -f "$f" ] || continue
    git cat-file -e "$1:$f" 2>/dev/null || continue
    if git show "$1:$f" | cmp -s - "$f"; then continue; fi
    THEN=$(git show "$1:$f" | sed -n "s/.*const CACHE = '$pre-v\([0-9][0-9]*\)'.*/\1/p")
    [ "$THEN" != "$(cache_of "$f" "$pre")" ] || fail "$f differs from the published one ($2), but its cache is still $pre-v$THEN: phones would install it into the cache the running worker serves from. Run sh bump.sh with the next release"
  done
}
if [ "$IN_GIT" = 1 ] && git rev-parse -q --verify "$PUBLISHED^{commit}" >/dev/null 2>&1; then
  TIP=$(git rev-parse "$PUBLISHED")
  WHEN=$(git log -1 --format=%cd --date=short "$PUBLISHED")
  case "$FETCH" in
    off) say "$PUBLISHED not fetched (BUMP_NO_FETCH is set): this is the copy here, from $WHEN (its last commit)" ;;
    failed) say "warning: could not fetch $PUBLISHED: compared with the copy here, from $WHEN (its last commit). Fetch it and check again before you push." ;;
  esac
  TIPREL=$(release_at "$TIP")
  # (2.8 and before had app.js; read only to name it here.)
  [ -n "$TIPREL" ] || TIPREL=$(git show "$TIP:app.js" 2>/dev/null | sed -n "s/.*const VERSION = '\([^']*\)'.*/\1/p" | sed -n 1p)
  say "published: $PUBLISHED at $(git rev-parse --short "$TIP"), release ${TIPREL:-unknown}"
  same_cache "$TIP" "$PUBLISHED"
  # Under a release that was published, every page and every file with ?v= the workers store must be its published
  # copy, and so must a worker under the same cache name. A phone that has the release answers the ?v= addresses
  # from its stored copies for the whole release, but takes a changed page from the server: it would run the new
  # page with the old scripts and stylesheets, also offline. (Two branches that each ran sh bump.sh with the same
  # number merge cleanly, so this is not only a forgotten bump.)
  REL=""
  if is_release "$WANT"; then REL=$(released_at "$WANT"); fi
  if [ -n "$REL" ]; then
    NEXT="${WANT%%.*}.$((${WANT#*.} + 1))"
    if [ "$REL" != "$TIP" ]; then
      say "release $WANT was published before, last at $(git rev-parse --short "$REL"): phones may still have it, so this compares with that too"
      same_cache "$REL" "$PUBLISHED at $(git rev-parse --short "$REL"), the last of release $WANT"
    fi
    # Only a worker that was published stored anything on a phone: its page and its files with ?v=.
    LISTED=""
    for m in sw.js:.:index.html fuel/sw.js:fuel:fuel/index.html; do
      w=${m%%:*} rest=${m#*:}; dir=${rest%%:*} page=${rest#*:}
      [ -f "$w" ] && git cat-file -e "$REL:$w" 2>/dev/null || continue
      LISTED="$LISTED $page"
      for a in $(assets_of "$w"); do case "$a" in *'?v='*) LISTED="$LISTED $(in_tree "$dir" "$a")" ;; esac; done
    done
    for f in $(printf '%s\n' $LISTED | sort -u); do
      [ -f "$f" ] || continue
      git cat-file -e "$REL:$f" 2>/dev/null || continue   # new since then: its worker's install list changed too (above)
      if git show "$REL:$f" | cmp -s - "$f"; then continue; fi
      case "$f" in
        index.html|fuel/index.html) fail "$f changed but the release is still $WANT: phones run it with their old copies of the other files. Run sh bump.sh $NEXT" ;;
        *) fail "$f changed but the release is still $WANT: phones keep the old copy. Run sh bump.sh $NEXT" ;;
      esac
    done
  fi
else
  [ "$FETCH" != failed ] || say "warning: could not fetch $PUBLISHED"
  say "not compared with the published workers and files (no git repository here, or no $PUBLISHED)"
fi
[ -z "$UNCOMMITTED" ] || say "warning: not committed yet:$UNCOMMITTED. Commit them before you push."

# ---------------------------------------------------------------------------
[ -z "$SKIPPED" ] || say "skipped (not there):$SKIPPED"
if [ "$FAILED" = 1 ]; then
  if [ "$MODE" = bump ]; then die "the files were changed, but the release is NOT consistent. Fix what is listed above, then run: sh bump.sh --check"; fi
  die "the release is NOT consistent. Fix what is listed above."
fi
say "ok: release $WANT is the same in every place, and every file the workers store is there"
