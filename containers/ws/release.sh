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
$RUNC run --name ws -p 9090:9090 -d quay.io/cockpit/ws:$TAG
until curl --fail --show-error -k --head https://localhost:9090; do
    sleep 1
done
$RUNC rm -f ws

$RUNC tag quay.io/cockpit/ws:$TAG quay.io/cockpit/ws:latest

# push both tags
$RUNC push quay.io/cockpit/ws:$TAG
$RUNC push quay.io/cockpit/ws:latest
