#!/bin/bash
# This have to be first test for cockpit
#  install build dependencies
#  download new version of cockpit from git 
set -e

cd /root
PACKAGE="cockpit"
SOURCE="https://github.com/$PACKAGE-project/$PACKAGE.git"
/bin/rm -fr $PACKAGE
git clone $SOURCE
