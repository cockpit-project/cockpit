#!/bin/bash
# -*- coding: utf-8 -*-

# This file is part of Cockpit.
#
# Copyright (C) 2013 Red Hat, Inc.
#
# Cockpit is free software; you can redistribute it and/or modify it
# under the terms of the GNU Lesser General Public License as published by
# the Free Software Foundation; either version 2.1 of the License, or
# (at your option) any later version.
#
# Cockpit is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
# Lesser General Public License for more details.
#
# You should have received a copy of the GNU Lesser General Public License
# along with Cockpit; If not, see <http://www.gnu.org/licenses/>.

#set -x
SCRIPT_DIR=`dirname "$(readlink -f "$0")"`
COCKPIT_DIR=$(cd $SCRIPT_DIR;cd ..; echo `pwd`)
BASE=`basename $SCRIPT_DIR`
source $SCRIPT_DIR/lib/host_setup.sh
source $SCRIPT_DIR/lib/create_test_machine.sh
LUSER=`whoami`
ENV_VARIABLES=$COCKPIT_DIR/$BASE/lib/var.env
rm -f $ENV_VARIABLES

if check_host $LUSER; then
    echo "Host already configured"
else
    if sudo $SCRIPT_DIR/lib/host_setup.sh $LUSER; then
        echo "Host environemnt ready, please REBOOT you machine (to solve issue with default network changes)"
        exit 0
    else
        echo "Unable to create enviromnet, EXITTING"
        exit 1
    fi
fi

# generate key for actual user if not generated yet (to ensure)
if [ ! -e ~/.ssh/id_rsa ]; then
    ssh-keygen -q -f ~/.ssh/id_rsa -N "" </dev/null
fi

PREFIX=checkmachine7
DISTRO=fedora-21
virt-create $PREFIX $DISTRO
TMP_NAME=`vm_get_name $PREFIX $DISTRO`
IP=`vm_get_ip $TMP_NAME`
PASSWD=`vm_get_pass $TMP_NAME`
vm_ssh $TMP_NAME bash -s < $SCRIPT_DIR/lib/guest-cockpit.sh
GUEST1=$TMP_NAME

PREFIX=ipa
DISTRO=fedora-21
virt-create $PREFIX $DISTRO
TMP_NAME=`vm_get_name $PREFIX $DISTRO`
vm_ssh $TMP_NAME bash -s < $SCRIPT_DIR/lib/guest-ipa.sh
GUEST_IPA=$TMP_NAME
# Write variables for IPA tests
echo "IPADOMAIN='cockpit.lan'" >> $ENV_VARIABLES
echo "IPADOMAINIP='`vm_get_ip $GUEST_IPA`'" >> $ENV_VARIABLES

#avocado -v || sudo bash -c "`avocado_git_install`"
LOCAL_VERSION=`avocado -v 2>&1 |grep Avo`
#vm_ssh $GUEST1 avocado -v || vm_ssh $GUEST1 "`avocado_git_install`"
REMOTE_VERSION=`vm_ssh $GUEST1 "avocado -v " 2>&1 | grep Avo`
if [ "$LOCAL_VERSION" != "$REMOTE_VERSION" ]; then
    echo "avocado versions are not same on LOCAL and REMOTE $LOCAL_VERSION != $REMOTE_VERSION (SHOULD BE)"
    exit 11
fi

# workaound for slow snapshost creation (delete all existing snaps)
vm_delete_snaps $GUEST1

AVOCADO_TEST_DIR=/tmp/avocado-test
mkdir -p $AVOCADO_TEST_DIR
/bin/cp -r $COCKPIT_DIR/$BASE/* $AVOCADO_TEST_DIR
vm_ssh $GUEST1 mkdir -p /root/avocado/tests/$AVOCADO_TEST_DIR /root/cockpit
( cd $COCKPIT_DIR; tar cf - . | vm_ssh $GUEST1 tar xf - --directory /root/cockpit; )
vm_ssh $GUEST1 cp -r /root/cockpit/$BASE/\* /root/avocado/tests$AVOCADO_TEST_DIR

AVOCADO_PARAMS="--vm-domain $GUEST1 --vm-username root --vm-password $PASSWD --vm-hostname $IP"
avocado run $AVOCADO_PARAMS --xunit out1.xml $AVOCADO_TEST_DIR/{sources.sh,inittest.sh,compiletest.sh}
avocado run $AVOCADO_PARAMS --xunit out2.xml --vm-clean $AVOCADO_TEST_DIR/{compiletest.sh,checklogin.py,checkrealms.py}
#avocado run $AVOCADO_PARAMS --xunit out3.xml --vm-clean $AVOCADO_TEST_DIR/{compiletest.sh,checkrealmskrb.py}
