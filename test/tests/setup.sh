#!/bin/bash

#set -x
SCRIPT_DIR=`dirname "$(readlink -f "$0")"`
COCKPIT_DIR=$(cd $SCRIPT_DIR;cd ../..; echo `pwd`)
BASE=test/tests
source $SCRIPT_DIR/lib/host_setup.sh
source $SCRIPT_DIR/lib/create_test_machine.sh
LUSER=`whoami`

check_host $LUSER || sudo $SCRIPT_DIR/lib/host_setup.sh $LUSER || exit 1

# generate key for actual user if not generated yet
if [ ! -e ~/.ssh/id_rsa ]; then
    ssh-keygen -q -f ~/.ssh/id_rsa -N "" </dev/null
fi

PREFIX=checkmachine7
DISTRO=fedora-21
virt-create $PREFIX $DISTRO
NAME=`vm_get_name $PREFIX $DISTRO`
IP=`vm_get_ip $NAME`
PASSWD=`vm_get_pass $NAME`

avocado -v || sudo bash -c "`avocado_git_install`"
LOCAL_VERSION=`avocado -v 2>&1 |grep Avo`
vm_ssh $NAME avocado -v || vm_ssh $NAME "`avocado_git_install`"
REMOTE_VERSION=`vm_ssh $NAME "avocado -v " 2>&1 | grep Avo`
if [ "$LOCAL_VERSION" != "$REMOTE_VERSION" ]; then
    echo "avocado versions are not same on LOCAL and REMOTE $LOCAL_VERSION != $REMOTE_VERSION (SHOULD BE)"
    exit 11
fi

# workaound for slow snapshost creation (delete all existing snaps)
vm_delete_snaps $NAME

AVOCADO_TEST_DIR=/tmp/avocado-test
mkdir -p $AVOCADO_TEST_DIR
/bin/cp -r $COCKPIT_DIR/$BASE/* $AVOCADO_TEST_DIR
vm_ssh $NAME mkdir -p /root/avocado/tests/$AVOCADO_TEST_DIR /root/cockpit
( cd $COCKPIT_DIR; tar cf - . | vm_ssh $NAME tar xf - --directory /root/cockpit; )
vm_ssh $NAME cp -r /root/cockpit/$BASE/\* /root/avocado/tests$AVOCADO_TEST_DIR

AVOCADO_PARAMS="--vm-domain $NAME --vm-username root --vm-password $PASSWD --vm-hostname $IP"
avocado run $AVOCADO_PARAMS --xunit out1.xml $AVOCADO_TEST_DIR/{sources.sh,inittest.sh}
avocado run $AVOCADO_PARAMS --xunit out2.xml --vm-clean $AVOCADO_TEST_DIR/{compiletest.sh,checklogin.py}

