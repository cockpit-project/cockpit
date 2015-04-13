#!/bin/bash
# This have to be first test for cockpit
#  install build dependencies
#  download new version of cockpit from git
#  compile it
# it is basic test compilation must PASS

set -x
set -e

ARCH64=""
uname -p | grep '64' && ARCH64='64'

cd /root
BUILD="build1"
PACKAGE="cockpit"
test -d $PACKAGE/$BUILD && /bin/rm -r $PACKAGE/$BUILD

cd $PACKAGE
mkdir -p $BUILD
cd $BUILD
../autogen.sh --prefix=/usr --libdir=/usr/lib$ARCH64 --enable-maintainer-mode --enable-debug
make
make install install-test-assets

set +e
/bin/cp -f ../src/bridge/$PACKAGE.pam.insecure /etc/pam.d/$PACKAGE
grep reauthorize /etc/pam.d/sshd || sh -c 'cat ../src/bridge/sshd-reauthorize.pam >> /etc/pam.d/sshd'
