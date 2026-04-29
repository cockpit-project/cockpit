#!/bin/sh
# SPDX-License-Identifier: LGPL-2.1-or-later

user_name="$1"
home_dir="$2"

set -euf
mkdir -p "$home_dir/.ssh"
cd "$home_dir/.ssh"

chown "$user_name" .

touch authorized_keys 2> /dev/null || true
chown "$user_name" authorized_keys 2> /dev/null || true

sed -i -e '$a\' authorized_keys
cat >> authorized_keys

chown "$user_name" authorized_keys 2> /dev/null || true
chmod 600 authorized_keys
