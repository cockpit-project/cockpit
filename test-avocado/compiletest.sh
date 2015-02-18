#!/bin/bash
# This have to be first test for cockpit
#  install build dependencies
#  download new version of cockpit from git 
#  compile it
# it is basic test compilation must PASS

set -x
set -e

cd /root
BUILD="build1"
PACKAGE="cockpit"
test -d $PACKAGE/$BUILD && /bin/rm -r $PACKAGE/$BUILD

cd $PACKAGE
mkdir -p $BUILD
cd $BUILD
../autogen.sh --prefix=/usr --enable-maintainer-mode --enable-debug
make
make install

set +e
/bin/cp -f ../src/bridge/$PACKAGE.pam.insecure /etc/pam.d/$PACKAGE
grep reauthorize /etc/pam.d/sshd || sh -c 'cat ../src/bridge/sshd-reauthorize.pam >> /etc/pam.d/sshd'   

