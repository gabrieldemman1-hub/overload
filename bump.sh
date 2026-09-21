#!/bin/sh
# Bump the app version in every place it appears. Usage: ./bump.sh 1.5
# Updates the ?v= query strings in index.html and sw.js, the cache name in sw.js,
# and the VERSION constant in app.js. Commit the result.
set -e
[ -n "$1" ] || { echo "usage: $0 <version>"; exit 1; }
NEW="$1"
OLD=$(sed -n "s/.*const VERSION = '\([^']*\)'.*/\1/p" app.js)
CACHE=$(sed -n "s/.*const CACHE = 'overload-v\([0-9]*\)'.*/\1/p" sw.js)
sed -i "s/?v=$OLD/?v=$NEW/g" index.html sw.js
sed -i "s/const CACHE = 'overload-v$CACHE'/const CACHE = 'overload-v$((CACHE + 1))'/" sw.js
sed -i "s/const VERSION = '$OLD'/const VERSION = '$NEW'/" app.js
echo "$OLD -> $NEW, cache overload-v$((CACHE + 1))"
grep -n "?v=$NEW" index.html sw.js | wc -l
