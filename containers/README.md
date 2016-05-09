Cockpit Containers
==================

Much of Cockpit is a system configuration and troubleshooting tool. It doesn't
all work in a container. But there are parts that do.


Contributing
============

Here are some commands to use while hacking on the containers. Replace
'xxx' with the name of the container. That is the name of the directory.
When running docker the 'sudo' command will be used to get necessary
privileges.

Build the given container:

    $ make xxx-container

Run the given built container and log in interactively as a shell:

    $ make xxx-container-shell

### Developing UI running a docker container

An alternative development environment when developing the Cockpit UI is to
mount local code into the cockpit Docker container. In this example we run the
cockpit/kubernetes container to connect to a remote kubernetes server. Replace
OPENSHIFTHOSTNAME with the IP or HOSTNAME of your OpenShift server.

1. Run the container.

        sudo docker run \
          -d \
          -e OPENSHIFT_OAUTH_PROVIDER_URL=https://OPENSHIFTHOSTNAME:8443 \
          -e COCKPIT_KUBE_URL=https://OPENSHIFTHOSTNAME \
          -e KUBERNETES_SERVICE_HOST=OPENSHIFTHOSTNAME \
          -e KUBERNETES_SERVICE_PORT=8443 \
          -e REGISTRY_HOST=REGISTRYHOSTNAME:5000 \
          -e OPENSHIFT_OAUTH_CLIENT_ID=cockpit-oauth-client \
          -e KUBERNETES_INSECURE=true \
          --name cockpit \
          -p 9090:9090 \
          -u 1001 \
          -v /path/to/cockpit/pkg/:/.local/share/cockpit:Z \
          cockpit/kubernetes

1. Edit source.
1. Refresh your browser with cache disabled.
