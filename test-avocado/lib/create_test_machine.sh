#!/bin/bash
# -*- coding: utf-8 -*-

# This file is part of Cockpit.
#
# Copyright (C) 2015 Red Hat, Inc.
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

CTM_PASSWORD="testvm"
RCTM_USER="root"
CTM_ARCH="x86_64"
CTM_SSHOPTS="-o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no -o ConnectTimeout=10"

CTM_POOLNAME=$HS_POOLNAME

CTM_PREQ_YUM_A="
yum -y -q install tar bzip2 gzip unzip zip tar git yum-utils fontconfig pystache;
echo $CTM_PASSWORD | passwd --stdin $RCTM_USER
"
CTM_PREQ_DNF_A="
dnf -y -q install tar bzip2 gzip unzip zip tar git fontconfig pystache;
echo $CTM_PASSWORD | passwd --stdin $RCTM_USER
"
CTM_PREQ_APT_A="
echo 'now DEBIAN guest not supported'
echo $CTM_PASSWORD | passwd --stdin $RCTM_USER
"
function write_out() {
    CTM_NAME=$1
    echolog "  $CTM_NAME / `vm_get_mac $CTM_NAME` / `vm_get_ip $CTM_NAME`"
}

function virt-deploy-workaround(){
    local CTM_PREFIX=$1
    local CTM_DISTRO=$2

    python -c "import virtdeploy
instance=virtdeploy.get_driver('libvirt').instance_create('$CTM_PREFIX', '$CTM_DISTRO', network='$CTM_POOLNAME', pool='$CTM_POOLNAME', password='$CTM_PASSWORD')
print('name: {0}'.format(instance['name']))
print('root password: {0}'.format(instance['password']))
print('mac address: {0}'.format(instance['mac']))
print('hostname: {0}'.format(instance['hostname']))
print('ip address: {0}'.format(instance['ipaddress']))
"
}

function virtinstall(){
    local CTM_PREFIX=$1
    local CTM_DISTRO=$2
    local CTM_NAME=$CTM_PREFIX-$CTM_DISTRO-$CTM_ARCH
    local CTM_TMPF=`mktemp`
    echolog "virt-deploy create $CTM_PREFIX $CTM_DISTRO "
#    virt-deploy create $CTM_PREFIX $CTM_DISTRO 2>&1 | tee $CTM_TMPF
    virt-deploy-workaround $CTM_PREFIX $CTM_DISTRO 2>&1 | tee $CTM_TMPF
    sleep 2
    is_created $CTM_NAME &> /dev/null
    CTM_IP=`cat $CTM_TMPF | tail -5 | grep "ip address:" | sed -r 's/ip address: (.*)/\1/'`
    CTM_MAC=`cat $CTM_TMPF | tail -5 | grep "mac address:" | sed -r 's/mac address: (.*)/\1/'`
    CTM_VPASS=`cat $CTM_TMPF | tail -5 | grep "root password:" | sed -r 's/root password: (.*)/\1/'`
    setup_vm $CTM_NAME "$CTM_VPASS"
    /bin/rm $CTM_TMPF
}

function vm_wait_online(){
    local CTM_NAME=$1
    local MAXIMUM_TIMEOUT=60
    local CTM_IP=`vm_get_ip $CTM_NAME`
    for foo in `seq $MAXIMUM_TIMEOUT`;do
        echo EOF | nc -w 100ms "$CTM_IP" 22 1>/dev/null 2>&1 && return 0
        #echo -n . 1>&2
        sleep 1
    done
    return 1
}

function is_created(){
    local CTM_NAME=$1
    if virsh list | grep -q $CTM_NAME; then
        true;
    elif virsh list --inactive| grep -q $CTM_NAME; then
        echolog "Starting $CTM_NAME"
        virsh start $CTM_NAME
    else
        echolog "$CTM_NAME does not exist"
        return 1
    fi
}


function setup_vm(){
    local CTM_HOST="$1"
    local CTM_PASSWD="$2"
    local CTM_IP=`vm_get_ip $CTM_HOST`
    echolog "$CTM_HOST: $CTM_IP"
    local CTM_CTM_LOGIN=$RCTM_USER
    vm_wait_online $CTM_HOST
    sleep 2
    echolog SSHPASS="$CTM_PASSWD" sshpass -e ssh-copy-id $CTM_SSHOPTS $CTM_CTM_LOGIN@$CTM_IP
    SSHPASS="$CTM_PASSWD" sshpass -e ssh-copy-id $CTM_SSHOPTS $CTM_CTM_LOGIN@$CTM_IP
    if echo $CTM_HOST | grep -i "fedora.*22"; then
        vm_ssh "$CTM_HOST" "$CTM_PREQ_DNF_A"
    elif echo $CTM_HOST | grep -i "debian"; then
        vm_ssh "$CTM_HOST" "$CTM_PREQ_APT_A"
    else
        vm_ssh "$CTM_HOST" "$CTM_PREQ_YUM_A"
    fi
}


function vm_get_ip(){
    local CTM_NAME=$1
    local CTM_MAC=`vm_get_mac $CTM_NAME`
    is_created $CTM_NAME  &>/dev/null || return 1
    local CTM_IP=`virsh net-dumpxml $CTM_POOLNAME | grep "$CTM_MAC" |sed -r 's/.*ip=.([0-9.]*).*/\1/'`
    echo $CTM_IP
}
function vm_get_mac(){
    local CTM_NAME=$1
    local CTM_MAC=`virsh dumpxml $CTM_NAME | grep 'mac address' | cut -d\' -f2`
    echo $CTM_MAC
}

function vm_get_hostname(){
    local CTM_NAME=$1
    local CTM_MAC=`vm_get_mac $CTM_NAME`
    local CTM_HOSTCTM_NAME=`virsh net-dumpxml $CTM_POOLNAME | grep $CTM_MAC |sed -r "s/.*name='([^']*).*$/\1/"`
    echo $CTM_HOSTCTM_NAME
}

function vm_get_pass(){
    echo $CTM_PASSWORD
}

function vm_ssh(){
    local CTM_HOST=$1
    vm_wait_online $CTM_HOST
    shift
    set -o pipefail
    n=0
    until [ $n -ge 6 ]
    do
        ssh $CTM_SSHOPTS -l $RCTM_USER `vm_get_ip $CTM_HOST` $@ |& (grep -v "Warning: Permanently added" || true) && break
        n=$[$n+1]
    done
    set +o pipefail
}

function vm_create(){
    local CTM_PREFIX=$1
    local CTM_DISTRO=$2
    local CTM_NAME=${CTM_PREFIX}-${CTM_DISTRO}-${CTM_ARCH}
    local CTM_VMDIRS=/var/lib/libvirt/images/
    local CTM_LOG=$CTM_VMDIRS/$CTM_NAME.log
    is_created $CTM_NAME || virtinstall $CTM_PREFIX $CTM_DISTRO
}

function vm_delete_snaps(){
    CTM_NAME=$1
    for foo in `virsh snapshot-list $CTM_NAME --name`; do
        virsh snapshot-delete $CTM_NAME $foo
    done
    echolog All snaps deleted for: $CTM_NAME
}

function vm_get_name(){
    CTM_PREFIX=$1
    CTM_DISTRO=$2
    CTM_NAME=${CTM_PREFIX}-${CTM_DISTRO}-${CTM_ARCH}
    echo $CTM_NAME
}
