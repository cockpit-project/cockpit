#!/bin/bash

yum install nodejs npm
npm -g install phantomjs

yum install yum-plugin-copr
yum copr enable lmr/Autotest
yum install avocado
yum install avocado-virt

# because of troubles with cockpit recompiled to /opt/ instead of /usr
setenforce 0

mkdir -p /usr/share/avocado/tests/

/bin/cp -rf  * /usr/share/avocado/tests/; python checklogin.py ; cat /root/avocado/job-results/latest/job.log 

