/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

var angular = require("angular");
var QUnit = require("qunit-tests");

require("./volumes");
require("./kube-client-cockpit");

function suite(fixtures) {
    "use strict";

    /* Filled in with a function */
    var inject;
    var assert = QUnit;

    var module = angular.module("kubernetes.volumes.tests", [
        "kubeClient",
        'kubeClient.cockpit',
        "kubernetes.volumes",
        "kubeUtils",
    ])

    .config([
        'KubeTranslateProvider',
        'KubeFormatProvider',
        function(KubeTranslateProvider, KubeFormatProvider) {
            KubeTranslateProvider.KubeTranslateFactory = "CockpitTranslate";
            KubeFormatProvider.KubeFormatFactory = "CockpitFormat";
        }
    ]);

    function volumesTest(name, count, fixtures, func) {
        QUnit.test(name, function() {
            assert.expect(count);
            inject([
                "kubeLoader",
                function(loader, data) {
                    loader.reset(true);
                    if (fixtures)
                        loader.handle(fixtures);
                }
            ]);
            inject(func);
        });
    }

    volumesTest("pods for Claim", 4, fixtures, [
        "volumeData",
        'kubeSelect',
        function(volumeData, select) {
            var claim = select().kind("PersistentVolumeClaim").name("bound-claim").one();
            var pods = volumeData.podsForClaim(claim);
            assert.equal(pods.length, 1, "number of pods");
            assert.equal(pods.one().metadata.name, "mock-pod", "correct pod");

            pods = volumeData.podsForClaim();
            assert.deepEqual(pods.length, 0, "null claim pods");

            pods = volumeData.podsForClaim({});
            assert.deepEqual(pods.length, 0, "empty claim pods");
        }
    ]);

    volumesTest("volumes for Pod", 4, fixtures, [
        "volumeData",
        'kubeSelect',
        function(volumeData, select) {
            var pod = select().kind("Pod").one();
            var volumes = volumeData.volumesForPod(pod);
            assert.deepEqual(volumes, {
              "default-token-luvqo": {
                "name": "default-token-luvqo",
                "secret": {
                    "secretName": "default-token-luvqo"
                },
                "mounts": {
                  "mock-volume-container": {
                    "mountPath": "/var/run/secrets/kubernetes.io/serviceaccount",
                    "name": "default-token-luvqo",
                    "readOnly": true
                  },
                  "mock-volume-container1": {
                    "mountPath": "/var/run/secrets/kubernetes.io/serviceaccount",
                    "name": "default-token-luvqo",
                    "readOnly": true
                  }
                }
              },
              "host-tmp": {
                "mounts": {
                  "mock-volume-container": {
                    "mountPath": "/other",
                    "name": "host-tmp"
                  },
                  "mock-volume-container1": {
                    "mountPath": "/tmp",
                    "name": "host-tmp"
                  }
                },
                "name": "host-tmp",
                "persistentVolumeClaim": {
                  "claimName": "bound-claim"
                }
              },
              "missing-claim": {
                "mounts": {
                  "mock-volume-container": {
                    "mountPath": "/tmp",
                    "name": "missing-claim"
                  }
                },
                "name": "missing-claim",
                "persistentVolumeClaim": {
                  "claimName": "missing-claim"
                }
              },
              "missing-claim2": {
                "name": "missing-claim2",
                "persistentVolumeClaim": {
                  "claimName": "missing-claim2"
                }
              }
            });
            assert.equal(volumes, volumeData.volumesForPod(pod), "same object");

            assert.deepEqual(volumeData.volumesForPod(), {}, "No null volumes");
            assert.deepEqual(volumeData.volumesForPod({}), {}, "No empty volumes");
        }
    ]);

    volumesTest("claim From Volume Source", 4, fixtures, [
        "volumeData",
        'kubeSelect',
        function(volumeData, select) {
            var pod = select().kind("Pod").one();
            var volumes = volumeData.volumesForPod(pod);
            var source = volumes["host-tmp"]["persistentVolumeClaim"];
            var claim = volumeData.claimFromVolumeSource(source, "default");
            assert.equal(claim.metadata.name, "bound-claim", "correct claim");
            assert.equal(claim.kind, "PersistentVolumeClaim", "correct type");

            assert.deepEqual(volumeData.claimFromVolumeSource(), null, "No null volumes");
            assert.deepEqual(volumeData.claimFromVolumeSource({}), null, "No empty volumes");
        }
    ]);

    volumesTest("claim For Volume", 5, fixtures, [
        "volumeData",
        'kubeSelect',
        function(volumeData, select) {
            var bound = select().kind("PersistentVolume").name("bound").one();
            var claim = volumeData.claimForVolume(bound);

            assert.equal(claim.metadata.name, "bound-claim", "correct claim");
            assert.equal(claim.kind, "PersistentVolumeClaim", "correct claim");

            var unbound = select().kind("PersistentVolume").name("unbound").one();
            assert.equal(volumeData.claimForVolume(unbound), null, "no claim");

            assert.equal(volumeData.claimForVolume(), null, "null volume");
            assert.equal(volumeData.claimForVolume(), null, "empty volume");
        }
    ]);

    volumesTest("claim phases", 2, fixtures, [
        "volumeData",
        'kubeSelect',
        function(volumeData, select) {
            var claim = select().kind("PersistentVolumeClaim").statusPhase("Bound").one();
            assert.equal(claim.metadata.name, "bound-claim", "select bound claims");

            var pending = select().kind("PersistentVolumeClaim").statusPhase("Pending").one();
            assert.equal(pending.metadata.name, "unbound-claim", "select unbound claims");
        }
    ]);

    volumesTest("volume Types", 4, fixtures, [
        "volumeData",
        'kubeSelect',
        function(volumeData, select) {
            var pv = select().kind("PersistentVolume").name("bound").one();
            var volumes = volumeData.volumesForPod(select().kind("Pod").one());
            assert.equal(volumeData.getVolumeType(pv.spec), "nfs", "correct type");
            assert.equal(volumeData.getVolumeType(volumes["default-token-luvqo"]), "secret", "secret volume");
            assert.equal(volumeData.getVolumeType(), undefined, "null volume");
            assert.equal(volumeData.getVolumeType({}), undefined, "empty volume");
        }
    ]);

    volumesTest("volume Labels", 3, fixtures, [
        "volumeData",
        'kubeSelect',
        function(volumeData, select) {
            var pv = select().kind("PersistentVolume").name("bound").one();
            assert.equal(volumeData.getVolumeLabel(), "Unknown", "null volume");
            assert.equal(volumeData.getVolumeLabel({}), "Unknown", "empty volume");
            assert.equal(volumeData.getVolumeLabel(pv.spec), "NFS Mount", "volume label");
        }
    ]);

    volumesTest("default volume build", 3, fixtures, [
        "defaultVolumeFields",
        "kubeSelect",
        function(volumeFields, select) {
            var blank_fields = {
              "accessModes": {
                "ReadOnlyMany": "Read only from multiple nodes",
                "ReadWriteMany": "Read and write from multiple nodes",
                "ReadWriteOnce": "Read and write from a single node"
              },
              "capacity": "",
              "policy": "Retain",
              "reclaimPolicies": {
                "Delete": "Delete",
                "Recycle": "Recycle",
                "Retain": "Retain"
              }
            };

            assert.deepEqual(blank_fields, volumeFields.build(), "default fields");
            assert.deepEqual(blank_fields, volumeFields.build({}), "empty fields");
            assert.deepEqual({
              "accessModes": {
                "ReadOnlyMany": "Read only from multiple nodes",
                "ReadWriteMany": "Read and write from multiple nodes",
                "ReadWriteOnce": "Read and write from a single node"
              },
              "capacity": "2Gi",
              "policy": "Retain",
              "ReadWriteMany": true,
              "reclaimPolicies": {
                "Delete": "Delete",
                "Recycle": "Recycle",
                "Retain": "Retain"
              }
            }, volumeFields.build(select().name("available").one()), "default fields");
        }
    ]);

    volumesTest("default volume validate", 15, fixtures, [
        "defaultVolumeFields",
        "kubeSelect",
        function(volumeFields, select) {
            var result = volumeFields.validate(null, {});
            assert.equal(result.data, null, "blank fields blank data");
            assert.equal(result.errors.length, 4);
            assert.equal(result.errors[0].target, "#last-access", "blank fields access error");
            assert.equal(result.errors[1].target, "#modify-name", "blank fields name error");
            assert.equal(result.errors[2].target, "#modify-capacity", "blank fields capacity error");
            assert.equal(result.errors[3].target, "#last-policy", "blank fields policy error");

            var invalid = {
                "reclaimPolicies": { "policy1": "policy2" },
                "accessModes": { "mode1": "mode1" },
                "mode2": true,
                "policy" : "policy2",
                "name": "a name",
                "capacity": "invalid"
            };
            result = volumeFields.validate(null, invalid);
            assert.equal(result.data, null, "invalid fields invalid data");
            assert.equal(result.errors.length, 4);
            assert.equal(result.errors[0].target, "#last-access", "invalid fields access error");
            assert.equal(result.errors[1].target, "#modify-name", "invalid fields name error");
            assert.equal(result.errors[2].target, "#modify-capacity", "invalid fields capacity error");
            assert.equal(result.errors[3].target, "#last-policy", "invalid fields policy error");

            var valid = {
                "reclaimPolicies": { "policy1": "policy2" },
                "accessModes": { "mode1": "mode1" },
                "mode1": true,
                "policy" : "policy1",
                "name": "  name ",
                "capacity": " 2Gi "
            };
            var spec = {
                "accessModes": [
                  "mode1"
                ],
                "capacity": {
                  "storage": "2Gi"
                },
                "persistentVolumeReclaimPolicy": "policy1"
            };
            result = volumeFields.validate(null, valid);
            assert.deepEqual(result.data, {
              "kind": "PersistentVolume",
              "metadata": {
                "name": "name"
              },
              "spec": spec
            }, "no item full object");
            assert.equal(result.errors.length, 0);

            result = volumeFields.validate({}, valid);
            assert.deepEqual(result.data, { "spec": spec }, "with item only spec");
        }
    ]);

    volumesTest("gluster volume build", 3, fixtures, [
        "glusterfsVolumeFields",
        "kubeSelect",
        function(gfs, select) {
            var endpoints = select().kind("Endpoints");
            var blank_fields = {
              "glusterfsPath": undefined,
              "endpoint": undefined,
              "endpointOptions": endpoints,
              "readOnly": undefined,
              "reclaimPolicies": {
                "Retain": "Retain"
              }
            };

            assert.deepEqual(blank_fields, gfs.build(), "default gluster fields");
            assert.deepEqual(blank_fields, gfs.build({}), "empty gluster fields");
            assert.deepEqual({
              "glusterfsPath": "kube_vo",
              "endpointOptions": endpoints,
              "readOnly": undefined,
              "reclaimPolicies": {
                "Retain": "Retain"
              },
              "endpoint": "my-gluster-endpoint",
            }, gfs.build(select().name("gfs-volume").one()), "gluster fields");
        }
    ]);

    volumesTest("gfs volume validate", 9, fixtures, [
        "glusterfsVolumeFields",
        function(nfsVolumeFields) {
            var result = nfsVolumeFields.validate(null, {});
            assert.equal(result.data, null, "blank fields blank data");
            assert.equal(result.errors.length, 2);
            assert.equal(result.errors[0].target, "#modify-endpoint", "blank fields endpoint error");
            assert.equal(result.errors[1].target, "#modify-glusterfs-path", "blank fields path error");

            var invalid = {
                "endpoint": "bad",
                "glusterfsPath": "name"
            };
            result = nfsVolumeFields.validate(null, invalid);
            assert.equal(result.data, null, "invalid fields invalid data");
            assert.equal(result.errors.length, 1);
            assert.equal(result.errors[0].target, "#modify-endpoint", "invalid endpoint error");

            var valid = {
                "endpoint": "my-gluster-endpoint",
                "glusterfsPath": "name",
            };
            var source = {
                "endpoints": "my-gluster-endpoint",
                "path": "name",
                "readOnly": false
            };
            result = nfsVolumeFields.validate(null, valid);
            assert.deepEqual(result.data, source, "valid source result");
            assert.equal(result.errors.length, 0, "no errors when valid");
        }
    ]);

    volumesTest("nfs volume build", 3, fixtures, [
        "nfsVolumeFields",
        "kubeSelect",
        function(nfsVolumeFields, select) {
            var blank_fields = {
              "path": undefined,
              "readOnly": undefined,
              "reclaimPolicies": {
                "Recycle": "Recycle",
                "Retain": "Retain"
              },
              "server": undefined
            };

            assert.deepEqual(blank_fields, nfsVolumeFields.build(), "default nfs fields");
            assert.deepEqual(blank_fields, nfsVolumeFields.build({}), "empty nfs fields");
            assert.deepEqual({
              "path": "/tmp",
              "readOnly": true,
              "reclaimPolicies": {
                "Recycle": "Recycle",
                "Retain": "Retain"
              },
              "server": "host-or.ip:port",
            }, nfsVolumeFields.build(select().name("bound").one()), "nfs fields");
        }
    ]);

    volumesTest("nfs volume validate", 10, fixtures, [
        "nfsVolumeFields",
        function(nfsVolumeFields) {
            var result = nfsVolumeFields.validate(null, {});
            assert.equal(result.data, null, "blank fields blank data");
            assert.equal(result.errors.length, 2);
            assert.equal(result.errors[0].target, "#nfs-modify-server", "blank fields server error");
            assert.equal(result.errors[1].target, "#modify-path", "blank fields path error");

            var invalid = {
                "server": "server/bad",
                "path": "bad",
            };
            result = nfsVolumeFields.validate(null, invalid);
            assert.equal(result.data, null, "invalid fields invalid data");
            assert.equal(result.errors.length, 2);
            assert.equal(result.errors[0].target, "#nfs-modify-server", "invalid fields server error");
            assert.equal(result.errors[1].target, "#modify-path", "invalid fields path error");

            var valid = {
                "server": "host.or-ip:port",
                "path": "/tmp",
            };
            var source = {
                "server": "host.or-ip:port",
                "path": "/tmp",
                "readOnly": false
            };
            result = nfsVolumeFields.validate(null, valid);
            assert.deepEqual(result.data, source, "valid source result");
            assert.equal(result.errors.length, 0, "no errors when valid");
        }
    ]);

    angular.module('exceptionOverride', []).factory('$exceptionHandler', function() {
        return function(exception, cause) {
            exception.message += ' (caused by "' + cause + '")';
            throw exception;
        };
    });

    module.run([
        '$injector',
        function($injector) {
            inject = function inject(func) {
                return $injector.invoke(func);
            };
            QUnit.start();
        }
    ]);

    angular.bootstrap(document, ['kubernetes.volumes.tests']);
}

