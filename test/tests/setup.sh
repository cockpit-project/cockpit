#!/bin/bash

# COPR plugin, html results for avocado, and sshpass for key transfer
sudo yum -y -q install pystache sshpass yum-plugin-copr telnet 
# avocado installation from COPR
sudo yum -y -q copr enable lmr/Autotest
sudo yum -y -q install avocado
# avocado installation from COPR 
sudo yum -y copr enable fsimonce/virt-deploy
sudo yum -y install virt-deploy

# generate key if not generated yet
ssh-keygen -q -f ~/.ssh/id_rsa -N "" </dev/null

# sudo for actual user have to be setup at least for commands
#
#    virsh, virt-deploy
AVOCADO_NEW="https://github.com/avocado-framework/avocado/archive/master.zip"
AVOCADO="avocado-master"
AVOCADO_SOURCE="
 curl -L $AVOCADO_NEW > $AVOCADO.zip && \
 unzip -o $AVOCADO.zip && \
 cd $AVOCADO && \
 sudo ./setup.py install && \
 cd ..
"

source lib/create_test_machine.sh

PREFIX=checkmachine4
DISTRO=fedora-21
virt-create $PREFIX $DISTRO
NAME=`vm_get_name $PREFIX $DISTRO`
IP=`vm_get_ip $NAME`
PASSWD=`vm_get_pass $NAME`

sudo /bin/cp -r * /usr/share/avocado/tests
vm_ssh $NAME mkdir -p /root/avocado/tests
vm_ssh $NAME "$AVOCADO_SOURCE"
sudo bash -c "$AVOCADO_SOURCE"

tar czf - . | vm_ssh $NAME tar xzf - --directory /root/avocado/tests/


#vm_ssh $NAME avocado run avocado/tests/inittest.sh avocado/tests/checklogin.py 

sudo avocado run --vm --vm-domain "$NAME" --vm-clean --vm-username root --vm-password "$PASSWD" --vm-hostname "$IP" inittest.sh checklogin.py

#vm_ssh $NAME tar czf -  /root/avocado/job-results | tar xzf -
# cp * ~/tmp/root/avocado/tests/ -rf; cp -rf * /usr/share/avocado/tests/
# avocado run checklogin.py

 
# cat /root/avocado/job-results/latest/job.log 

# virt-deploy delete $NAME