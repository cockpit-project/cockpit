#!/bin/sh
set -eux

# disable core dumps, we rather investigate them upstream where test VMs are accessible
echo core > /proc/sys/kernel/core_pattern

systemctl enable --now cockpit.socket
