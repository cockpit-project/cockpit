#!/bin/sh

set -ex

OS='f23-updates-testing'

echo $(curl -s https://bodhi.fedoraproject.org/latest_builds?package=cockpit | python3 -c "import json, sys; obj=json.load(sys.stdin); parts=obj['$OS'].strip('cockpit-').split('-', 1); print('export VERSION={0} RELEASE={1}'.format(parts[0], parts[1]))")
