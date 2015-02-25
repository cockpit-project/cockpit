#!/bin/bash

# you have to setup domain in virt-manager default network and reboot the machine to apply changes
# /etc/libvirt/qemu/networks/default.xml
# add line
# <domain name='cockpit.lan' localOnly='yes'/>
unset command_not_found_handle
HS_BASE_PCKGS="virt-deploy pystache sshpass telnet fabric python-pip"
HS_GRP="virtualization"
HS_DEFAULTNET="/etc/libvirt/qemu/networks/default.xml"
HS_DEFAULTNET_ACC="/var/lib/libvirt/dnsmasq/default.conf"

function host_default_network_domain(){
    if sudo grep -q 'domain=cockpit.lan' $HS_DEFAULTNET_ACC; then
        echo "network already configured, ensure that you have rebooted the machine"
        
    else
        sudo sed -i '/<name>default<\/name>/i <domain name="cockpit.lan" localOnly="yes"/>' $HS_DEFAULTNET
        sudo chmod a+x $HS_DEFAULTNET_ACC
        echo "network configured. Please REBOOT the machine, to take effect"
    fi
}

function host_dependencies_fedora(){
    sudo yum -y yum-plugin-copr
    sudo yum -y copr enable fsimonce/virt-deploy
    sudo yum -y install $HS_BASE_PCKGS
}

function host_dependencies_rhel7(){
    curl https://copr.fedoraproject.org/coprs/fsimonce/virt-deploy/repo/epel-7/fsimonce-virt-deploy-epel-7.repo > virt-deploy.repo
    sudo /bin/cp virt-deploy.repo /etc/yum.repos.d/
    sudo yum -y install $HS_BASE_PCKGS

}

function host_virtlibpolicy_solver(){
    LHS_USER=$HS_USER
    sudo groupadd $HS_GRP
    sudo usermod -a -G $HS_GRP $LHS_USER
    sudo chgrp $HS_GRP  /var/lib/libvirt/images
    sudo chmod g+rwx /var/lib/libvirt/images
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
        elif cat /etc/redhat-release | grep -sq "Fedora"; then
            host_dependencies_fedora
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
    host_default_network_domain
}

function check_host(){
    HS_USER=$1
    if rpm -q $HS_BASE_PCKGS >& /dev/null; then
        echo "All packages alread installed"
        if groups $HS_USER | grep -qs $HS_GRP; then
            echo "Virtualization enabled for user"
            if grep -q 'domain=cockpit.lan' $HS_DEFAULTNET_ACC; then
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

function avocado_pip_install(){
    HS_AVOCADO_STRING="
(
 yum -y install python-pip;
 pip install --upgrade avocado;
);
"
echo $HS_AVOCADO_STRING
}

function avocado_git_install(){
    HS_AVOCADO_NEW="https://github.com/avocado-framework/avocado/archive/master.zip"
    HS_AVOCADO="avocado-master"
    HS_AVOCADO_SOURCE="
(
 set -e;
 cd /tmp;
 curl -L $HS_AVOCADO_NEW > $HS_AVOCADO.zip;
 unzip -o $HS_AVOCADO.zip;
 cd $HS_AVOCADO;
 sudo ./setup.py install;
);
"
echo $HS_AVOCADO_SOURCE
}

HS_USERS=$1
for ONEHS_USER in $HS_USERS; do
    install_host $ONEHS_USER
done