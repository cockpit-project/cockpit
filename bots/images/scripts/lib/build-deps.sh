#!/bin/bash

set -eu

# Download cockpit.spec, replace `npm-version` macro and then query all build requires
curl -s https://raw.githubusercontent.com/cockpit-project/cockpit/master/tools/cockpit.spec |
    sed 's/%{npm-version:.*}/0/' |
    sed '/Recommends:/d' |
    rpmspec -D "$1" --buildrequires --query /dev/stdin |
    sed 's/.*/"&"/' |
    tr '\n' ' '

# support for backbranches
if [ "$1" = "rhel 7" ] || [ "$1" = "centos 7" ]; then
    echo "golang-bin golang-src"
fi
