#!/bin/sh

set -eu

# The first thing we do is list loaded keys
ssh-add -L || true

# Try to list keys in this directory
cd "$1" || exit 0

# After that each .pub file gets its on set of blocks
for file in *.pub; do
    printf "\v"
    cat "$file"
    printf "\v%s\v" "$file"
    ssh-keygen -l -f "$file" || true
done
