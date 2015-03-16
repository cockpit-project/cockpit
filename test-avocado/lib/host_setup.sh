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

unset command_not_found_handle

# TODO: Currently we have only one set of base packages, but we should
# allow different sets for different OSes.
#
HS_BASE_PCKGS="virt-deploy pystache sshpass telnet fabric python-pip avocado virt-manager qemu-img"

export HS_GRP="virtualization"
HS_CON="-c qemu:///system"
export HS_POOLNAME="cockpitx"
export HS_POOLNAME_PATH=/home/$HS_POOLNAME

function echolog(){
    echo "`date -u '+%Y%m%d-%H:%M:%S'` HOST: $@"
}

function host_dependencies_fedora(){
    sudo yum -y install yum-plugin-copr
    sudo yum -y copr enable fsimonce/virt-deploy
    sudo yum -y copr enable lmr/Autotest
    sudo yum -y install $HS_BASE_PCKGS
}

function host_dependencies_rhel7(){
    sudo yum -y install https://dl.fedoraproject.org/pub/epel/7/x86_64/e/epel-release-7-5.noarch.rpm
    curl https://copr.fedoraproject.org/coprs/fsimonce/virt-deploy/repo/epel-7/fsimonce-virt-deploy-epel-7.repo > virt-deploy.repo
    curl https://copr.fedoraproject.org/coprs/lmr/Autotest/repo/epel-7/lmr-Autotest-epel-7.repo > avocado.repo
    sudo /bin/cp virt-deploy.repo avocado.repo /etc/yum.repos.d/
    sudo yum -y install $HS_BASE_PCKGS
}
function definepools(){
    local HS_PNAME=$1
    local HS_IPEXTENSION=123
    sudo mkdir -p $HS_POOLNAME_PATH
    sudo virsh $HS_CON pool-define /dev/stdin <<EOF
<pool type='dir'>
  <name>$HS_PNAME</name>
  <target>
    <path>$HS_POOLNAME_PATH</path>
  </target>
</pool>
EOF
    sudo virsh $HS_CON pool-start $HS_PNAME
    sudo virsh $HS_CON pool-autostart $HS_PNAME

    sudo virsh $HS_CON net-define /dev/stdin <<EOF
<network>
  <name>$HS_PNAME</name>
  <domain name='cockpit.lan' localOnly='yes'/>
  <forward mode='nat'/>
  <bridge name='$HS_PNAME' stp='on' delay='0'/>
  <mac address='52:54:00:AB:AB:AB'/>
    <dns>
   </dns>
  <ip address='192.168.$HS_IPEXTENSION.1' netmask='255.255.255.0'>
    <dhcp>
      <range start='192.168.$HS_IPEXTENSION.2' end='192.168.$HS_IPEXTENSION.254'/>
    </dhcp>
  </ip>
</network>
EOF
    sudo virsh $HS_CON net-start $HS_PNAME
    sudo virsh $HS_CON net-autostart $HS_PNAME
    echolog "added network and storage pools"
}

function host_virtlibpolicy_solver(){
    local LHS_USER=$HS_USER
    sudo groupadd $HS_GRP
    sudo usermod -a -G $HS_GRP $LHS_USER
    sudo chgrp $HS_GRP $HS_POOLNAME_PATH
    sudo chown $LHS_USER $HS_POOLNAME_PATH
    sudo chmod g+rwx $HS_POOLNAME_PATH
    sudo tee /etc/polkit-1/localauthority/50-local.d/50-org.example-libvirt-remote-access.pkla <<< "[libvirt Management Access]
Identity=unix-group:$HS_GRP
Action=org.libvirt.unix.manage
ResultAny=yes
ResultInactive=yes
ResultActive=yes
"

}


HS_USER=$1
HS_METHOD=$2

function install_host(){
    HS_USER=$1
    if rpm -q $HS_BASE_PCKGS >& /dev/null; then
        echolog "All packages already installed"
    else
        if cat /etc/redhat-release | grep -sq "Red Hat"; then
            host_dependencies_rhel7
            sudo systemctl start libvirtd
            sudo systemctl enable libvirtd
            sleep 10
        elif cat /etc/redhat-release | grep -sq "Fedora"; then
            host_dependencies_fedora
            sudo systemctl start libvirtd
            sudo systemctl enable libvirtd
            sleep 10
        else
            echolog "Now are supported only Fedora and Red Hat installation methods"
            exit 10
        fi
    fi
    if virsh $HS_CON net-dumpxml $HS_POOLNAME |grep -q "domain name='cockpit.lan'"; then
        echolog "Network pool already configured for qemu"
    else
        definepools $HS_POOLNAME
        echolog "Network pool configured for qemu"
    fi
    if groups $HS_USER | grep -s $HS_GRP; then
        echolog "Virtualization enabled for user"
    else
        host_virtlibpolicy_solver
    fi
}

function check_host(){
    HS_USER=$1
    if rpm -q $HS_BASE_PCKGS >& /dev/null; then
        echolog "All packages alread installed"
        if groups $HS_USER | grep -qs $HS_GRP; then
            echolog "Virtualization enabled for user"
            if virsh $HS_CON net-dumpxml $HS_POOLNAME |grep -q "domain name='cockpit.lan'"; then
                echolog "Network domain configured for qemu"
                return 0
            else
                echolog "Network domain for virt machines is NOT configured"
            fi
        else
            echolog "Virtualization NOT properly setup"
        fi
    else
        echolog "Packages are NOT installed correctly"
    fi
    return 1

}

HS_USERS=$1
for ONEHS_USER in $HS_USERS; do
    install_host $ONEHS_USER
done
