#!/bin/sh

set -ex

/sbin/remotectl certificate --ensure

exec /usr/libexec/cockpit-ws
