#!/bin/sh
set -eu

# sync disks
sync

# crash the kernel
echo 1 > /proc/sys/kernel/sysrq
echo c > /proc/sysrq-trigger
