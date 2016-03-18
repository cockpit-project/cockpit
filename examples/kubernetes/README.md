# Some Kubernetes examples

If you're using this with the openshift image in test/images then you'll
need to run the following to access services:

$ sudo route add -net 172.30.0.0/16 gw 10.111.112.101
