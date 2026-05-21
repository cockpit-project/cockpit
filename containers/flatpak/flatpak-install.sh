#!/bin/sh
set -eu
cd "${0%/*}/../.."

PREFIX="${1:-${FLATPAK_DEST:-/app}}"
DOWNSTREAM_RELEASES_XML="${DOWNSTREAM_RELEASES_XML:-}"
METAINFO="org.cockpit_project.CockpitClient.metainfo.xml"

# Python package
python3 src/build_backend.py --wheel . tmp/wheel
pip3 install --prefix="${PREFIX}" tmp/wheel/*.whl

# JS bundles (pre-built in the tarball)
mkdir -p "${PREFIX}/share/cockpit"
cp -rT dist "${PREFIX}/share/cockpit"
rm -rf "${PREFIX}/share/cockpit/playground" "${PREFIX}/share/cockpit/static"
find "${PREFIX}/share/cockpit" -name '*.LEGAL.txt' -delete

# cockpit-client
install -Dm755 src/client/cockpit-client "${PREFIX}/share/cockpit-client/cockpit-client"
install -Dm644 src/client/cockpit-client.ui "${PREFIX}/share/cockpit-client/cockpit-client.ui"
mkdir -p "${PREFIX}/bin"
ln -sf ../share/cockpit-client/cockpit-client "${PREFIX}/bin/cockpit-client"

# desktop integration
install -Dm644 src/client/org.cockpit_project.CockpitClient.desktop \
    "${PREFIX}/share/applications/org.cockpit_project.CockpitClient.desktop"
install -Dm644 src/client/org.cockpit_project.CockpitClient.service \
    "${PREFIX}/share/dbus-1/services/org.cockpit_project.CockpitClient.service"
install -Dm644 src/client/org.cockpit_project.CockpitClient.metainfo.xml \
    "${PREFIX}/share/metainfo/org.cockpit_project.CockpitClient.metainfo.xml"

# icons
install -Dm644 src/client/cockpit-client.svg \
    "${PREFIX}/share/icons/hicolor/scalable/apps/cockpit-client.svg"
install -Dm644 src/client/cockpit-client-symbolic.svg \
    "${PREFIX}/share/icons/hicolor/symbolic/apps/cockpit-client-symbolic.svg"

# metainfo: validate source, optionally patch with downstream releases, validate result
appstreamcli validate --no-net "src/client/${METAINFO}"
if [ -s "${DOWNSTREAM_RELEASES_XML}" ]; then
    tools/patch-metainfo "${PREFIX}/share/metainfo/${METAINFO}" "${DOWNSTREAM_RELEASES_XML}"
fi
appstreamcli validate --no-net "${PREFIX}/share/metainfo/${METAINFO}"
