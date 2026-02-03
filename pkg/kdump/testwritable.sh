#!/bin/sh
# SPDX-License-Identifier: LGPL-2.1-or-later
set -eu

tmpfile=$(mktemp $1/.XXXXXX)
rm "$tmpfile"
