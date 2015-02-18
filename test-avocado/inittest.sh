#!/bin/bash
# This have to be first test for cockpit
#  install build dependencies
#  download new version of cockpit from git 
set -e

cd /root
PACKAGE="cockpit"
yum-builddep -y $PACKAGE/tools/$PACKAGE.spec