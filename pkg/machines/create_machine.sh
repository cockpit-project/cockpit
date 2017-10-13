#!/bin/sh

set -eu
vmname=$1
osvariant=$2

virt-install \
    --name "$vmname" \
    --os-variant "$osvariant" \
    --memory 1024 \
    --disk none \
    --print-xml \
    --dry-run \
| virsh define /dev/stdin
