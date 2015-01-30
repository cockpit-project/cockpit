#!/bin/bash

# COPR plugin, html results for avocado, and sshpass for key transfer
yum -y -q install pystache sshpass yum-plugin-copr 
# avocado installation from COPR
yum -y -q copr enable lmr/Autotest
yum -y -q install avocado
# avocado installation from COPR 
yum -y copr enable fsimonce/virt-deploy
yum -y install virt-deploy

# generate key if not generated yet
ssh-keygen -q -f ~/.ssh/id_rsa -N "" </dev/null

AVOCADO_NEW="https://github.com/avocado-framework/avocado/archive/master.zip"
AVOCADO="avocado-master"
AVOCADO_SOURCE="
 curl -L $AVOCADO_NEW > $AVOCADO.zip && \
 unzip -o  $AVOCADO.zip && \
 cd $AVOCADO && \
 sudo python setup.py install && \
 cd ..
"

eval "$AVOCADO_SOURCE"

source lib/create_test_machine.sh

PREFIX=checkmachine1
DISTRO=fedora-21
virt-create $PREFIX $DISTRO 
NAME=`vm_get_name $PREFIX $DISTRO`
IP=`vm_get_ip $NAME`

/bin/cp -r * /usr/share/avocado/tests
vm_ssh $NAME mkdir -p /root/avocado/tests
vm_ssh $NAME "$AVOCADO_SOURCE"

tar czf - . | vm_ssh $NAME tar xzf - --directory /root/avocado/tests/


#vm_ssh $NAME avocado run avocado/tests/inittest.sh avocado/tests/checklogin.py 

avocado run --vm --vm-domain $NAME --vm-clean --vm-username root --vm-hostname $IP inittest.sh checklogin.py

#vm_ssh $NAME tar czf -  /root/avocado/job-results | tar xzf -
# cp * ~/tmp/root/avocado/tests/ -rf; cp -rf * /usr/share/avocado/tests/
# avocado run checklogin.py

 
# cat /root/avocado/job-results/latest/job.log 

# virt-deploy delete $NAME