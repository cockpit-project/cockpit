module.exports = {
    "nodes/127.0.0.1": {
        "kind": "Node",
        "metadata": {
            "name": "127.0.0.1",
            "uid": "f530580d-a169-11e4-8651-10c37bdb8410",
            "creationTimestamp": "2015-01-21T13:35:18+01:00",
            "resourceVersion": 1,
        },
        "spec": {
            "capacity": {
                "cpu": "1k",
                "memory": "3Gi",
            }
        },
        "status": {
            "hostIP": "127.0.0.1",
            "conditions": [
                {
                    "kind": "Ready",
                    "status": "Full",
                    "lastTransitionTime": null
                }
            ]
        }
    },
    "namespaces/default/pods/database-1": {
        "kind": "Pod",
        "metadata": {
            "name": "wordpress",
            "resourceVersion": 5,
            "uid": "0b547d64-ab8a-11e4-9a7c-080027300d85",
            "namespace": "default",
            "labels": {
                "name": "wordpressreplica"
            },
        },
        "spec": {
            "volumes": null,
            "containers": [
                {
                    "name": "slave",
                    "image": "jbfink/wordpress",
                    "ports": [
                        {
                            "hostPort": 81,
                            "containerPort": 80,
                            "protocol": "TCP"
                        }
                    ],
                    "imagePullPolicy": "IfNotPresent"
                }
            ],
            "restartPolicy": {
                "always": {}
            },
            "dnsPolicy": "ClusterFirst",
            "nodeName": "127.0.0.1"
        },
        "status": {
            "phase": "Running",
            "conditions": [
                {
                    "kind": "Ready",
                    "status": "Full"
                }
            ],
            "hostIP": "127.0.0.1",
            "podIP": "172.17.4.173",
            "info": {
                "POD": {
                    "state": {
                        "running": {
                            "startedAt": "2015-02-13T16:21:35Z"
                        }
                    },
                    "ready": false,
                    "restartCount": 0,
                    "containerID": "docker://9031b6aef7829ec029955377bd53642760899d4eed37738830756d0ce092a01d",
                    "podIP": "172.17.4.173",
                    "image": "kubernetes/pause:0.8.0",
                    "imageID": "docker://6c4579af347b649857e915521132f15a06186d73faa62145e3eeeb6be0e97c27"
                },
                "slave": {
                    "state": {
                        "running": {
                            "startedAt": "2015-02-13T16:27:49Z"
                        }
                    },
                    "ready": true,
                    "restartCount": 0,
                    "containerID": "docker://dc70bd24ecc7fd86a385d67bdbc2a60b219cf34fdd215f8f599c95ba93b1a82b",
                    "image": "jbfink/wordpress",
                    "imageID": "docker://0beee7f478c860c8444aa6a3966e1cb0cd574a01c874fc5dcc48585bd45dba52"
                }
            }
        }
    },
    "namespaces/default/pods/apache": {
        "kind": "Pod",
        "metadata": {
            "name": "apache",
            "uid": "11768037-ab8a-11e4-9a7c-080027300d85",
            "resourceVersion": 5,
            "namespace": "default",
            "labels": {
                "name": "apache"
            },
        },
        "spec": {
            "volumes": null,
            "containers": [
                {
                    "name": "slave",
                    "image": "fedora/apache",
                    "ports": [
                        {
                            "hostPort": 8084,
                            "containerPort": 80,
                            "protocol": "TCP"
                        }
                    ],
                    "imagePullPolicy": "IfNotPresent"
                }
            ],
            "restartPolicy": {
                "always": {}
            },
            "dnsPolicy": "ClusterFirst"
        },
    },
    "namespaces/other/pods/apache": {
        "kind": "Pod",
        "metadata": {
            "name": "apache",
            "uid": "9f1a316f-4db6-11e5-971a-525400e58104",
            "resourceVersion": 5,
            "namespace": "other",
            "labels": {
                "name": "apache"
            },
        },
        "spec": {
            "volumes": null,
            "containers": [
                {
                    "name": "slave",
                    "image": "fedora/apache",
                    "ports": [
                        {
                            "hostPort": 8084,
                            "containerPort": 80,
                            "protocol": "TCP"
                        }
                    ],
                    "imagePullPolicy": "IfNotPresent"
                }
            ],
            "restartPolicy": {
                "always": {}
            },
            "dnsPolicy": "ClusterFirst"
        },
    },
    "namespaces/default/services/kubernetes": {
        "kind": "Service",
        "metadata": {
            "name": "kubernetes",
            "namespace": "default",
            "uid": "9750385b-7fa4-11e4-91e3-10c37bdb8410",
            "resourceVersion": "15",
        },
        "spec": {
            "port": 443,
            "protocol": "TCP",
            "selector": {
                "component": "apiserver",
                "provider": "kubernetes"
            },
            "clusterIP": "10.254.224.238",
            "containerPort": 0,
            "sessionAffinity": "None"
        },
        "status": {}
    },
    "namespaces/default/services/kubernetes-ro": {
        "kind": "Service",
        "apiVersion": "v1",
        "metadata": {
            "name": "kubernetes-ro",
            "namespace": "default",
            "selfLink": "/api/v1/namespaces/default/services/kubernetes-ro",
            "uid": "97504104-7fa4-11e4-91e3-10c37bdb8410",
            "resourceVersion": "16",
        },
        "spec": {
            "port": 80,
            "protocol": "TCP",
            "selector": {
                "component": "apiserver",
                "provider": "kubernetes"
            },
            "clusterIP": "10.254.117.100",
            "containerPort": 0,
            "sessionAffinity": "None"
        },
        "status": {}
    },
    "namespaces/default/imagestreams/mock-image-stream": {
        "kind": "ImageStream",
          "apiVersion": "v1",
          "metadata": {
            "name": "mock-image-stream",
            "namespace":"default",
            "uid":"c216455b-4cc5-11e5-8a7f-0e5582eacc27"
          },
          "spec": {
            "dockerImageRepository": "mock/image",
            "tags": [
              {
                "name": "latest",
                "annotations": {
                  "description": "Mock Image",
                  "iconClass": "icon-mock",
                  "tags": "builder,mock",
                  "version": "3.0"
                }
              }
            ]
          },
          "status": {}
    },
};
