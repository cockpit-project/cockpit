#!/bin/sh
set -u

# The first thing we do is list loaded keys
loaded=$(ssh-add -L)
result="$?"

set -e

printf "$loaded"

# Get info for each loaded key
# ssh-keygen -l -f - is not
# supported everywhere so use tempfile
if [ $result -eq 0 ]; then
    tempfile=$(mktemp)
    echo "$loaded" | while read line; do
       echo "$line" > "$tempfile"
       printf "\v%s\v\v" "$line"
       ssh-keygen -l -f "$tempfile" || true
    done
    rm $tempfile
fi

# Try to list keys in this directory
cd "$1" || exit 0

# After that each .pub file gets its on set of blocks
for file in *.pub; do
    printf "\v"
    cat "$file"
    printf "\v%s\v" "$file"
    ssh-keygen -l -f "$file" || true
done