/* Invoke the test suite with this data */
suite([
{
    "kind": "PersistentVolume",
    "apiVersion": "v1",
    "metadata": {
        "name": "iscsi-vol",
        "selfLink": "/api/v1/persistentvolumes/iscsi-vol",
        "uid": "3b2e0dc2-f6a4-11e5-9e36-5254009e00f2",
        "resourceVersion": "1325",
        "creationTimestamp": "2016-03-30T18:21:33Z"
    },
    "spec": {
        "capacity": {
            "storage": "2Gi"
        },
        "iscsi":{
            "targetPortal": "host-or.ip:port",
            "iqn": "iqn.1994-05.t.com.redhat:83ba4072bb9c",
            "lun": 10,
            "iscsiInterface": "custom-iface",
            "fsType":"ext3",
            "readOnly": true,
        },
        "accessModes":["ReadWriteOnce"],
        "persistentVolumeReclaimPolicy": "Retain"
    },
    "status": {
        "phase": "Available"
    }
},
{
    "kind": "PersistentVolume",
    "apiVersion": "v1",
    "metadata": {
        "name": "available",
        "selfLink": "/api/v1/persistentvolumes/available",
        "uid": "3b2e0dc2-f6a4-11e5-9e36-5254009e00f1",
        "resourceVersion": "1325",
        "creationTimestamp": "2016-03-30T18:21:33Z"
    },
    "spec": {
        "capacity": {
            "storage": "2Gi"
        },
        "hostPath": {
            "path": "/tmp"
        },
        "accessModes": [
            "ReadWriteMany"
        ],
        "persistentVolumeReclaimPolicy": "Retain"
    },
    "status": {
        "phase": "Available"
    }
},
{
    "kind": "PersistentVolume",
    "apiVersion": "v1",
    "metadata": {
        "name": "bound",
        "selfLink": "/api/v1/persistentvolumes/bound",
        "uid": "ae3133fc-f6a4-11e5-9e36-5254009e00f1",
        "resourceVersion": "1388",
        "creationTimestamp": "2016-03-30T18:24:46Z"
    },
    "spec": {
        "capacity": {
            "storage": "5Gi"
        },
        "nfs": {
            "path": "/tmp",
            "server": "host-or.ip:port",
            "readOnly": true
        },
        "accessModes": [
            "ReadWriteMany"
        ],
        "claimRef": {
            "kind": "PersistentVolumeClaim",
            "namespace": "default",
            "name": "bound-claim",
            "uid": "43dfbea5-f6a4-11e5-9e36-5254009e00f1",
            "apiVersion": "v1",
            "resourceVersion": "1331"
        },
        "persistentVolumeReclaimPolicy": "Retain"
    },
    "status": {
        "phase": "Bound"
    }
},
{
    "kind": "PersistentVolume",
    "apiVersion": "v1",
    "metadata": {
        "name": "gfs-volume",
        "selfLink": "/api/v1/persistentvolumes/gfs-volume",
        "uid": "ae3133fc-f6a4-11e5-9e36-5254009e00cc",
        "resourceVersion": "1388",
        "creationTimestamp": "2016-03-30T18:24:46Z"
    },
    "spec": {
        "capacity": {
            "storage": "5Gi"
        },
        "glusterfs": {
            "path": "kube_vo",
            "endpoints": "my-gluster-endpoint"
        },
        "accessModes": [
            "ReadWriteMany"
        ],
        "persistentVolumeReclaimPolicy": "Retain"
    },
    "status": {
        "phase": "Pending"
    }
},
{
    "kind": "PersistentVolumeClaim",
    "apiVersion": "v1",
    "metadata": {
        "name": "unbound-claim",
        "namespace": "default",
        "selfLink": "/api/v1/namespaces/default/persistentvolumeclaims/unbound-claim",
        "uid": "3d474220-f6b3-11e5-ab0c-3b97187a9955",
        "resourceVersion": "1331",
        "creationTimestamp": "2016-03-30T18:21:47Z"
    },
    "spec": {
        "accessModes": [
            "ReadWriteMany"
        ],
        "resources": {
            "requests": {
                "storage": "5Gi"
            }
        }
    },
    "status": {
        "phase": "Pending"
    }
},
{
    "kind": "PersistentVolumeClaim",
    "apiVersion": "v1",
    "metadata": {
        "name": "bound-claim",
        "namespace": "default",
        "selfLink": "/api/v1/namespaces/default/persistentvolumeclaims/bound-claim",
        "uid": "43dfbea5-f6a4-11e5-9e36-5254009e00f1",
        "resourceVersion": "1387",
        "creationTimestamp": "2016-03-30T18:21:47Z"
    },
    "spec": {
        "accessModes": [
            "ReadWriteMany"
        ],
        "resources": {
            "requests": {
                "storage": "5Gi"
            }
        },
        "volumeName": "available"
    },
    "status": {
        "phase": "Bound",
        "accessModes": [
            "ReadWriteMany"
        ],
        "capacity": {
            "storage": "5Gi"
        }
    }
},
{
    "kind": "Pod",
    "apiVersion": "v1",
    "metadata": {
        "name": "mock-pod",
        "namespace": "default",
        "selfLink": "/api/v1/namespaces/default/pods/mock-pod",
        "uid": "43d38e8e-f6a4-11e5-9e36-5254009e00f1",
        "resourceVersion": "1328",
        "creationTimestamp": "2016-03-30T18:21:47Z"
    },
    "spec": {
        "volumes": [
            {
                "name": "missing-claim",
                "persistentVolumeClaim": {
                    "claimName": "missing-claim"
                }
            },
            {
                "name": "host-tmp",
                "persistentVolumeClaim": {
                    "claimName": "bound-claim"
                }
            },
            {
                "name": "missing-claim2",
                "persistentVolumeClaim": {
                    "claimName": "missing-claim2"
                }
            },
            {
                "name": "default-token-luvqo",
                "secret": {
                    "secretName": "default-token-luvqo"
                }
            }
        ],
        "containers": [
            {
                "name": "mock-volume-container1",
                "image": "busybox:buildroot-2014.02",
                "command": [
                    "/bin/sh",
                    "-c",
                    "for x in $(seq 1 1000); do echo 'HelloMessage.' \u003e\u00262; sleep 1; done"
                ],
                "ports": [
                    {
                        "containerPort": 9949,
                        "protocol": "TCP"
                    }
                ],
                "resources": {},
                "volumeMounts": [
                    {
                        "name": "host-tmp",
                        "mountPath": "/tmp"
                    },
                    {
                        "name": "default-token-luvqo",
                        "readOnly": true,
                        "mountPath": "/var/run/secrets/kubernetes.io/serviceaccount"
                    }
                ]
            },
            {
                "name": "mock-volume-container",
                "image": "busybox:buildroot-2014.02",
                "command": [
                    "/bin/sh",
                    "-c",
                    "for x in $(seq 1 1000); do echo 'HelloMessage.' \u003e\u00262; sleep 1; done"
                ],
                "ports": [
                    {
                        "containerPort": 9949,
                        "protocol": "TCP"
                    }
                ],
                "resources": {},
                "volumeMounts": [
                    {
                        "name": "host-tmp",
                        "mountPath": "/other"
                    },
                    {
                        "name": "missing-claim",
                        "mountPath": "/tmp"
                    },
                    {
                        "name": "default-token-luvqo",
                        "readOnly": true,
                        "mountPath": "/var/run/secrets/kubernetes.io/serviceaccount"
                    }
                ]
            }
        ]
    },
    "status": {
        "phase": "Pending"
    }
},
{
    "kind": "Endpoints",
    "apiVersion": "v1",
    "metadata": {
        "name": "my-gluster-endpoint",
        "namespace": "default",
        "selfLink": "/api/v1/namespaces/default/endpoints/my-gluster-endpoint",
        "uid": "498cac38-ffc0-11e5-8098-5254009e00dd",
        "resourceVersion": "1078",
        "creationTimestamp": "2016-04-11T08:35:03Z"
    },
    "subsets": [
        {
            "addresses": [
                {
                    "ip": "172.17.0.2"
                }
            ],
            "ports": [
                {
                    "port": 1,
                    "protocol": "TCP"
                }
            ]
        }
    ]
}

]);
