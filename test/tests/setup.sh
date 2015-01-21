#!/bin/bash

yum -y virt-install virt-manager libvirt qemu-kvm libvirt-daemon-kvm qemu-kvm-tools
#yum -y install nodejs npm
#npm -g install phantomjs

yum -y install yum-plugin-copr
yum -y copr enable lmr/Autotest
yum -y install avocado
yum -y install avocado-virt

# because of troubles with cockpit recompiled to /opt/ instead of /usr
#setenforce 0


NUMBER=2
TREE="http://download.fedoraproject.org/pub/fedora/linux/releases/21/Server/x86_64/os"
#TREE="http://ftp.fi.muni.cz/pub/linux/centos/7.0.1406/os/x86_64/"
KSF=base.ks
ADIR=`pwd`
VMDIRS=/var/lib/libvirt/images/
mkdir -p $VMDIRS
NAME=test$NUMBER
IMG=$NAME.img
MAC=52:55:00:81:ee:1$NUMBER

if virsh list | grep $NAME; then
    echo "domain $NAME already exist and running "
elif virsh list --inactive| grep $NAME; then
    echo "domain $NAME already exist and stopped "    
    virsh start $NAME
    sleep 30
else
    qemu-img create -f qcow2 $VMDIRS/$IMG 20G
    virt-install --connect=qemu:///system \
        --network network:default,mac=$MAC \
        --initrd-inject=$ADIR/lib/$KSF \
        --extra-args="ks=file:/$KSF \
          console=tty0 console=ttyS0,115200" \
        --name=$NAME \
        --disk $VMDIRS/$IMG \
        --ram 1028 \
        --vcpus 1 \
        --check-cpu \
        --accelerate \
        --hvm \
        --location $TREE \
        --nographics 
    sleep 30
fi

IP=`cat /var/lib/libvirt/dnsmasq/default.leases |grep "$MAC" |head -1 | cut -d ' ' -f 3`
echo "guest IPaddr is: $IP"
ping -c 1 "$IP"

/bin/cp -r * /usr/share/avocado/tests

# avocado run checklogin.py
# avocado run --vm --vm-domain $NAME --vm-username root  --vm-password  testvm --vm-cleanup --vm-hostname $IP inittest.sh
# cat /root/avocado/job-results/latest/job.log 

