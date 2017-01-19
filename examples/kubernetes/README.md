# Some Kubernetes examples

If you're using this with the openshift image in test/images then you'll
need to run the following to access services:

    $ sudo ip route add 172.30.0.0/16 via 10.111.112.101

This image is preloaded with the docker images needed to run the cockpit
integration tests. In order to avoid test flakes due to network issues, any
further image downloads are blocked by redirecting common docker registry
domains to 127.0.0.1 (localhost) in /etc/hosts. If you need to download new
images for manual tests you will need to remove those entries from /etc/hosts.
