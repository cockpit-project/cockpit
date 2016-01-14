Cockpit Kubernetes Container
===========================

THIS CONTAINER IS STILL UNDER DEVELOPMENT DO NOT USE.

This container provides a version of cockpit that only contains the kubernetes UI. Unlike a standard Cockpit installation, Cockpit does not have access to and will not interact with the underlying host. This container is meant to be deployed as a service with either kubernetes or openshift.

The kubernetes API endpoint is discovered by looking at the `KUBERNETES_SERVICE_HOST` and `KUBERNETES_SERVICE_PORT` environment variables that kubernetes will set via the Downwards API. If those values are not present authentication will always fail.

Kubernetes Certificate Authority
--------------------------------
The container communicates with the kubernetes API over SSL. By default kubernetes uses a self signed certificate. You can tell Cockpit what the correct certificate authority is by setting
the contents of KUBERNETES_CA_DATA. Cockpit will also look for ca.crt in the default service account seceret that kubernetes will mount in the container by default. If you don't want cockpit to verify the certificate authority when connecting to the API you can set ```KUBERNETES_INSECURE``` to ```true```

Cockpit Certificates
--------------------
Cockpit looks at ```/etc/cockpit/ws-certs.d/``` to find its SSL certificate. You should create a Kubernetes secret API object to place your PEM encoded certificates and key in a ```.cert``` file in that location.

If there are no certificates present in that location cockpit will generate and use a self-signed certificate. However the CN will be based on the container name so this option should be avoided for most deployments.

You can also choose to serve cockpit without SSL by setting the ```COCKPIT_KUBE_INSECURE``` environment variable to "true"

Deploy on openshift
-------------------

WARNING: By default openshift/origin allows ANY non-empty username/password access via oauth. You should almost always change this configuration before deploying this container. See https://docs.openshift.org/latest/install_config/configuring_authentication.html for more information.

Cockpit will use the openshift OAuth server to authenticate users. You need to provide the pod with the public url for the openshift oauth server and provide openshift with the public url that will be used to access this service.

```
oc process -f deploy-examples/cockpit-openshift-template.json
    -v COCKPIT_KUBE_URL=https://ip-or-domain,OPENSHIFT_MASTER=https://ip-or-domain:port | oc create -f -
```

This will create an OAuth Client and a cockpit-kube service replication controller and pod.

The ```openshift-template.json``` allows you to set the following environment variables:
 * ```COCKPIT_KUBE_URL```: The public url that users will use to access this service.
 * ```COCKPIT_KUBE_INSECURE```: Serve cockpit with SSL
 * ```KUBERNETES_INSECURE```: Set to 'true' to disable certificate verification when talking to the API.
 * ```KUBERNETES_CA_DATA```: PEM encoded certificate that should be treated as a trusted certificate authority when talking to the Kubernetes API.
 * ```OPENSHIFT_OAUTH_PROVIDER_URL```: The public url for the Openshift OAuth Provider. Users will be redirected here when they attempt to log into cockpit.

Only ```COCKPIT_KUBE_URL``` and ```OPENSHIFT_OAUTH_PROVIDER_URL``` are required.

Deploy on kubernetes
--------------------

This container will only work with kubernetes if it is configured to use basic authentication. See http://kubernetes.io/v1.1/docs/admin/authentication.html for more information.

Once that is setup, you can deploy with the following command.

```
kubectl create -f deploy-examples/cockpit-kubernetes.json
```

This will create a cockpit-kube service, replication controller and pod.


Container Contents
==================

This container installs cockpit-ws, cockpit-shell and cockpit-kubernetes rpms. If you include these rpms in this directory they will be installed, otherwise the version specified in the Dockerfile will be fetched from koji.

In addition to the above rpms, the following is added from this repo to the container:

 * **simple-shell:** A cockpit javascript package. Replaces the standard cockpit shell with one that does not expect to have access to the host system.

 * **cockpit-kube-launch:** The container command, prepares the approprite cockpit configuration and launches cockpit-ws.

 * **cockpit-kube-auth:** Spawned for each login, it verifies the users login credentials and on success launches cockpit-stub. For more information on how cockpit supports this see https://github.com/cockpit-project/cockpit/blob/master/doc/authentication.md
