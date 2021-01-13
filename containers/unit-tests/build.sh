#!/bin/sh -eux

./autogen.sh --prefix=/usr --enable-strict --with-systemdunitdir=/tmp

make all

