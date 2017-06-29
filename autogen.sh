#!/bin/sh
# Run this to generate all the initial makefiles, etc.

set -e
srcdir=`dirname $0`
test -z "$srcdir" && srcdir=.

THEDIR=`pwd`
cd $srcdir

DIE=0

for prog in autoreconf automake autoconf libtoolize
do
    ($prog --version) < /dev/null > /dev/null 2>&1 || {
        echo
        echo "You must have $prog installed to compile libvirt-dbus."
        DIE=1
    }
done

if test "$DIE" -eq 1; then
        exit 1
fi

if test -z "$*"; then
        echo "I am going to run ./configure with no args - if you "
        echo "wish to pass any extra arguments to it, please specify them on "
        echo "the $0 command line."
fi

mkdir -p build-aux
autoreconf -if

cd $THEDIR

if test "x$1" = "x--system"; then
    shift
    prefix=/usr
    libdir=$prefix/lib
    sysconfdir=/etc
    localstatedir=/var
    if [ -d /usr/lib64 ]; then
      libdir=$prefix/lib64
    fi
    EXTRA_ARGS="--prefix=$prefix --sysconfdir=$sysconfdir --localstatedir=$localstatedir --libdir=$libdir"
fi

$srcdir/configure $EXTRA_ARGS "$@" && {
    echo
    echo "Now type 'make' to compile libvirt-dbus."
}
