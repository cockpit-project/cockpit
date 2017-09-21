#!/usr/bin/python2

from nrun import *

sys_setup()
spawn_guest("abc","fedora-21")

echo_log("testing")

test_func("abc")
guest_favour("abc","lib/guest-basic-redhat.sh",)
upload("abc","../tools/cockpit.spec","/var/tmp/cockpit.spec")
guest_favour("abc","lib/guest-cockpit-redhat.sh", "/var/tmp/cockpit.spec")

upload("abc","..","/root/cockpit")
avocado_run("abc",'compiletest-mock.sh')
avocado_run("abc",'checklogin-basic.py')



