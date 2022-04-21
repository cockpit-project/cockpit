#!/bin/sh

set -euf
mkdir -p "$2/.ssh"
cd "$2/.ssh"

chown $1 .

touch authorized_keys 2> /dev/null || true
chown $1 authorized_keys 2> /dev/null || true

sed -i -e '$a\' authorized_keys
cat >> authorized_keys

chown $1 authorized_keys 2> /dev/null || true
chmod 600 authorized_keys
