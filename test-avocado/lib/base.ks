# Kickstart file
install
text
reboot
lang en_US.UTF-8
keyboard us
network --bootproto dhcp
#Choose a saner password here.
rootpw testvm
firewall --enabled --ssh
selinux --enforcing
timezone --utc America/New_York
#firstboot --disable
bootloader --location=mbr --append="console=tty0 console=ttyS0,115200 rd_NO_PLYMOUTH"
zerombr
clearpart --all --initlabel
autopart

#Just core packages
%packages --ignoremissing
@core
@base
@server-product
@standard

%end

%post
echo DONE
%end