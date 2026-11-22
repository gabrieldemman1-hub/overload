#!/bin/sh
# One release number for both apps, in every place it appears. Run it from the repo root:
#
#   sh bump.sh 3.1        set the release to 3.1, then check
#   sh bump.sh --check    change nothing: only run the checks on the files as they are
#
# Overload (the training app, in the repo root) and Fuel (the diet app, in fuel/) are always released
# together under one number. For a new number this script changes:
#   - the ?v= on every file address in index.html, sw.js, fuel/index.html and fuel/sw.js;
#   - VERSION in app.js and in fuel/fuel.js (a line  const VERSION = '3.0';  in each);
#   - both offline cache names by one step: overload-vN in sw.js and fuel-vN in fuel/sw.js. Both, also when
#     only one app changed: a worker file that did not change is never installed again, and a page with a
#     new ?v= cannot be stored by a worker that still expects the old one.
# Then it checks, and fails loudly (exit code 1) when:
#   - a ?v= with another number is left in those four files, or a VERSION differs;
#   - a file in a worker's install list (ASSETS in sw.js and fuel/sw.js, one address per line) is not on
#     disk: that install fails on every phone, and nobody gets the release;
#   - a page loads a versioned file that its worker's install list does not name: the file would be missing
#     when the app starts with no signal;
#   - the food list's ?db= differs between fuel/food.js and fuel/sw.js: food search would stop working
#     offline. (This script never changes ?db=; that number moves by hand when the food list is rebuilt.)
# A file of the diet app that does not exist is skipped and named, so the script also works on a tree where
# fuel/ is not complete. Commit the result.

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
# cache_of FILE PREFIX: the number in  const CACHE = 'PREFIX-v<number>'
cache_of() { sed -n "s/.*const CACHE = '$2-v\([0-9][0-9]*\)'.*/\1/p" "$1"; }
lines() { printf '%s\n' "$1" | grep -c .; }
# Rewrites a file through sed. (Not sed -i: GNU and BSD sed disagree about its form.)
edit() { sed "$2" "$1" > "$1.bump.tmp" && cat "$1.bump.tmp" > "$1" && rm -f "$1.bump.tmp" || die "could not rewrite $1"; }
# The ?v= numbers (or ?db= numbers) a file carries, each once. A full stop that ends a sentence is not part of one.
stamps() { grep -o "?$2=[0-9A-Za-z._-][0-9A-Za-z._-]*" "$1" | sed 's/\.$//' | sort -u; }
# The addresses of a worker's install list: the lines of  const ASSETS = [ ... ];  that start with a quote.
assets_of() { sed -n "/const ASSETS = \[/,/^\];/p" "$1" | sed -n "s/^[[:space:]]*'\([^']*\)'.*/\1/p"; }

[ -f app.js ] && [ -f sw.js ] && [ -f index.html ] || die "run it from the repo root (app.js, sw.js and index.html are not here)"

STAMPED="index.html sw.js fuel/index.html fuel/sw.js"

case "$1" in
  --check) MODE=check ;;
  ''|-*) die "usage: sh bump.sh <version>   or   sh bump.sh --check" ;;
  *) MODE=bump ;;
esac

