#!/bin/bash

# COPR plugin, html results for avocado, and sshpass for key transfer
sudo yum -y -q install pystache sshpass yum-plugin-copr telnet fabric
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
BASE=test/tests
source $BASE/lib/create_test_machine.sh
AVOCADO_TEST_DIR=/usr/share/avocado/tests

PREFIX=checkmachine1
DISTRO=fedora-21
virt-create $PREFIX $DISTRO
NAME=`vm_get_name $PREFIX $DISTRO`
IP=`vm_get_ip $NAME`
PASSWD=`vm_get_pass $NAME`

# workaound for slow snapshost creation (delete all existing snaps)
vm_delete_snaps $NAME

# avocado installation
vm_ssh $NAME "$AVOCADO_SOURCE"
sudo bash -c "$AVOCADO_SOURCE"


sudo /bin/cp -r $BASE/* $AVOCADO_TEST_DIR
vm_ssh $NAME mkdir -p /root/avocado/tests$AVOCADO_TEST_DIR /root/cockpit
tar czf - . | vm_ssh $NAME tar xzf - --directory /root/cockpit
vm_ssh $NAME cp -r /root/cockpit/$BASE/\* /root/avocado/tests$AVOCADO_TEST_DIR

#vm_ssh $NAME avocado run avocado/tests/inittest.sh avocado/tests/checklogin.py 

sudo avocado run --vm-domain "$NAME" --vm-username root --vm-password "$PASSWD" --vm-hostname "$IP" $AVOCADO_TEST_DIR/inittest.sh
#vm_ssh $NAME cp -r /root/cockpit/lib/sizzle.v2.1.0.js /root/cockpit/test/phantom-* /root/avocado/tests$AVOCADO_TEST_DIR/lib
sudo avocado run --vm-domain "$NAME" --vm-clean --vm-username root --vm-password "$PASSWD" --vm-hostname "$IP" $AVOCADO_TEST_DIR/compiletest.sh $AVOCADO_TEST_DIR/checklogin.py

#vm_ssh $NAME tar czf -  /root/avocado/job-results | tar xzf -
# cp * ~/tmp/root/avocado/tests/ -rf; cp -rf * /usr/share/avocado/tests/
# avocado run checklogin.py

 
# cat /root/avocado/job-results/latest/job.log 

# virt-deploy delete $NAME
