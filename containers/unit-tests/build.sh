#!/bin/sh -eux

./autogen.sh --prefix=/usr --enable-strict
make
