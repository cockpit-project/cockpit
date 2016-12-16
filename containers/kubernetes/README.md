Kubernetes Container
====================

This container provides a version of cockpit that only contains the Kubernetes UI. Unlike a standard Cockpit installation, Cockpit does not have access to and will not interact with the underlying host. This container is meant to be deployed as a service with either Kubernetes or OpenShift.

The Kubernetes API endpoint is discovered by looking at the `KUBERNETES_SERVICE_HOST` and `KUBERNETES_SERVICE_PORT` environment variables that Kubernetes will set via the Downwards API. If those values are not present authentication will always fail.

Deploy on Kubernetes
--------------------

This container will only work with Kubernetes if the API is open or configured to use basic authentication. See http://kubernetes.io/v1.1/docs/admin/authentication.html for more information.

WARNING: If you choose to deploy this container to communicate with an open Kubernetes API you should take care to not expose it to an insecure network.

```
kubectl create -f containers/kubernetes-cockpit.json
```

This will create a kubernetes-cockpit service, replication controller and pod.


Deploy on OpenShift, Origin or Atomic Platform
----------------------------------------------

WARNING: By default OpenShift, Origin, and Atomic Platform allow ANY non-empty username/password access via oauth. You should almost always change this configuration before deploying this container. See https://docs.openshift.org/latest/install_config/configuring_authentication.html for more information.

Cockpit will use the OpenShift OAuth server to authenticate users. You need to provide the pod with the public url for the OpenShift OAuth server and provide OpenShift with the public url that will be used to access this service.

```
oc process -f containers/openshift-cockpit.template
    -v COCKPIT_KUBE_URL=https://ip-or-domain,OPENSHIFT_OAUTH_PROVIDER_URL=https://ip-or-domain:port | oc create -f -
```

This will create an OAuth Client and a openshift-cockpit service replication controller and pod.

The ```openshift-cockpit.template``` allows you to set the following environment variables:
 * ```COCKPIT_KUBE_URL```: The public url that users will use to access this service.
 * ```COCKPIT_KUBE_INSECURE```: Serve cockpit with SSL
 * ```KUBERNETES_INSECURE```: Set to ```true``` to disable certificate verification when talking to the API.
 * ```KUBERNETES_CA_DATA```: PEM encoded certificate that should be treated as a trusted certificate authority when talking to the Kubernetes API.
 * ```OPENSHIFT_OAUTH_PROVIDER_URL```: The public url for the Openshift OAuth Provider. Users will be redirected here when they attempt to log into cockpit.
 * ```REGISTRY_ONLY```: Only show the registry user interface.
 * ```REGISTRY_HOST```: Tell the container about the accessible registry hostname in use.

Only ```COCKPIT_KUBE_URL``` and ```OPENSHIFT_OAUTH_PROVIDER_URL``` are required.

Kubernetes Certificate Authority
--------------------------------

The container communicates with the Kubernetes API over SSL. By default Kubernetes uses a self signed certificate. You can tell Cockpit what the correct certificate authority is by setting
the contents of KUBERNETES_CA_DATA. Cockpit will also look for ca.crt in the default service account secret that Kubernetes will mount in the container by default. If you don't want cockpit to verify the certificate authority when connecting to the API you can set ```KUBERNETES_INSECURE``` to ```true```

Web Certificates
----------------

Cockpit looks at ```/etc/cockpit/ws-certs.d/``` to find its SSL certificate. You should create a Kubernetes secret API object to place your PEM encoded certificates and key in a ```.cert``` file in that location.

Alternatively if you have a seperate certificate and key file, and you are unable to combine them in advance. You may mount them as ```/var/run/secrets/ws-certs.d/tls.crt``` and ```/var/run/secrets/ws-certs.d/tls.key```. If these are present and valid cockpit will use them.

Otherwise if no certificates could be found cockpit will generate and use a self-signed certificate. However the CN will be based on the container name so this option should be avoided for most deployments.

You can also choose to serve cockpit without SSL by setting the ```COCKPIT_KUBE_INSECURE``` environment variable to ```true```.


Container Contents
==================

This container installs cockpit-ws, cockpit-system and cockpit-kubernetes rpms. If you include these rpms in this directory they will be installed, otherwise the version specified in the Dockerfile will be fetched from koji.

The following commands are used in the container:

 * **cockpit-kube-launch:** The container command, prepares the approprite cockpit configuration and launches cockpit-ws.

 * **cockpit-kube-auth:** Spawned for each log in, it verifies the users credentials and on success launches cockpit-stub. For more information on how cockpit supports this see https://github.com/cockpit-project/cockpit/blob/master/doc/authentication.md
