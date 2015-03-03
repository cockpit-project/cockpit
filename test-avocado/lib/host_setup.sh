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



# you have to setup domain in virt-manager default network and reboot the machine to apply changes
# /etc/libvirt/qemu/networks/default.xml
# add line
# <domain name='cockpit.lan' localOnly='yes'/>
unset command_not_found_handle
HS_BASE_PCKGS="virt-deploy pystache sshpass telnet fabric python-pip avocado virt-manager qemu-img"
export HS_GRP="virtualization"
HS_CON="-c qemu:///system"
export HS_POOLNAME="cockpit"
export HS_POOLNAME_PATH=/home/$HS_POOLNAME

function host_dependencies_fedora(){
    sudo yum -y yum-plugin-copr
    sudo yum -y copr enable fsimonce/virt-deploy
    sudo yum -y copr enable lmr/Autotest
    sudo yum -y install $HS_BASE_PCKGS
}

function host_dependencies_rhel7(){
    sudo yum -y install https://dl.fedoraproject.org/pub/epel/7/x86_64/e/epel-release-7-5.noarch.rpm
    curl https://copr.fedoraproject.org/coprs/fsimonce/virt-deploy/repo/epel-7/fsimonce-virt-deploy-epel-7.repo > virt-deploy.repo
    curl https://copr.fedoraproject.org/coprs/lmr/Autotest/repo/fedora-21/lmr-Autotest-fedora-21.repo | sed -r -e 's/\$releasever/21/' -e 's/\$basearch/x86_64/' -e 's/gpgcheck=1/gpgcheck=0/' > avocado.repo
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
    echo "added network and storage pools"
}

function host_virtlibpolicy_solver(){
    local LHS_USER=$HS_USER
    definepools $HS_POOLNAME
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
        echo "All packages alread installed"
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
            echo "Now are supported only Fedora and Red Hat installation methods"
            exit 10
        fi
    fi

    if groups $HS_USER | grep -s $HS_GRP; then
        echo "Virtualization enabled for user"
    else
        host_virtlibpolicy_solver
    fi
}

function check_host(){
    HS_USER=$1
    if rpm -q $HS_BASE_PCKGS >& /dev/null; then
        echo "All packages alread installed"
        if groups $HS_USER | grep -qs $HS_GRP; then
            echo "Virtualization enabled for user"
            if virsh $HS_CON net-dumpxml $HS_POOLNAME |grep -q "domain name='cockpit.lan'"; then
                echo "Network domain configured for qemu"
                return 0
            else
                echo "Network domain for virt machines is NOT configured"
            fi
        else
            echo "Virtualization NOT properly setup"
        fi
    else
        echo "Packages are NOT installed correctly"
    fi
    return 1

}

HS_USERS=$1
for ONEHS_USER in $HS_USERS; do
    install_host $ONEHS_USER
done