# ---------------------------------------------------------------------------
# The change
# ---------------------------------------------------------------------------
if [ "$MODE" = bump ]; then
  NEW=$1
  case "$NEW" in *[!0-9.]*|.*|*.|*..*) die "\"$NEW\" is not a release number (digits and dots, like 3.1)" ;; esac

  # Everything that will be changed must be found before anything is changed.
  OLD=$(version_of app.js)
  [ "$(lines "$OLD")" = 1 ] || die "app.js must have exactly one line  const VERSION = '...'"
  N=$(cache_of sw.js overload)
  [ "$(lines "$N")" = 1 ] || die "sw.js must have exactly one line  const CACHE = 'overload-v<number>'"
  if have fuel/fuel.js; then
    [ "$(lines "$(version_of fuel/fuel.js)")" = 1 ] || die "fuel/fuel.js must have exactly one line  const VERSION = '...'"
  fi
  if have fuel/sw.js; then
    M=$(cache_of fuel/sw.js fuel)
    [ "$(lines "$M")" = 1 ] || die "fuel/sw.js must have exactly one line  const CACHE = 'fuel-v<number>'"
  fi

  # Every ?v=<number> becomes the new one, whatever number it was: after this the four files agree.
  for f in $STAMPED; do
    if have "$f"; then edit "$f" "s/?v=[0-9][0-9]*\(\.[0-9][0-9]*\)*/?v=$NEW/g"; fi
  done
  edit app.js "s/const VERSION = '[^']*'/const VERSION = '$NEW'/"
  if have fuel/fuel.js; then edit fuel/fuel.js "s/const VERSION = '[^']*'/const VERSION = '$NEW'/"; fi
  edit sw.js "s/const CACHE = 'overload-v$N'/const CACHE = 'overload-v$((N + 1))'/"
  CACHES="overload-v$((N + 1))"
  if have fuel/sw.js; then
    edit fuel/sw.js "s/const CACHE = 'fuel-v$M'/const CACHE = 'fuel-v$((M + 1))'/"
    CACHES="$CACHES, fuel-v$((M + 1))"
  fi
  say "$OLD -> $NEW, caches: $CACHES"
  WANT=$NEW
else
  WANT=$(version_of app.js)
  [ "$(lines "$WANT")" = 1 ] || die "app.js must have exactly one line  const VERSION = '...'"
  say "checking release $WANT (nothing is changed)"
fi

# ---------------------------------------------------------------------------
# The checks
# ---------------------------------------------------------------------------
# 1. One number everywhere.
for f in $STAMPED; do
  have "$f" || continue
  FOUND=$(stamps "$f" v)
  if [ -z "$FOUND" ]; then fail "$f carries no ?v= at all (a worker stores its page only when the page asks for this release's files)"; continue; fi
  for t in $FOUND; do
    [ "$t" = "?v=$WANT" ] || fail "$f still carries $t; the release is $WANT"
  done
done
[ "$(version_of app.js)" = "$WANT" ] || fail "app.js says VERSION '$(version_of app.js)'; the release is $WANT"
if have fuel/fuel.js; then
  [ "$(version_of fuel/fuel.js)" = "$WANT" ] || fail "fuel/fuel.js says VERSION '$(version_of fuel/fuel.js)'; the release is $WANT"
fi

# 2. Each worker's install list: every file is on disk, and every versioned file its page loads is in it.
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

# 3. The food list is asked for under the address it is stored under.
if have fuel/food.js; then HAVE_FOOD=1; else HAVE_FOOD=0; fi
if have fuel/sw.js && [ "$HAVE_FOOD" = 1 ]; then
  A=$(stamps fuel/food.js db | tr '\n' ' ')
  B=$(stamps fuel/sw.js db | tr '\n' ' ')
  if [ "$(lines "$(stamps fuel/food.js db)")" != 1 ]; then fail "fuel/food.js must ask for the food list under exactly one ?db= (found: ${A:-none})"
  elif [ "$A" != "$B" ]; then fail "the food list is ${A}in fuel/food.js but ${B:-not }in fuel/sw.js: food search would not work offline"
  fi
fi

# ---------------------------------------------------------------------------
[ -z "$SKIPPED" ] || say "skipped (not there):$SKIPPED"
if [ "$FAILED" = 1 ]; then
  if [ "$MODE" = bump ]; then die "the files were changed, but the release is NOT consistent. Fix what is listed above, then run: sh bump.sh --check"; fi
  die "the release is NOT consistent. Fix what is listed above."
fi
say "ok: release $WANT is the same in every place, and every file the workers store is there"
