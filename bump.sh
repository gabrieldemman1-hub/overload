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
#     in sync.js (a line  release: '3.0',  in window.__overloadSync);
#   - the first line  /* release 3.0 ... */  of every other file with ?v= in a worker's install list (scripts
#     and stylesheets of both apps and shared/): the workers store and run such a file only when it names the
#     release of its address;
#   - both offline cache names by one step: overload-vN in sw.js and fuel-vN in fuel/sw.js. Both, also when
#     only one app changed: a worker file that did not change is never installed again, and a page with a
#     new ?v= cannot be stored by a worker that still expects the old one.
# Then it checks, and fails loudly (exit code 1) when:
#   - a ?v= with another number is left in those four files, or a VERSION, the release in sync.js or the
#     first line of another versioned file differs, or one of these marks is not there exactly once;
#   - sw.js or fuel/sw.js differs from the published one (origin/main: GitHub Pages serves main) while its
#     cache name is the same: phones would install the changed worker into the cache the running one serves
#     from. Skipped where git or origin/main is not there, and for a worker that is new since then;
#   - app.js, styles.css or food.js is at the root: v2.8's page asks the server for these names, and its
#     worker would run (and store) whatever answers there in the v2.8 page;
#   - a file in a worker's install list (ASSETS in sw.js and fuel/sw.js, one address per line) is not on
#     disk: that install fails on every phone, and nobody gets the release;
#   - a page loads a versioned file that its worker's install list does not name: the file would be missing
#     when the app starts with no signal;
#   - the food list's ?db= differs between fuel/food.js and fuel/sw.js: food search would stop working
#     offline. (This script never changes ?db=; that number moves by hand when the food list is rebuilt, and
#     then the release moves on too: sh bump.sh <next release>.)
# A file of the diet app that does not exist is skipped and named, so the script also works on a tree where
# fuel/ is not complete. Commit the result.
#
# Every change to a file the workers store needs a new number: a worker answers an address with ?v= from its
# own stored copy for the whole release and never asks the server for it again.

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
  [ "$(lines "$(release_of sync.js)")" = 1 ] || die "sync.js must have exactly one line  release: '...',"
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
  edit sync.js "s/^\([[:space:]]*release: '\)[^']*'/\1$NEW'/"
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
    [ -f "$p" ] || fail "$1 lists $a, but ${p#./} is not on disk: the install would fail on every phone"
  done
  [ -f "$3" ] || return
  for u in $(grep -E -o '(src|href)="[^"]*[?]v=[^"]*"' "$3" | sed 's/^[a-z]*="//; s/"$//'); do
    hit=0
    for a in $LIST; do [ "${a#./}" = "${u#./}" ] && hit=1; done
    [ "$hit" = 1 ] || fail "$3 loads $u, but the install list in $1 does not name it: it would be missing offline"
  done
}
check_worker sw.js . index.html
if have fuel/sw.js; then check_worker fuel/sw.js fuel fuel/index.html; fi

# 4. The food list is asked for under the address it is stored under.
if have fuel/food.js; then HAVE_FOOD=1; else HAVE_FOOD=0; fi
if have fuel/sw.js && [ "$HAVE_FOOD" = 1 ]; then
  A=$(stamps fuel/food.js db | tr '\n' ' ')
  B=$(stamps fuel/sw.js db | tr '\n' ' ')
  if [ "$(lines "$(stamps fuel/food.js db)")" != 1 ]; then fail "fuel/food.js must ask for the food list under exactly one ?db= (found: ${A:-none})"
  elif [ "$A" != "$B" ]; then fail "the food list is ${A}in fuel/food.js but ${B:-not }in fuel/sw.js: food search would not work offline"
  fi
fi

# 5. A worker that changed since the published release has a new cache name. Otherwise a phone installs the
# changed worker into the cache the running one serves from, and an install that fails there (one file not
# arriving on a weak signal) leaves the app with nothing to start from offline. Published = origin/main (GitHub
# Pages serves main); without git or origin/main this check is skipped, and so is a worker new since then.
PUBLISHED=origin/main
if command -v git >/dev/null 2>&1 && [ "$(git rev-parse --show-toplevel 2>/dev/null)" = "$(pwd -P)" ] \
    && git rev-parse -q --verify "$PUBLISHED^{commit}" >/dev/null 2>&1; then
  for m in sw.js:overload fuel/sw.js:fuel; do
    f=${m%%:*} pre=${m#*:}
    [ -f "$f" ] || continue
    git cat-file -e "$PUBLISHED:$f" 2>/dev/null || continue
    if git show "$PUBLISHED:$f" | cmp -s - "$f"; then continue; fi
    THEN=$(git show "$PUBLISHED:$f" | sed -n "s/.*const CACHE = '$pre-v\([0-9][0-9]*\)'.*/\1/p")
    [ "$THEN" != "$(cache_of "$f" "$pre")" ] || fail "$f differs from the published one ($PUBLISHED), but its cache is still $pre-v$THEN: phones would install it into the cache the running worker serves from. Run sh bump.sh with the next release"
  done
else
  say "not compared with the published workers (no git repository here, or no $PUBLISHED)"
fi

# ---------------------------------------------------------------------------
[ -z "$SKIPPED" ] || say "skipped (not there):$SKIPPED"
if [ "$FAILED" = 1 ]; then
  if [ "$MODE" = bump ]; then die "the files were changed, but the release is NOT consistent. Fix what is listed above, then run: sh bump.sh --check"; fi
  die "the release is NOT consistent. Fix what is listed above."
fi
say "ok: release $WANT is the same in every place, and every file the workers store is there"
