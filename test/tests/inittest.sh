#!/bin/bash
# This have to be first test for cockpit
#  install build dependencies
#  download new version of cockpit from git 
#  compile it
# it is basic test compilation must PASS

set -x

BUILD="build1"
PACKAGE="cockpit"
SOURCE="https://github.com/$PACKAGE-project/$PACKAGE.git"

#
yum-builddep -y $PACKAGE
yum-builddep -y $PACKAGE

 /bin/rm -fr $PACKAGE
 git clone $SOURCE && \
 cd cockpit && \
 mkdir $BUILD && \
 cd $BUILD && \
 ../autogen.sh --prefix=/usr --enable-maintainer-mode --enable-debug && \
 make && \
 make install
RETC=$?

if [ "$RETC" -eq 0 ]; then
    /bin/cp -f ../src/bridge/cockpit.pam.insecure /etc/pam.d/cockpit
    grep reauthorize /etc/pam.d/sshd || sh -c 'cat ../src/bridge/sshd-reauthorize.pam >> /etc/pam.d/sshd'   
fi

exit $RETC
