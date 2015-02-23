#!/bin/bash

# you have to setup domain in virt-manager default network and reboot the machine to apply changes
# /etc/libvirt/qemu/networks/default.xml
# add line
# <domain name='cockpit.lan' localOnly='yes'/>
unset command_not_found_handle
BASE_PCKGS="virt-deploy pystache sshpass telnet fabric python-pip"
GRP="virtualization"
DEFAULTNET="/etc/libvirt/qemu/networks/default.xml"

function host_default_network_domain(){
    if grep -q 'domain name="cockpit.lan"' $DEFAULTNET; then
        echo "network already configured, ensure that you have rebooted the machine"
    else
        sed -i '/<name>default<\/name>/i <domain name="cockpit.lan" localOnly="yes"/>' $DEFAULTNET
        echo "network configured. Please REBOOT the machine, to take effect"
    fi
}

function host_dependencies_fedora(){
    sudo yum -y yum-plugin-copr
    sudo yum -y copr enable fsimonce/virt-deploy
    sudo yum -y install $BASE_PCKGS
}

function host_dependencies_rhel7(){
    curl https://copr.fedoraproject.org/coprs/fsimonce/virt-deploy/repo/epel-7/fsimonce-virt-deploy-epel-7.repo > virt-deploy.repo
    sudo /bin/cp virt-deploy.repo /etc/yum.repos.d/
    sudo yum -y install $BASE_PCKGS

}

function host_virtlibpolicy_solver(){
    LUSER=$USER
    sudo groupadd $GRP
    sudo usermod -a -G $GRP $LUSER
    sudo chgrp $GRP  /var/lib/libvirt/images
    sudo chmod g+rwx /var/lib/libvirt/images
    sudo tee /etc/polkit-1/localauthority/50-local.d/50-org.example-libvirt-remote-access.pkla <<< "[libvirt Management Access]
Identity=unix-group:$GRP
Action=org.libvirt.unix.manage
ResultAny=yes
ResultInactive=yes
ResultActive=yes
"
}


USER=$1
METHOD=$2

function install_host(){
    USER=$1
    if rpm -q $BASE_PCKGS >& /dev/null; then
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

    if groups $USER | grep -s $GRP; then
        echo "Virtualization enabled for user"
    else
        host_virtlibpolicy_solver
    fi
    host_default_network_domain
}

function check_host(){
    USER=$1
    if rpm -q $BASE_PCKGS >& /dev/null; then
        echo "All packages alread installed"
        if groups $USER | grep -qs $GRP; then
            echo "Virtualization enabled for user"
            if grep -q 'domain name="cockpit.lan"' $DEFAULTNET; then
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
    AVOCADO_STRING="
(
 yum -y install python-pip;
 pip install --upgrade avocado;
);
"
echo $AVOCADO_STRING
}

function avocado_git_install(){
    AVOCADO_NEW="https://github.com/avocado-framework/avocado/archive/master.zip"
    AVOCADO="avocado-master"
    AVOCADO_SOURCE="
(
 set -e;
 cd /tmp;
 curl -L $AVOCADO_NEW > $AVOCADO.zip;
 unzip -o $AVOCADO.zip;
 cd $AVOCADO;
 sudo ./setup.py install;
);
"
echo $AVOCADO_SOURCE
}

USERS=$1
for ONEUSER in $USERS; do
    install_host $ONEUSER
done