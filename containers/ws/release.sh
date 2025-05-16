#!/bin/bash
set -eux

if [ -z "${RUNC:-}" ]; then
    RUNC=$(command -v podman || command -v docker) || {
        echo "ERROR: podman or docker required" >&2
        exit 1
    }
fi

if [ -z "${IMAGE_TAG:-}" ]; then
    IMAGE_TAG=quay.io/cockpit/ws:release-$(date +%s)
fi

$RUNC build -t $IMAGE_TAG containers/ws

# smoke test
name=ws-release
$RUNC run --name $name -p 19999:9090 -d $IMAGE_TAG
until curl --fail --show-error -k --head https://localhost:19999; do
    sleep 1
done

# determine cockpit version
VERSION=$($RUNC exec $name bash -c "cockpit-bridge --version | sed -n '/^Version:/ { s/^.*: //p }'")
echo VERSION=$VERSION >> ${GITHUB_OUTPUT:-/dev/null}

$RUNC exec $name bash -c "echo Successfully tested cockpit-ws container version $VERSION on \$(uname -m) architecture"

$RUNC rm -f $name
