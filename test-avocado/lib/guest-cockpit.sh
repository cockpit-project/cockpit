#!/bin/bash

if npm -g list phantomjs 2>/dev/null | grep phantomjs; then
    echo "pahntomjs already installed"
else    
    yum -y -q install nodejs npm bind-utils freeipa-client sssd
    npm -g install phantomjs
fi

BASE_PCKGS="avocado"

if rpm -q $BASE_PCKGS >& /dev/null; then
    echolog "All packages alread installed"
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
        echolog "Now are supported only Fedora and Red Hat installation methods"
        exit 10
    fi
fi
