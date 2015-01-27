#!/bin/bash

SSHOPTS="-o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no"
PREQ="yum -y install nodejs npm
npm -g install phantomjs
yum -y install yum-plugin-copr
yum -y copr enable lmr/Autotest
yum -y install avocado
echo testvm | passwd --stdin
"

function usage(){
print "USAGE:
create_test_machine.sh prefix_name distro
"
exit 2
}

function write_out(){
    NAME=$1
    MAC=$2
    IP=$3
    echo "
name: $NAME
root password: testvm
mac address: $MAC
hostname: localhost
ip address: $IP"

}
function virtinstall(){
    yum -y install yum-plugin-copr
    yum -y copr enable fsimonce/virt-deploy
    yum -y install yum-plugin-copr
    PREFIX=$1
    DISTRO=$2
    ARCH="x86_64"
    NAME=$PREFIX-$DISTRO-$ARCH
    TMPF=`mktemp`
    echo virt-deploy create $PREFIX $DISTRO 
    virt-deploy create $PREFIX $DISTRO 2>&1 | tee $TMPF
    virt-deploy start $NAME
    sleep 20
    IP=`cat $TMPF | tail -5 | grep "ip address:" | sed -r 's/ip address: (.*)/\1/'`
    MAC=`cat $TMPF | tail -5 | grep "mac address:" | sed -r 's/mac address: (.*)/\1/'`
    PASS=`cat $TMPF | tail -5 | grep "root password:" | sed -r 's/root password: (.*)/\1/'`
    setup_vm "$IP" "$PASS"
    write_out $NAME $MAC $IP
    /bin/rm $TMPF
}

function treeinstall(){
    PREFIX=$1
    DISTRO=$2
    ARCH=x86_64
    if   [ "$DISTRO" = "fedora-21" ]; then
        TREE="http://download.fedoraproject.org/pub/fedora/linux/releases/21/Server/$ARCH/os"
    elif [ "$DISTRO" = "centos-7.0" ]; then
        TREE="http://ftp.fi.muni.cz/pub/linux/centos/7.0.1406/os/$ARCH/"
    else
        usage
    fi
    KSF=base.ks
    ADIR=`pwd`
    VMDIRS=/var/lib/libvirt/images/
    mkdir -p $VMDIRS
    NAME=${PREFIX}-${DISTRO}-${ARCH}
    IMG=$NAME.img
    MAC=`printf '52:54:00:%02X:%02X:%02X\n' $[RANDOM%256] $[RANDOM%256] $[RANDOM%256]`
    
    qemu-img create -f qcow2 $VMDIRS/$IMG 20G
    virt-install --connect=qemu:///system \
            --network network:default,mac=$MAC \
            --initrd-inject=$ADIR/$KSF \
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
    IP=`cat $TMPFILE | tail -5 | grep "ip adress" | sed -r 's/ip address: (.*)/\1/'`
    setup_vm $IP "testvm"
    write_out $NAME $MAC $IP
}

function is_created(){
    NAME=$1
    if virsh list | grep $NAME; then
        echo "domain $NAME already exist and running "
    elif virsh list --inactive| grep $NAME; then
        echo "domain $NAME already exist and stopped "
        virsh start $NAME
        sleep 30
    else 
        return 1
    fi
    MAC=`virsh dumpxml $NAME | grep 'mac address' | cut -d\' -f2`
    IP=`cat /var/lib/libvirt/dnsmasq/default.leases |grep "$MAC" |head -1 | cut -d ' ' -f 3`
    write_out $NAME $MAC $IP
}

function setup_vm(){
    IP=$1
    PASSWD="$2"
    LOGIN="root"
    SSHPASS="$PASSWD" sshpass -e ssh-copy-id $SSHOPTS $LOGIN@$IP
    ssh $SSHOPTS $LOGIN@$IP "$PREQ"
}

PREFIX=$1
DISTRO=$2
ARCH="x86_64"
NAME=${PREFIX}-${DISTRO}-${ARCH}
TMPFILE=`mktemp`
is_created $NAME || virtinstall $PREFIX $DISTRO

/bin/rm $TMPFILE