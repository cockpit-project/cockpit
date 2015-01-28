#!/bin/bash

SCRIPT=`realpath -s $0`
SCRIPTPATH=`dirname $SCRIPT`
PASSWORD="testvm"
USER="root"
export ARCH="x86_64"
export SSHOPTS="-o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no"

PREQ="yum -y -q install nodejs npm tar bzip2 gzip git pcp-libs-devel yum-utils fontconfig;
npm -g install phantomjs > /dev/null;
yum -y -q install yum-plugin-copr;
yum -y -q copr enable lmr/Autotest;
yum -y -q install avocado;
echo $PASSWORD | passwd --stdin $USER
"

function usage(){
print "USAGE:
create_test_machine.sh prefix_name distro
"
exit 2
}

function write_out(){
    NAME=$1
    echo "
name: $NAME
root password: $PASSWORD
mac address: `vm_get_mac $NAME`
hostname: localhost
ip address: `vm_get_ip $NAME`"

}
function virtinstall(){
    yum -y install yum-plugin-copr
    yum -y copr enable fsimonce/virt-deploy
    yum -y install virt-deploy
    PREFIX=$1
    DISTRO=$2
    NAME=$PREFIX-$DISTRO-$ARCH
    TMPF=`mktemp`
    echo "virt-deploy create $PREFIX $DISTRO "
    virt-deploy create $PREFIX $DISTRO 2>&1 | tee $TMPF
    sleep 2
    is_created $NAME &> /dev/null
    IP=`cat $TMPF | tail -5 | grep "ip address:" | sed -r 's/ip address: (.*)/\1/'`
    MAC=`cat $TMPF | tail -5 | grep "mac address:" | sed -r 's/mac address: (.*)/\1/'`
    VPASS=`cat $TMPF | tail -5 | grep "root password:" | sed -r 's/root password: (.*)/\1/'`
    setup_vm $NAME "$VPASS"
    /bin/rm $TMPF
}

function treeinstall(){
    yum -y virt-install virt-manager libvirt qemu-kvm libvirt-daemon-kvm qemu-kvm-tools
    PREFIX=$1
    DISTRO=$2
    if   [ "$DISTRO" = "fedora-21" ]; then
        TREE="http://download.fedoraproject.org/pub/fedora/linux/releases/21/Server/$ARCH/os"
    elif [ "$DISTRO" = "centos-7.0" ]; then
        TREE="http://ftp.fi.muni.cz/pub/linux/centos/7.0.1406/os/$ARCH/"
    else
        usage
    fi
    KSF=base.ks
    ADIR=$SCRIPTPATH/lib
    VMDIRS=/var/lib/libvirt/images/
    mkdir -p $VMDIRS
    NAME=${PREFIX}-${DISTRO}-${ARCH}
    IMG=$NAME.img
    MAC=`printf '52:54:00:%02X:%02X:%02X\n' $[RANDOM%256] $[RANDOM%256] $[RANDOM%256]`
    qemu-img create -f qcow2 $VMDIRS/$IMG 20G
    virt-install --connect=qemu:///system \
            --network network:default,mac=$MAC \
            --initrd-inject=$ADIR/$KSF \
            --extra-args="ks=file:/$KSF console=tty0 console=ttyS0,115200" \
            --name=$NAME \
            --disk $VMDIRS/$IMG \
            --ram 1028 \
            --vcpus 1 \
            --check-cpu \
            --accelerate \
            --hvm \
            --location $TREE \
            --noreboot \
            --nographics
# 

    is_created $NAME &>/dev/null
    setup_vm $NAME $PASSWORD
}

function vm_wait_online(){
    MAC=$1
    IP=""
    for foo in `seq 60`;do
        IP=`cat /var/lib/libvirt/dnsmasq/default.leases |grep "$MAC" |head -1 | cut -d ' ' -f 3`
        echo quit | telnet "$IP" 22 2>/dev/null | grep -q Connected && return 0
        echo -n . > /dev/stderr
        sleep 1
    done
    return 1
}

function is_created(){
    NAME=$1
    if virsh list | grep -q $NAME; then
        echo "domain $NAME already exist and running "
    elif virsh list --inactive| grep -q $NAME; then
        echo "domain $NAME already exist and stopped "
        virsh start $NAME
        vm_wait_online `vm_get_mac $NAME`
    else 
        echo "domain $NAME does not exist"
        return 1
    fi   
}


function setup_vm(){
    HOST=$1
    IP=`vm_get_ip $HOST`
    echo "$HOST: $IP"
    PASSWD="$2"
    LOGIN=$USER
    SSHPASS="$PASSWD" sshpass -e ssh-copy-id $SSHOPTS $LOGIN@$IP
    vm_ssh "$HOST" "$PREQ"
}


function vm_get_ip(){
    NAME=$1
    MAC=`vm_get_mac $NAME`
    is_created $NAME  &>/dev/null || return 1
    
    IP=`cat /var/lib/libvirt/dnsmasq/default.leases |grep "$MAC" |head -1 | cut -d ' ' -f 3`
    echo $IP
}
function vm_get_mac(){
    NAME=$1
    MAC=`virsh dumpxml $NAME | grep 'mac address' | cut -d\' -f2`
    echo $MAC
}

function vm_get_pass(){
    echo $PASSWORD
}

function vm_ssh(){
    HOST=$1
    shift
    echo ssh $SSHOPTS -l $USER `vm_get_ip $HOST` $@
    ssh $SSHOPTS -l $USER `vm_get_ip $HOST` $@
}


function virt-create(){
    PREFIX=$1
    DISTRO=$2
    NAME=${PREFIX}-${DISTRO}-${ARCH}
    VMDIRS=/var/lib/libvirt/images/
    LOG=$VMDIRS/$NAME.log
    is_created $NAME || virtinstall $PREFIX $DISTRO 
    write_out $NAME
    #is_created $NAME|| treeinstall $PREFIX $DISTRO
    
}

function vm_get_name(){
    PREFIX=$1
    DISTRO=$2
    NAME=${PREFIX}-${DISTRO}-${ARCH}
    echo $NAME
}