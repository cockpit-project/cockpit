#!/bin/bash

spec=$1

set -e

if npm -g list phantomjs 2>/dev/null | grep phantomjs; then
    echo "Phantomjs already installed"
else
    yum -y -q install nodejs npm bind-utils freeipa-client sssd
    npm -g install phantomjs
fi

BASE_PCKGS="avocado"

if rpm -q $BASE_PCKGS >& /dev/null; then
    echo "Base packages already installed"
else
    if cat /etc/redhat-release | grep -sq "Red Hat"; then
        curl https://copr.fedoraproject.org/coprs/lmr/Autotest/repo/epel-7/lmr-Autotest-epel-7.repo > /etc/yum.repos.d/lmr-Autotest-epel-7.repo
        yum -y install https://dl.fedoraproject.org/pub/epel/7/x86_64/e/epel-release-7-5.noarch.rpm
        yum -y -q install $BASE_PCKGS
    elif cat /etc/redhat-release | grep -sq "Fedora"; then
        yum -y -q install yum-plugin-copr
        yum -y -q copr enable lmr/Autotest
        yum -y -q install $BASE_PCKGS
    else
        echo "Now are supported only Fedora and Red Hat installation methods"
        exit 10
    fi
fi

yum-builddep -y $spec | grep -v -- "--> Already installed : "

COCKPIT_DEPS=`cat $spec | egrep '^Requires: [^%]' | sed -r 's/Requires: ([^ ]*).*/\1/'`
TEST_DEPS="ntpdate"

yum -y install $COCKPIT_DEPS $TEST_DEPS | grep -v "already installed and latest version"
