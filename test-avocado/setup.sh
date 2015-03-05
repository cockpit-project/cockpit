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


if [ -z "$GUESTOS" ]; then
    GUESTOS=fedora-21
fi
echolog ">>> $GUESTOS testing <<<"

if check_host $LUSER; then
    echolog "Host already configured"
else
    if sudo $SCRIPT_DIR/lib/host_setup.sh $LUSER; then
        echolog "Host environemnt ready"
    else
        echolog "Unable to create enviromnet, EXITTING"
        exit 1
    fi
fi

# generate key for actual user if not generated yet (to ensure)
if [ ! -e ~/.ssh/id_rsa ]; then
    ssh-keygen -q -f ~/.ssh/id_rsa -N "" </dev/null
fi

# first (GUEST) testing machine
PREFIX=checkmachine7
DISTRO=$GUESTOS
virt-create $PREFIX $DISTRO
GUEST1=`vm_get_name $PREFIX $DISTRO`
IP=`vm_get_ip $GUEST1`
PASSWD=`vm_get_pass $GUEST1`

if virsh -c qemu:///system snapshot-info $GUEST1 initialized >/dev/null; then
    virsh -c qemu:///system snapshot-revert $GUEST1 initialized
    virsh -c qemu:///system snapshot-delete $GUEST1 initialized
fi
vm_ssh $GUEST1 bash -c "cat - >/tmp/cockpit.spec" <../tools/cockpit.spec
vm_ssh $GUEST1 bash -s < $SCRIPT_DIR/lib/guest-cockpit.sh /tmp/cockpit.spec
virsh -c qemu:///system snapshot-create-as $GUEST1 initialized

# IPA server machine
PREFIX=ipa
DISTRO=fedora-21
virt-create $PREFIX $DISTRO
TMP_NAME=`vm_get_name $PREFIX $DISTRO`
vm_ssh $TMP_NAME bash -s < $SCRIPT_DIR/lib/guest-ipa.sh
GUEST_IPA=$TMP_NAME
# Write variables for IPA tests
echo "IPADOMAIN='cockpit.lan'" >> $ENV_VARIABLES
echo "IPADOMAINIP='`vm_get_ip $GUEST_IPA`'" >> $ENV_VARIABLES

LOCAL_VERSION=`avocado -v 2>&1 |grep Avo`
REMOTE_VERSION=`vm_ssh $GUEST1 "avocado -v " 2>&1 | grep Avo`
if [ "$LOCAL_VERSION" != "$REMOTE_VERSION" ]; then
    echolog "avocado versions are not same on LOCAL and REMOTE $LOCAL_VERSION != $REMOTE_VERSION (SHOULD BE)"
    exit 11
fi

# Install cockpit sources to $GUEST1
#
( cd $(git rev-parse --show-toplevel) && git archive HEAD --prefix cockpit/ ) \
  | vm_ssh $GUEST1 "rm -rf /root/cockpit && tar xfm - --directory /root/"

AVOCADO_PARAMS="--vm-domain $GUEST1 --vm-username root --vm-password $PASSWD --vm-hostname $IP"
AVOCADO_TESTS="compiletest.sh checklogin.py checkrealms.py"

avocado run $AVOCADO_PARAMS $AVOCADO_TESTS
