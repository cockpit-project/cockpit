# Some Kubernetes examples

If you're using this with the openshift image in bots/images then you'll
need to run the following to access services:

    $ sudo ip route add 172.30.0.0/16 via 10.111.112.101

This image is preloaded with the docker images needed to run the cockpit
integration tests.
