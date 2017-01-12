#! /bin/bash

set -e -o pipefail

dir=/var/lib/playbooks
test -d "$dir" || mkdir "$dir"

role=$1

playbook="$dir/$role.json"
run="$dir/$role.run"
failed="$dir/$role.failed"

set -o noclobber
if ! ( >"$run" ) &> /dev/null; then
    echo Already running
    exit 1
fi
set +o noclobber

if ! (cat - >"$playbook.tmp" && mv "$playbook.tmp" "$playbook" ) ||
   ! ( ansible-playbook -i localhost, -c local "$playbook" 2>&1 | tee "$run" ); then
    mv "$run" "$failed"
    exit 1
else
    rm "$run"
    rm -f "$failed"
fi
