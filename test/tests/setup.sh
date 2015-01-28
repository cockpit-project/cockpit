#!/bin/bash


yum -y install yum-plugin-copr
yum -y copr enable lmr/Autotest
yum -y install avocado
yum -y install avocado-virt

# because of troubles with cockpit recompiled to /opt/ instead of /usr
#setenforce 0
source lib/create_test_machine.sh

PREFIX=testxc
DISTRO=fedora-21
NAME=`vm_get_name testcc fedora-21`
virt-create $PREFIX $DISTRO 


/bin/cp -r * /usr/share/avocado/tests
vm_ssh $NAME mkdir -p /root/avocado/tests
tar czf - . | vm_ssh $NAME tar xzf - --directory /root/avocado/tests/
vm_ssh $NAME avocado run avocado/tests/inittest.sh avocado/tests/checklogin.py

#cp * ~/tmp/root/avocado/tests/ -rf; cp -rf * /usr/share/avocado/tests/
# avocado run checklogin.py
# avocado run --vm --vm-domain $NAME --vm-username root  --vm-password  testvm --vm-hostname $IP inittest.sh checklogin.py failtest.py skiptest.py passtest.py
# cat /root/avocado/job-results/latest/job.log 

