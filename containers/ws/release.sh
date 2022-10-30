#!/bin/sh
set -eux

if [ -z "${RUNC:-}" ]; then
    RUNC=$(command -v podman || command -v docker) || {
        echo "ERROR: podman or docker required" >&2
        exit 1
    }
fi

$RUNC build -t quay.io/cockpit/ws:release containers/ws

# smoke test
name=ws-release
$RUNC run --name $name -p 19999:9090 -d quay.io/cockpit/ws:release
until curl --fail --show-error -k --head https://localhost:19999; do
    sleep 1
done

# determine cockpit version
TAG=$($RUNC exec $name cockpit-bridge --version | sed -n '/^Version:/ { s/^.*: //p }')

$RUNC rm -f $name

$RUNC tag quay.io/cockpit/ws:release quay.io/cockpit/ws:$TAG
$RUNC tag quay.io/cockpit/ws:release quay.io/cockpit/ws:latest
$RUNC rmi quay.io/cockpit/ws:release

# push both tags
$RUNC push quay.io/cockpit/ws:$TAG
$RUNC push quay.io/cockpit/ws:latest
