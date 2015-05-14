#!/usr/bin/python

from nrun import *

sys_setup()
spawn_guest("abc","fedora-21")
spawn_guest("abd","centos-6")

echo_log("testing")
test_func("abd")
test_func("abc")


