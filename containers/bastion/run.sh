#!/bin/sh

set -ex

/usr/libexec/cockpit-certificate-ensure

exec /usr/libexec/cockpit-ws
