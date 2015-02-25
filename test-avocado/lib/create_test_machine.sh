#!/bin/bash

CTM_SCRCTM_IPT=`realpath -s $0`
CTM_SCRCTM_IPTPATH=`dirname $CTM_SCRCTM_IPT`
CTM_PASSWORD="testvm"
RCTM_USER="root"
CTM_ARCH="x86_64"
CTM_SSHOPTS="-o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no"

CTM_PREQ="yum -y -q install nodejs npm tar bzip2 gzip unzip zip tar git yum-utils fontconfig pystache;
npm -g install phantomjs > /dev/null;
yum -y -q install yum-plugin-copr;
yum -y -q copr enable lmr/Autotest;
yum -y -q install avocado;
echo $CTM_PASSWORD | passwd --stdin $RCTM_USER
"

function usage(){
print "USAGE:
create_test_machine.sh prefix_name distro
"
exit 2
}

function write_out(){
    CTM_NAME=$1
    echo "
name: $CTM_NAME
root password: $CTM_PASSWORD
mac address: `vm_get_mac $CTM_NAME`
hostname: `vm_get_hostname $CTM_NAME`
ip address: `vm_get_ip $CTM_NAME`"

}
function virtinstall(){
    CTM_PREFIX=$1
    CTM_DISTRO=$2
    CTM_NAME=$CTM_PREFIX-$CTM_DISTRO-$CTM_ARCH
    CTM_TMPF=`mktemp`
    echo "virt-deploy create $CTM_PREFIX $CTM_DISTRO "
    virt-deploy create $CTM_PREFIX $CTM_DISTRO 2>&1 | tee $CTM_TMPF
    sleep 2
    is_created $CTM_NAME &> /dev/null
    CTM_IP=`cat $CTM_TMPF | tail -5 | grep "ip address:" | sed -r 's/ip address: (.*)/\1/'`
    CTM_MAC=`cat $CTM_TMPF | tail -5 | grep "mac address:" | sed -r 's/mac address: (.*)/\1/'`
    CTM_VPASS=`cat $CTM_TMPF | tail -5 | grep "root password:" | sed -r 's/root password: (.*)/\1/'`
    setup_vm $CTM_NAME "$CTM_VPASS"
    /bin/rm $CTM_TMPF
}

function treeinstall(){
    CTM_PREFIX=$1
    CTM_DISTRO=$2
    if   [ "$CTM_DISTRO" = "fedora-21" ]; then
        CTM_TREE="http://download.fedoraproject.org/pub/fedora/linux/releases/21/Server/$CTM_ARCH/os"
    elif [ "$CTM_DISTRO" = "centos-7.0" ]; then
        CTM_TREE="http://ftp.fi.muni.cz/pub/linux/centos/7.0.1406/os/$CTM_ARCH/"
    else
        usage
    fi
    CTM_KSF=base.ks
    CTM_ADIR=$CTM_SCRCTM_IPTPATH/lib
    CTM_VMDIRS=/var/lib/libvirt/images/
    mkdir -p $CTM_VMDIRS
    CTM_NAME=${CTM_PREFIX}-${CTM_DISTRO}-${CTM_ARCH}
    CTM_IMG=$CTM_NAME.img
    CTM_MAC=`printf '52:54:00:%02X:%02X:%02X\n' $[RANDOM%256] $[RANDOM%256] $[RANDOM%256]`
    qemu-img create -f qcow2 $CTM_VMDIRS/$CTM_IMG 20G
    virt-install --connect=qemu:///system \
            --network network:default,mac=$CTM_MAC \
            --initrd-inject=$CTM_ADIR/$CTM_KSF \
            --extra-args="ks=file:/$CTM_KSF console=tty0 console=ttyS0,115200" \
            --name=$CTM_NAME \
            --disk $CTM_VMDIRS/$CTM_IMG \
            --ram 1028 \
            --vcpus 1 \
            --check-cpu \
            --accelerate \
            --hvm \
            --location $CTM_TREE \
            --noreboot \
            --nographics
# 

    is_created $CTM_NAME &>/dev/null
    setup_vm $CTM_NAME $CTM_PASSWORD
}

