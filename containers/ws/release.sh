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

$RUNC build \
	--label org.opencontainers.image.url="https://cockpit-project.org" \
	--label org.opencontainers.image.documentation="https://github.com/cockpit-project/cockpit/blob/main/containers/ws/README.md" \
	--label org.opencontainers.image.description="Web-based graphical interface for Linux servers." \
	--label org.opencontainers.image.source="https://github.com/cockpit-project/cockpit/" \
	--label org.opencontainers.image.licenses="LGPL-2.1-or-later AND GPL-3.0-or-later AND MIT AND CC-BY-SA-3.0 AND BSD-3-Clause" \
	--label org.opencontainers.image.version="$(git describe --tags --abbrev=0 main)" \
	--label org.opencontainers.image.revision="$(git rev-parse HEAD)" \
	-t $IMAGE_TAG containers/ws

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
