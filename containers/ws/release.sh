#!/bin/bash
set -eux

if [ -z "${RUNC:-}" ]; then
    RUNC=$(command -v docker) || {
        echo "ERROR: docker required" >&2
        exit 1
    }
fi

if [ -z "${PLATFORMS:-}" ]; then
    case $(uname -m) in
         x86_64) PLATFORMS="linux/amd64" ;;
         aarch64|arm64) PLATFORMS="linux/arm64" ;;
     esac
fi

$RUNC buildx build --load --platform $PLATFORMS -t quay.io/cockpit/ws:release containers/ws

for platform in ${PLATFORMS//,/ }
do
    # smoke test
    name=ws-release
    $RUNC run --platform $platform --name $name -p 19999:9090 -d quay.io/cockpit/ws:release
    until curl --fail --show-error -k --head https://localhost:19999; do
        sleep 1
    done

    # determine cockpit version
    TAG=$($RUNC exec $name bash -c "cockpit-bridge --version | sed -n '/^Version:/ { s/^.*: //p }'")

    $RUNC exec $name bash -c "echo Successfully tested cockpit-ws container version $TAG on \$(uname -m) architecture"
    $RUNC rm -f $name
done

$RUNC tag quay.io/cockpit/ws:release quay.io/cockpit/ws:$TAG
$RUNC tag quay.io/cockpit/ws:release quay.io/cockpit/ws:latest
$RUNC rmi quay.io/cockpit/ws:release

# push both tags
$RUNC push quay.io/cockpit/ws:$TAG
$RUNC push quay.io/cockpit/ws:latest
