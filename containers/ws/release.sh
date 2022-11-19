#!/bin/sh
set -eux

if [ -z "${RUNC:-}" ]; then
    RUNC=$(command -v podman || command -v docker) || {
        echo "ERROR: podman or docker required" >&2
        exit 1
    }
fi

# only build on host architecture per default
if [ -z "${ARCHS:-}" ]; then
    case $(uname -m) in
        x86_64) ARCHS="amd64" ;;
        arm64) ARCHS="arm64" ;;
    esac
fi
for arch in $ARCHS; do
    $RUNC buildx build --platform="linux/${arch}" -t "quay.io/cockpit/ws:release-${arch}" containers/ws
done

# smoke test
first_arch=$(echo "${ARCHS}" | cut -d " " -f 1)
test_container=ws-release
$RUNC run --name "${test_container}" -p 19999:9090 -d "quay.io/cockpit/ws:release-${first_arch}"

for i in $(seq 1 30); do
    curl --fail --show-error -k --head https://localhost:19999 && break

    [ "${i}" -eq 30 ] && $RUNC rm -f "${test_container}" && exit 1 || sleep 1
done

# determine cockpit version
version=$($RUNC exec "${test_container}" cockpit-bridge --version | sed -n 's/^Version: *//p')

$RUNC rm -f "${test_container}"

version_arch_tags=""
for arch in $ARCHS; do
    release_arch_tag="quay.io/cockpit/ws:release-${arch}"
    version_arch_tag="quay.io/cockpit/ws:${version}-${arch}"
    latest_arch_tag="quay.io/cockpit/ws:latest-${arch}"

    version_arch_tags="${version_arch_tags} ${version_arch_tag}"

    $RUNC tag "${release_arch_tag}" "${version_arch_tag}"
    $RUNC tag "${release_arch_tag}" "${latest_arch_tag}"

    $RUNC push "${version_arch_tag}"
    $RUNC push "${latest_arch_tag}"

    $RUNC rmi "${release_arch_tag}"
done

version_tag="quay.io/cockpit/ws:${version}"
$RUNC manifest create "${version_tag}" ${version_arch_tags}

$RUNC manifest push "${version_tag}" "${version_tag}"
$RUNC manifest push "${version_tag}" "quay.io/cockpit/ws:latest"
