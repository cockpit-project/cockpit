#!/bin/sh
set -eu

tmpfile=$(mktemp $1/.XXXXXX)
rm "$tmpfile"
