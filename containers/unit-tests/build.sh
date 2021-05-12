#!/bin/sh -eux

./autogen.sh --prefix=/usr --enable-strict
[ "${TEST_SCENARIO:-}" = "dist" ] || make
