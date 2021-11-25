#!/bin/sh

set -ex

wssockdir=/run/cockpit/wsinstance
sha256nil=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
wssock=$wssockdir/${sha256nil}

mkdir -p "$wssockdir"
/usr/libexec/cockpit-ws -U ${wssock} &

/usr/libexec/cockpit-certificate-ensure --for-cockpit-tls
exec /usr/libexec/cockpit-tls
