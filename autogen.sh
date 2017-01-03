#!/bin/sh
# This file is part of Cockpit.
#
# Copyright (C) 2013 Red Hat, Inc.
#
# Cockpit is free software; you can redistribute it and/or modify it
# under the terms of the GNU Lesser General Public License as published by
# the Free Software Foundation; either version 2.1 of the License, or
# (at your option) any later version.
#
# Cockpit is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
# Lesser General Public License for more details.
#
# You should have received a copy of the GNU Lesser General Public License
# along with Cockpit; If not, see <http://www.gnu.org/licenses/>.

# Run this to generate all the initial makefiles, etc.

set -eux

srcdir=`dirname $0`
test -z "$srcdir" && srcdir=.

PKG_NAME="Cockpit"

(test -f $srcdir/src/ws/cockpit.service.in) || {
    echo -n "**Error**: Directory "\`$srcdir\'" does not look like the"
    echo " top-level $PKG_NAME directory"
    exit 1
}

# Switch into srcdir until running configure
olddir=$(pwd)
cd $srcdir

# Development dependencies: See node_modules/README
npm prune
npm install # see package.json

find node_modules -name test | xargs rm -rf

# Build dependencies: See bower_components/README
find bower_components -mindepth 1 -name README -prune -o -print | xargs rm -rf
node_modules/.bin/bower -f update

rm -rf autom4te.cache

autoreconf -f -i -I tools

set +x

# NOCONFIGURE is used by gnome-common; support both
if ! test -z "${AUTOGEN_SUBDIR_MODE:-}"; then
    NOCONFIGURE=1
fi

if test -z "${NOCONFIGURE:-}"; then
    if test -z "$*"; then
        echo "I am going to run ./configure with no arguments - if you wish "
        echo "to pass any to it, please specify them on the $0 command line."
    fi
fi

if test -n "${NOCONFIGURE:-}"; then
    exit 0
fi

cd $olddir
if [ -z "${NOREDIRECTMAKEFILE:-}" ]; then
    rm -f $srcdir/Makefile
fi
$srcdir/configure --enable-maintainer-mode ${AUTOGEN_CONFIGURE_ARGS:-} "$@" || exit $?

# Put a redirect makefile and dist directory here
if [ -z "${NOREDIRECTMAKEFILE:-}" ]; then
    if [ ! -e $srcdir/Makefile ]; then
        cat $srcdir/tools/Makefile.redirect > $srcdir/Makefile
        printf "\nREDIRECT = %s\n" "$(realpath $olddir)" >> $srcdir/Makefile
    fi

    mkdir -p $olddir/dist
    cp $srcdir/tools/README.dist $olddir/dist/README.md
    if [ ! -e $srcdir/dist ]; then
        ln -s $olddir/dist $srcdir/dist
    fi
fi

echo
echo "Now type 'make' to compile $PKG_NAME."
