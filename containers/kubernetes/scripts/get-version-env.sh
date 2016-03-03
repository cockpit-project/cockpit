#!/bin/sh

set -ex

v=$(rpm -q --qf "%{version}" -f /etc/fedora-release)
OS="f$v-updates-testing"

echo $(curl -s https://bodhi.fedoraproject.org/latest_builds?package=cockpit | python3 -c "import json, sys; obj=json.load(sys.stdin); parts=obj['$OS'].strip('cockpit-').split('-', 1); rparts=parts[1].split('.', 1); print('export VERSION={0} RELEASE={1} OS={2}'.format(parts[0], rparts[0], rparts[1]))")
