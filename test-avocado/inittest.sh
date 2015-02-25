#!/bin/bash
# This have to be first test for cockpit
#  install build dependencies
#  download new version of cockpit from git 
set -e

cd /root
PACKAGE="cockpit"
COCKPIT_DEPS=`cat $PACKAGE/tools/cockpit.spec  |egrep '^Requires: [^%]' | sed -r 's/Requires: ([^ ]*).*/\1/'`
yum-builddep -y $PACKAGE/tools/$PACKAGE.spec
yum -y install $COCKPIT_DEPS