/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

require("./kube-client");
require("./kube-client-cockpit");
require("./kube-client-mock");

var FIXTURE_BASIC = require("./fixture-basic");
var FIXTURE_LARGE = require("./fixture-large");

(function() {
    "use strict";

    /* Filled in with a function */
    var inject;
    var assert = QUnit;

    var module = angular.module("kubeClient.tests", [
        "kubeClient",
        "kubeClient.mock"
    ])

    .config([
        'KubeWatchProvider',
        'KubeRequestProvider',
        function(KubeWatchProvider, KubeRequestProvider) {
            KubeWatchProvider.KubeWatchFactory = "MockKubeWatch";
            KubeRequestProvider.KubeRequestFactory = "MockKubeRequest";
        }
    ]);

    function kubeTest(name, count, fixtures, func) {
        QUnit.asyncTest(name, function() {
            assert.expect(count);
            inject([
                "$q",
                '$exceptionHandler',
                "kubeLoader",
                "MockKubeData",
                function($q, $exceptionHandler, loader, data) {
                    if (fixtures)
                        data.load(fixtures);
                    loader.reset(true);

                    var result;
                    try {
                        result = inject(func);
                    } catch(ex) {
                        $exceptionHandler(ex);
                        assert.ok(!true, "test failed with exception: " + String(ex));
                        QUnit.start();
                        return;
                    }

                    $q.when(result, function() {
                        QUnit.start();
                    }, function(ex) {
                        $exceptionHandler(ex);
                        assert.ok(!true, "test failed with exception: " + String(ex));
                        QUnit.start();
                    });
                }
            ]);
        });
    }

    kubeTest("loader load", 7, FIXTURE_BASIC, [
        "kubeLoader",
        function(loader) {
            var promise = loader.load("nodes");
            assert.ok(!!promise, "promise returned");
            assert.equal(typeof promise.then, "function", "promise has then");
            assert.equal(typeof promise.catch, "function", "promise has catch");
            assert.equal(typeof promise.finally, "function", "promise has finally");

            return promise.then(function(items) {
                assert.ok(angular.isArray(items), "got items array");
                assert.equal(items.length, 1, "one node");
                assert.equal(items[0].metadata.name, "127.0.0.1", "localhost node");
            });
        }
    ]);

    kubeTest("loader load fail", 3, FIXTURE_BASIC, [
        "kubeLoader",
        function(loader) {
            var promise = loader.load("nonexistant");
            return promise.then(function(data) {
                assert.ok(!true, "successfully loaded");
            }, function(response) {
                assert.equal(response.code, 404, "not found");
                assert.equal(response.message, "Not found here", "not found message");
                assert.ok(true, "not sucessfully loaded");
            });
        }
    ]);

    kubeTest("loader watch", 3, FIXTURE_BASIC, [
        "kubeLoader",
        function(loader) {
            return loader.watch("nodes").then(function(response) {
                assert.ok("/api/v1/nodes/127.0.0.1" in loader.objects, "found node");
                var node = loader.objects["/api/v1/nodes/127.0.0.1"];
                assert.equal(node.metadata.name, "127.0.0.1", "localhost node");
                assert.equal(typeof node.spec.capacity, "object", "node has resources");
            });
        }
    ]);

    kubeTest("list nodes", 6, FIXTURE_BASIC, [
        "kubeLoader",
        "kubeSelect",
        function(loader, select) {
            return loader.watch("nodes").then(function() {
                var nodes = select().kind("Node");
                assert.ok("/api/v1/nodes/127.0.0.1" in nodes, "found node");
                var node = nodes["/api/v1/nodes/127.0.0.1"];
                assert.equal(node.metadata.name, "127.0.0.1", "localhost node");
                assert.equal(typeof node.spec.capacity, "object", "node has resources");

                /* The same thing should be returned */
                var nodes1 = select().kind("Node");
                assert.strictEqual(nodes, nodes1, "same object returned");

                /* Key should not be encoded as JSON */
                var parsed = JSON.parse(JSON.stringify(node));
                assert.ok(!("key" in parsed), "key should not be serialized");
                assert.strictEqual(parsed.key, undefined, "key not be undefined after serialize");
            });
        }
    ]);

    kubeTest("list pods", 3, FIXTURE_BASIC, [
        "kubeLoader",
        "kubeSelect",
        function(loader, select) {
            return loader.watch("pods").then(function() {
                var pods = select().kind("Pod");
                assert.equal(pods.length, 3, "found pods");
                var pod = pods["/api/v1/namespaces/default/pods/apache"];
                assert.equal(typeof pod, "object", "found pod");
                assert.equal(pod.metadata.labels.name, "apache", "pod has label");
            });
        }
    ]);

    kubeTest("set namespace", 7, FIXTURE_BASIC, [
        "$q",
        "kubeLoader",
        "kubeSelect",
        function($q, loader, select) {
            return loader.watch("pods").then(function() {
                var pods = select().kind("Pod");
                assert.equal(pods.length, 3, "number of pods");
                assert.strictEqual(loader.limits.namespace, null, "namespace is null");

                loader.limit({ namespace: "other" });
                assert.strictEqual(loader.limits.namespace, "other", "namespace is other");

                pods = select().kind("Pod");
                assert.equal(pods.length, 1, "pods from namespace other");
                assert.ok("/api/v1/namespaces/other/pods/apache" in pods, "other pod");

                loader.limit({ namespace: null });
                assert.strictEqual(loader.limits.namespace, null, "namespace is null again");
                var defer = $q.defer();
                var listened = false;
                var x = loader.listen(function() {
                    if (listened) {
                        pods = select().kind("Pod");
                        assert.equal(pods.length, 3, "all pods back");
                        x.cancel();
                        defer.resolve();
                    }
                    listened = true;
                });

                return defer.promise;
            });
        }
    ]);

    kubeTest("add pod", 3, FIXTURE_BASIC, [
        "$q",
        "kubeLoader",
        "kubeSelect",
        "MockKubeData",
        function($q, loader, select, data) {
            return loader.watch("pods").then(function() {
                var pods = select().kind("Pod");
                assert.equal(pods.length, 3, "number of pods");
                assert.equal(pods["/api/v1/namespaces/default/pods/apache"].metadata.labels.name,
                      "apache", "pod has label");

                var defer = $q.defer();
                var x = loader.listen(function() {
                    var pods = select().kind("Pod");
                    if (pods.length === 4) {
                        assert.equal(pods["/api/v1/namespaces/default/pods/aardvark"].metadata.labels.name,
                                     "aardvark", "new pod present in items");
                        x.cancel();
                        defer.resolve();
                    }
                });

                data.update("namespaces/default/pods/aardvark", {
                    "kind": "Pod",
                    "metadata": {
                        "name": "aardvark",
                        "uid": "22768037-ab8a-11e4-9a7c-080027300d85",
                        "namespace": "default",
                        "labels": {
                            "name": "aardvark"
                        },
                    },
                    "spec": {
                        "volumes": null,
                        "containers": [ ],
                        "imagePullPolicy": "IfNotPresent"
                    }
                });

                return defer.promise;
            });

        }
    ]);

    kubeTest("update pod", 3, FIXTURE_BASIC, [
        "$q",
        "kubeLoader",
        "kubeSelect",
        "MockKubeData",
        function($q, loader, select, data) {
            return loader.watch("pods").then(function() {
                var pods = select().kind("Pod");
                assert.equal(pods.length, 3, "number of pods");
                assert.equal(pods["/api/v1/namespaces/default/pods/apache"].metadata.labels.name,
                             "apache", "pod has label");

                var defer = $q.defer();
                var listened = false;
                var x = loader.listen(function() {
                    var pods;
                    if (listened) {
                        pods = select().kind("Pod");
                        assert.equal(pods["/api/v1/namespaces/default/pods/apache"].metadata.labels.name,
                                     "apachepooo", "pod has changed");
                        x.cancel();
                        defer.resolve();
                    }
                    listened = true;
                });

                data.update("namespaces/default/pods/apache", {
                    "kind": "Pod",
                    "metadata": {
                        "name": "apache",
                        "uid": "11768037-ab8a-11e4-9a7c-080027300d85",
                        "namespace": "default",
                        "labels": {
                            "name": "apachepooo"
                        },
                    }
                });

                return defer.promise;
            });
        }
    ]);

    kubeTest("remove pod", 5, FIXTURE_BASIC, [
        "$q",
        "kubeLoader",
        "kubeSelect",
        "MockKubeData",
        function($q, loader, select, data) {
            return loader.watch("pods").then(function() {
                var pods = select().kind("Pod");
                assert.equal(pods.length, 3, "number of pods");
                assert.equal(pods["/api/v1/namespaces/default/pods/apache"].metadata.labels.name,
                             "apache", "pod has label");

                var defer = $q.defer();
                var listened = false;
                var x = loader.listen(function() {
                    var pods;
                    if (listened) {
                        pods = select().kind("Pod");
                        assert.equal(pods.length, 2, "removed a pod");
                        assert.strictEqual(pods["/api/v1/namespaces/default/pods/apache"], undefined, "removed pod");
                        assert.equal(pods["/api/v1/namespaces/default/pods/database-1"].metadata.labels.name,
                                     "wordpressreplica", "other pod");
                        x.cancel();
                        defer.resolve();
                    }
                    listened = true;
                });

                data.update("namespaces/default/pods/apache", null);
                return defer.promise;
            });
        }
    ]);

    kubeTest("list services", 3, FIXTURE_BASIC, [
        "kubeLoader",
        "kubeSelect",
        function(loader, select) {
            return loader.watch("services").then(function() {
                var services = select().kind("Service");
                var x, svc = null;
                for (x in services) {
                    svc = services[x];
                    break;
                }
                assert.equal(services.length, 2, "number of services");
                assert.equal(svc.metadata.name, "kubernetes", "service id");
                assert.equal(svc.spec.selector.component, "apiserver", "service has label");
            });
        }
    ]);

    var CREATE_ITEMS = [
        {
            "kind": "Pod",
            "apiVersion": "v1",
            "metadata": {
                "name": "pod1",
                "uid": "d072fb85-f70e-11e4-b829-10c37bdb8410",
                "resourceVersion": "634203",
                "labels": {
                    "name": "pod1"
                },
            },
            "spec": {
                "volumes": null,
                "containers": [{
                    "name": "database",
                    "image": "mysql",
                    "ports": [{ "containerPort": 3306, "protocol": "TCP" }],
                }],
                "nodeName": "127.0.0.1"
            }
        },{
            "kind": "Node",
            "apiVersion": "v1",
            "metadata": {
                "name": "node1",
                "uid": "6e51438e-d161-11e4-acbc-10c37bdb8410",
                "resourceVersion": "634539",
            },
            "spec": {
                "externalID": "172.2.3.1"
            }
        }
    ];

    kubeTest("create", 2, FIXTURE_BASIC, [
        "kubeLoader",
        "kubeMethods",
        function(loader, methods) {
            loader.watch("pods");
            loader.watch("nodes");
            loader.watch("namespaces");
            return methods.create(CREATE_ITEMS, "namespace1").then(function() {
                assert.equal(loader.objects["/api/v1/namespaces/namespace1/pods/pod1"].metadata.name, "pod1", "pod object");
                assert.equal(loader.objects["/api/v1/nodes/node1"].metadata.name, "node1", "node object");
            });
        }
    ]);

    kubeTest("create namespace exists", 3, FIXTURE_BASIC, [
        "kubeLoader",
        "kubeMethods",
        function(loader, methods) {
            loader.watch("pods");
            loader.watch("nodes");
            loader.watch("namespaces");

            var NAMESPACE_ITEM = {
                "apiVersion" : "v1",
                "kind" : "Namespace",
                "metadata" : { "name": "namespace1" }
            };

            return methods.create(NAMESPACE_ITEM).then(function() {
                assert.ok("/api/v1/namespaces/namespace1" in loader.objects, "namespace created");

                return methods.create(CREATE_ITEMS, "namespace1").then(function() {
                    assert.ok("/api/v1/namespaces/namespace1/pods/pod1" in loader.objects, "pod created");
                    assert.ok("/api/v1/nodes/node1" in loader.objects, "node created");
                });
            });
        }
    ]);

    kubeTest("create namespace default", 2, FIXTURE_BASIC, [
        "kubeLoader",
        "kubeMethods",
        function(loader, methods) {
            loader.watch("pods");
            loader.watch("nodes");
            loader.watch("namespaces");
            return methods.create(CREATE_ITEMS).then(function() {
                assert.equal(loader.objects["/api/v1/namespaces/default/pods/pod1"].metadata.name, "pod1", "pod created");
                assert.equal(loader.objects["/api/v1/nodes/node1"].metadata.name, "node1", "node created");
            });
        }
    ]);

    kubeTest("create object exists", 1, FIXTURE_BASIC, [
        "kubeLoader",
        "kubeMethods",
        function(loader, methods) {
            loader.watch("pods");
            loader.watch("nodes");
            loader.watch("namespaces");

            var items = CREATE_ITEMS.slice();
            items.push(items[0]);

            return methods.create(items).then(function(response) {
                assert.equal(response, false, "should have failed");
            }, function(response) {
                assert.equal(response.code, 409, "http already exists");
            });
        }
    ]);

    kubeTest("delete pod", 3, FIXTURE_BASIC, [
        "kubeLoader",
        "kubeMethods",
        function(loader, methods) {
            var watch = loader.watch("pods");

            return methods.create(CREATE_ITEMS, "namespace2").then(function() {
                assert.ok("/api/v1/namespaces/namespace2/pods/pod1" in loader.objects, "pod created");
                return methods.delete("/api/v1/namespaces/namespace2/pods/pod1").then(function() {
                    assert.ok(true, "remove succeeded");
                    return watch.finally(function() {
                        assert.ok(!("/api/v1/namespaces/namespace2/pods/pod1" in loader.objects), "pod was removed");
                    });
                });
            });
        }
    ]);

    kubeTest("patch pod", 4, FIXTURE_BASIC, [
        "kubeLoader",
        "kubeMethods",
        function(loader, methods) {
            var watch = loader.watch("pods");
            var path = "/api/v1/namespaces/namespace2/pods/pod1";

            return methods.create(CREATE_ITEMS, "namespace2").then(function() {
                assert.ok(path in loader.objects, "pod created");
                return methods.patch(path, { "extra": "blah" }).then(function() {
                    assert.ok(true, "patch succeeded");
                    return methods.patch(loader.objects[path], { "second": "test" }).then(function() {
                        return watch.finally(function() {
                            var pod = loader.objects[path];
                            assert.equal(pod.extra, "blah", "pod has changed");
                            assert.equal(pod.second, "test", "pod changed by own object");
                        });
                    });
                });
            });
        }
    ]);

    kubeTest("post", 1, FIXTURE_BASIC, [
        "kubeLoader",
        "kubeMethods",
        function(loader, methods) {
            return methods.post("/api/v1/namespaces/namespace1/pods", CREATE_ITEMS[0]).then(function(response) {
                assert.equal(response.metadata.name, "pod1", "pod object");
            });
        }
    ]);

    kubeTest("post fail", 1, FIXTURE_BASIC, [
        "kubeLoader",
        "kubeMethods",
        function(loader, methods) {
            return methods.post("/api/v1/nodes", FIXTURE_BASIC["nodes/127.0.0.1"]).then(function() {
                assert.ok(false, "shouldn't succeed");
            }, function(response) {
                assert.deepEqual(response, { "code": 409, "message": "Already exists" }, "got failure code");
            });
        }
    ]);

    kubeTest("put", 1, FIXTURE_BASIC, [
        "kubeLoader",
        "kubeMethods",
        function(loader, methods) {
            var node = { "kind": "Node", "metadata": { "name": "127.0.0.1", labels: { "test": "value" } } };
            return methods.put("/api/v1/nodes/127.0.0.1", node).then(function(response) {
                assert.deepEqual(response.metadata.labels, { "test": "value" }, "put returned object");
            });
        }
    ]);

    kubeTest("check resource ok", 0, null, [
        "kubeMethods",
        function(methods) {
            var data = { kind: "Blah", metadata: { name: "test" } };
            return methods.check(data);
        }
    ]);

    kubeTest("check resource name empty", 3, null, [
        "kubeMethods",
        function(methods) {
            var data = { kind: "Blah", metadata: { name: "" } };
            return methods.check(data).catch(function(ex) {
                assert.ok(angular.isArray(ex), "threw array of failures");
                assert.equal(ex.length, 1, "number of errors");
                assert.ok(ex[0] instanceof Error, "threw an error");
            });
        }
    ]);

    kubeTest("check resource name missing", 1, null, [
        "kubeMethods",
        function(methods) {
            var data = { kind: "Blah", metadata: {  } };
            return methods.check(data).then(function() {
                assert.ok(true, "passed check");
            }, null);
        }
    ]);

    kubeTest("check resource name namespace bad", 6, null, [
        "kubeMethods",
        function(methods) {
            var data = { kind: "Blah", metadata: { name: "a#a", namespace: "" } };
            var targets = { "metadata.name": "#name", "metadata.namespace": "#namespace" };
            return methods.check(data, targets).catch(function(ex) {
                assert.ok(angular.isArray(ex), "threw array of failures");
                assert.equal(ex.length, 2, "number of errors");
                assert.ok(ex[0] instanceof Error, "threw an error");
                assert.equal(ex[0].target, "#name", "correct name target");
                assert.ok(ex[1] instanceof Error, "threw an error");
                assert.equal(ex[1].target, "#namespace", "correct name target");
            });
        }
    ]);

    kubeTest("check resource namespace bad", 4, null, [
        "kubeMethods",
        function(methods) {
            var data = { kind: "Blah", metadata: { name: "aa", namespace: "" } };
            var targets = { "metadata.name": "#name", "metadata.namespace": "#namespace" };
            return methods.check(data, targets).catch(function(ex) {
                assert.ok(angular.isArray(ex), "threw array of failures");
                assert.equal(ex.length, 1, "number of errors");
                assert.ok(ex[0] instanceof Error, "threw an error");
                assert.equal(ex[0].target, "#namespace", "correct name target");
            });
        }
    ]);

    kubeTest("lookup uid", 3, FIXTURE_BASIC, [
        "kubeLoader",
        "kubeSelect",
        function(loader, select) {
            return loader.watch("pods").then(function() {
                /* Get the item */
                var item = select().kind("Pod").one();
                var uid = item.metadata.uid;
                assert.ok(uid, "Have uid");

                var by_uid_item = select().uid(uid).one();
                assert.strictEqual(item, by_uid_item, "load uid");

                /* Shouldn't match */
                item = select().uid("bad").one();
                assert.strictEqual(item, null, "mismatch uid");
            });
        }
    ]);

    kubeTest("lookup host", 2, FIXTURE_BASIC, [
        "kubeLoader",
        "kubeSelect",
        function(loader, select) {
            return loader.watch("pods").then(function() {
                /* Get the item */
                var item = select().host("127.0.0.1").one();
                assert.deepEqual(item.metadata.selfLink, "/api/v1/namespaces/default/pods/database-1", "correct pod");

                /* Shouldn't match */
                item = select().host("127.0.0.2").one();
                assert.strictEqual(item, null, "mismatch host");
            });
        }
    ]);

    kubeTest("lookup", 6, FIXTURE_LARGE, [
        "kubeLoader",
        "kubeSelect",
        function(loader, select) {
            var expected = {
                "apiVersion": "v1",
                "kind": "ReplicationController",
                "metadata": { "labels": { "example": "mock", "name": "3controller" },
                    "name": "3controller",
                    "resourceVersion": 10000,
                    "uid": "11768037-ab8a-11e4-9a7c-100001001",
                    "namespace": "default",
                    "selfLink": "/api/v1/namespaces/default/replicationcontrollers/3controller",
                },
                "spec": { "replicas": 1, "selector": { "factor3": "yes" } }
            };

            return loader.watch("replicationcontrollers").then(function() {
                /* Get the item */
                var item = select().kind("ReplicationController").name("3controller").namespace("default").one();
                assert.deepEqual(item, expected, "correct item");

                /* The same item, without namespace */
                item = select().kind("ReplicationController").name("3controller").one();
                assert.deepEqual(item, expected, "selected without namespace");

                /* Any replication controller */
                item = select().kind("ReplicationController").one();
                assert.equal(item.kind, "ReplicationController", "any replication controller");

                /* Shouldn't match */
                item = select().kind("BadKind").name("3controller").namespace("default").one();
                assert.strictEqual(item, null, "mismatch kind");
                item = select().kind("ReplicationController").name("badcontroller").namespace("default").one();
                assert.strictEqual(item, null, "mismatch name");
                item = select().kind("ReplicationController").name("3controller").namespace("baddefault").one();
                assert.strictEqual(item, null, "mismatch namespace");
            });
        }
    ]);

    kubeTest("select", 12, FIXTURE_LARGE, [
        "kubeLoader",
        "kubeSelect",
        function(loader, select) {
            return loader.watch("pods").then(function() {
                var image = { kind: "Image" };

                /* same thing twice */
                var first = select(image);
                var second = select(image);
                assert.strictEqual(first, second, "identical for single object");

                /* null thing twice */
                first = select(null);
                second = select(null);
                assert.strictEqual(first, second, "identical for null object");

                /* Select everything odd, 500 pods */
                var results = select().namespace("default").label({ "type": "odd" });
                assert.equal(results.length, 500, "correct amount");

                /* The same thing should be returned */
                var results1 = select().namespace("default").label({ "type": "odd" });
                assert.strictEqual(results, results1, "same object returned");

                /* Select everything odd, but wrong namespace, no pods */
                results = select().namespace("other").label({ "type": "odd" });
                assert.equal(results.length, 0, "other namespace no pods");

                /* The same ones selected even when a second (present) label */
                results = select().namespace("default").label({ "type": "odd", "tag": "silly"  });
                assert.equal(results.length, 500, "with additional label");

                /* Nothing selected when additional invalid field */
                results = select().namespace("default").label({ "type": "odd", "tag": "billy"  });
                assert.equal(results.length, 0, "no objects");

                /* Limit by kind */
                results = select().kind("Pod").namespace("default").label({ "type": "odd" });
                assert.equal(results.length, 500, "by kind");

                /* Limit by invalid kind */
                results = select().kind("Ood").namespace("default").label({ "type": "odd" });
                assert.equal(results.length, 0, "nothing for invalid kind");

                /* Everything selected when no selector */
                results = select().namespace("default");
                assert.equal(results.length, 1000, "all pods");

                /* Nothing selected when bad namespace */
                results = select().namespace("bad");
                assert.equal(results.length, 0, "bad namespace no objects");

                /* Nothing selected when empty selector */
                results = select().label({ });
                assert.equal(results.length, 0, "nothing selected");
            });
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

    angular.bootstrap(document, ['kubeClient.tests']);
}());
