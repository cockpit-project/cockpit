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

/bin/rm -fr $PACKAGE
 git clone $SOURCE && \
 cd $PACKAGE && \
# running twice (sometimes first command failed with strange reason)
 yum-builddep -y tools/$PACKAGE.spec || yum-builddep -y tools/$PACKAGE.spec && \
 mkdir $BUILD && \
 cd $BUILD && \
 ../autogen.sh --prefix=/usr --enable-maintainer-mode --enable-debug && \
 make && \
 make install
RETC=$?

if [ "$RETC" -eq 0 ]; then
    /bin/cp -f ../src/bridge/$PACKAGE.pam.insecure /etc/pam.d/$PACKAGE
    grep reauthorize /etc/pam.d/sshd || sh -c 'cat ../src/bridge/sshd-reauthorize.pam >> /etc/pam.d/sshd'   
fi

exit $RETC
