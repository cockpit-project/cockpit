#!/bin/bash

spec=$1

set -e
set -o pipefail

function echolog() {
    echo "`date -u '+%Y%m%d-%H:%M:%S'` COCKPIT GUEST: $@"
}

BASE_PCKGS="avocado avocado-plugins-output-html nodejs npm bind-utils freeipa-client sssd"
COCKPIT_DEPS=`cat "$spec" | egrep '^Requires: [^%]' | sed -r 's/Requires: ([^ ]*).*/\1/'`
TEST_DEPS="ntpdate"

if ! rpm -q $BASE_PCKGS >& /dev/null; then
    if cat /etc/redhat-release | grep -sq "Red Hat"; then
        echolog "Setting up repositories for RHEL"
        curl https://copr.fedoraproject.org/coprs/lmr/Autotest/repo/epel-7/lmr-Autotest-epel-7.repo > /etc/yum.repos.d/lmr-Autotest-epel-7.repo
        yum -y install https://dl.fedoraproject.org/pub/epel/7/x86_64/e/epel-release-7-5.noarch.rpm
    elif cat /etc/redhat-release | grep "CentOS"; then
        curl https://copr.fedoraproject.org/coprs/lmr/Autotest/repo/epel-7/lmr-Autotest-epel-7.repo > /etc/yum.repos.d/lmr-Autotest-epel-7.repo
        yum -y install https://dl.fedoraproject.org/pub/epel/7/x86_64/e/epel-release-7-5.noarch.rpm
    elif cat /etc/redhat-release | grep -sq "Fedora"; then
        if [ `cat /etc/redhat-release | grep Fedora | sed 's/.*Fedora [^0-9]*\([0-9]*\).*/\1/'` -le "21" ]; then
            echolog "Setting up repositories for Fedora <=21"
            yum -y -q install yum-plugin-copr
            yum -y -q copr enable lmr/Autotest
        else
            echolog "Setting up repositories for Fedora >=22"
            dnf -y -q install yum-plugin-copr
            dnf -y -q copr enable lmr/Autotest
        fi
    else
        echolog "Can't setup repositories for base packages: Unknown OS"
        exit 10
    fi
fi

function yum_install() {
    yum -y install "$@" | (grep -v "already installed and latest version\|Nothing to do\|Loaded plugins:" || true)
}

function yum_builddep() {
    yum-builddep -y "$@" | (grep -v -- "--> Already installed : \|Getting requirements for\|No uninstalled build requires" || true)
}

function dnf_install() {
    dnf -q -y install "$@" |& (grep -v "already installed, skipping" || true)
}

function dnf_builddep() {
    dnf -q -y builddep "$@" |& (grep -v "already installed, skipping" || true)
}

if rpm -q dnf; then
    echolog "Updating base packages"
    dnf_install $BASE_PCKGS
    echolog "Updating build dependencies"
    dnf_builddep $spec
    echolog "Updating run-time dependencies"
    dnf_install $COCKPIT_DEPS $TEST_DEPS
else
    echolog "Updating base packages"
    yum_install $BASE_PCKGS
    echolog "Updating build dependencies"
    yum_builddep $spec
    echolog "Updating run-time dependencies"
    yum_install $COCKPIT_DEPS $TEST_DEPS
fi

if npm -g list phantomjs 2>/dev/null | grep -q phantomjs; then
    echolog "Phantomjs is already installed"
else
    echolog "Installing phantomjs"
    npm -g install phantomjs
fi

if ! getent passwd admin >/dev/null; then
    echolog "Setting up 'admin' user account"
    useradd -u 1000 -c Administrator -G wheel admin || true
    echo foobar | passwd --stdin admin
fi

# Audit events to the journal
rm -f '/etc/systemd/system/multi-user.target.wants/auditd.service'
rm -rf /var/log/audit/

# HACK - https://github.com/avocado-framework/avocado/issues/486
if [ -f /bin/less ]; then mv -f /bin/less /bin/less.disabled; fi
