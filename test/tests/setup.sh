#!/bin/bash


yum -y -q install yum-plugin-copr
yum -y -q copr enable lmr/Autotest
yum -y -q install avocado
yum -y -q install avocado-virt


source lib/create_test_machine.sh

PREFIX=checkmachine2
DISTRO=fedora-21
virt-create $PREFIX $DISTRO 
NAME=`vm_get_name $PREFIX $DISTRO`
IP=`vm_get_ip $NAME`

/bin/cp -r * /usr/share/avocado/tests
vm_ssh $NAME mkdir -p /root/avocado/tests
tar czf - . | vm_ssh $NAME tar xzf - --directory /root/avocado/tests/

vm_ssh $NAME avocado run avocado/tests/inittest.sh avocado/tests/checklogin.py 
# avocado run --vm --vm-domain $NAME --vm-clean --vm-username root --vm-hostname $IP inittest.sh checklogin.py

#vm_ssh $NAME tar czf -  /root/avocado/job-results | tar xzf -
# cp * ~/tmp/root/avocado/tests/ -rf; cp -rf * /usr/share/avocado/tests/
# avocado run checklogin.py

 
# cat /root/avocado/job-results/latest/job.log 

# virt-deploy delete $NAME