function vm_wait_online(){
    CTM_MAC=$1
    CTM_IP=""
    for foo in `seq 60`;do
        CTM_IP=`cat /var/lib/libvirt/dnsmasq/default.leases |grep "$CTM_MAC" |head -1 | cut -d ' ' -f 3`
        echo quit | telnet "$CTM_IP" 22 2>/dev/null | grep -q Connected && return 0
        echo -n . > /dev/stderr
        sleep 1
    done
    return 1
}

function is_created(){
    CTM_NAME=$1
    if virsh -c qemu:///system list | grep -q $CTM_NAME; then
        echo "domain $CTM_NAME already exist and running "
    elif virsh -c qemu:///system list --inactive| grep -q $CTM_NAME; then
        echo "domain $CTM_NAME already exist and stopped "
        virsh -c qemu:///system start $CTM_NAME
        vm_wait_online `vm_get_mac $CTM_NAME`
    else 
        echo "domain $CTM_NAME does not exist"
        return 1
    fi   
}


function setup_vm(){
    CTM_HOST="$1"
    CTM_PASSWD="$2"
    CTM_IP=`vm_get_ip $CTM_HOST`
    echo "$CTM_HOST: $CTM_IP"
    CTM_CTM_LOGIN=$RCTM_USER
    echo SSHPASS="$CTM_PASSWD" sshpass -e ssh-copy-id $CTM_SSHOPTS $CTM_CTM_LOGIN@$CTM_IP
    SSHPASS="$CTM_PASSWD" sshpass -e ssh-copy-id $CTM_SSHOPTS $CTM_CTM_LOGIN@$CTM_IP
    vm_ssh "$CTM_HOST" "$CTM_PREQ"
}


function vm_get_ip(){
    local CTM_NAME=$1
    local CTM_MAC=`vm_get_mac $CTM_NAME`
    is_created $CTM_NAME  &>/dev/null || return 1
    
    local CTM_IP=`cat /var/lib/libvirt/dnsmasq/default.leases |grep "$CTM_MAC" |head -1 | cut -d ' ' -f 3`
    echo $CTM_IP
}
function vm_get_mac(){
    local CTM_NAME=$1
    local CTM_MAC=`virsh -c qemu:///system dumpxml $CTM_NAME | grep 'mac address' | cut -d\' -f2`
    echo $CTM_MAC
}

function vm_get_hostname(){
    local CTM_NAME=$1
    local CTM_MAC=`vm_get_mac $CTM_NAME`
    local CTM_HOSTCTM_NAME=`virsh -c qemu:///system net-dumpxml default | grep $CTM_MAC |sed -r "s/.*name='([^']*).*$/\1/"`
    echo $CTM_HOSTCTM_NAME
}

function vm_get_pass(){
    echo $CTM_PASSWORD
}

function vm_ssh(){
    local CTM_HOST=$1
    shift
    echo ssh $CTM_SSHOPTS -l $RCTM_USER `vm_get_ip $CTM_HOST` $@
    ssh $CTM_SSHOPTS -l $RCTM_USER `vm_get_ip $CTM_HOST` $@
}


function virt-create(){
    CTM_PREFIX=$1
    CTM_DISTRO=$2
    CTM_NAME=${CTM_PREFIX}-${CTM_DISTRO}-${CTM_ARCH}
    CTM_VMDIRS=/var/lib/libvirt/images/
    CTM_LOG=$CTM_VMDIRS/$CTM_NAME.log
    is_created $CTM_NAME || virtinstall $CTM_PREFIX $CTM_DISTRO 
    write_out $CTM_NAME
    #is_created $CTM_NAME|| treeinstall $CTM_PREFIX $CTM_DISTRO
    
}
function vm_delete_snaps(){
    CTM_NAME=$1
    for foo in `virsh -c qemu:///system snapshot-list $CTM_NAME --name`; do
        virsh -c qemu:///system snapshot-delete $CTM_NAME $foo
    done
    echo All snaps deleted for: $CTM_NAME
}
function vm_get_name(){
    CTM_PREFIX=$1
    CTM_DISTRO=$2
    CTM_NAME=${CTM_PREFIX}-${CTM_DISTRO}-${CTM_ARCH}
    echo $CTM_NAME
}