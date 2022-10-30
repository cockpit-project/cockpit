#!/bin/sh
set -eux

if [ -z "${RUNC:-}" ]; then
    RUNC=$(command -v podman || command -v docker) || {
        echo "ERROR: podman or docker required" >&2
        exit 1
    }
fi

TAG=$(date +%Y-%m-%d)
$RUNC build -t quay.io/cockpit/ws:$TAG containers/ws

# smoke test
name=ws-release
$RUNC run --name $name -p 19999:9090 -d quay.io/cockpit/ws:$TAG
until curl --fail --show-error -k --head https://localhost:19999; do
    sleep 1
done
$RUNC rm -f $name

$RUNC tag quay.io/cockpit/ws:$TAG quay.io/cockpit/ws:latest

# push both tags
$RUNC push quay.io/cockpit/ws:$TAG
$RUNC push quay.io/cockpit/ws:latest
