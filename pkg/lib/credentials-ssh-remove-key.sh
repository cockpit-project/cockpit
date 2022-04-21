#!/bin/sh

set -eu

tempfile=$(mktemp)
echo "$1" > "$tempfile"
ret=0
ssh-add -d "$tempfile" || ret=1
rm "$tempfile"
exit $ret
