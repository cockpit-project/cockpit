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

require("./images");

function suite(fixtures) {
    "use strict";

    /* Filled in with a function */
    var inject;
    var assert = QUnit;

    var module = angular.module("registry.images.tests", [
        "kubeClient",
        "registry.images",
    ]);

    function imagesTest(name, count, fixtures, func) {
        QUnit.test(name, function() {
            assert.expect(count);
            inject([
                "kubeLoader",
                function(loader) {
                    loader.reset(true);
                    if (fixtures)
                        loader.handle(fixtures);
                }
            ]);
            inject(func);
        });
    }

    imagesTest("filter containsTagImage", 7, fixtures, [
        "kubeSelect",
        "imageData",
        function(select, data) {
            var streams = select().containsTagImage("sha256:c1ee91e9f0f96ea280d17befdd968ce4e37653939fc9e5e36429cd9674a28719");
            assert.equal(streams.length, 2, "number ofstreams");
            assert.ok("/oapi/v1/namespaces/marmalade/imagestreams/busybee" in streams, "matched busybee");
            assert.ok("/oapi/v1/namespaces/marmalade/imagestreams/juggs" in streams, "matched juggs");

            streams = select().containsTagImage("sha256:0885eeaec4514820b2c879100425e9ea10beaf4412db7f67acfe53b4df2b9450");
            assert.equal(streams.length, 1, "one stream matched");
            assert.ok("/oapi/v1/namespaces/marmalade/imagestreams/juggs" in streams, "other stream matched juggs");
            assert.ok(!("/oapi/v1/namespaces/marmalade/imagestreams/busybee" in streams), "other stream not busybee");

            /* An unknown image */
            streams = select().containsTagImage("sha256:2077956b196342f92271663ec85124aef44ee486f141b7d48e6ce5be410d78f1");
            assert.equal(streams.length, 0, "no streams selected");
        }
    ]);

    imagesTest("filter taggedBy", 4, fixtures, [
        "kubeSelect",
        "imageData",
        function(select, data) {
            var tag = { "tag": "2.5", "items": [
                { "image": "sha256:beadfbc3da8d183c245ab5bad4dd185dacde72dbe81b270926e60e705e534afb" },
                { "image": "sha256:0885eeaec4514820b2c879100425e9ea10beaf4412db7f67acfe53b4df2b9450" }
            ]};

            var images = select().kind("Image").taggedBy(tag);
            assert.equal(images.length, 2, "number of images");
            assert.ok("/oapi/v1/images/sha256:beadfbc3da8d183c245ab5bad4dd185dacde72dbe81b270926e60e705e534afb" in images, "matched busybee");
            assert.ok("/oapi/v1/images/sha256:0885eeaec4514820b2c879100425e9ea10beaf4412db7f67acfe53b4df2b9450" in images, "matched juggs");

            tag = { "tag": "2.5", "items": [
                { "image": "sha256:00329beccad118aa937e839d536d753ee612b67f8feb6adb519e7f5aa6e75fbe" },
                { "image": "sha256:0085eeaec4514820b2c879100425e9ea10beaf4412db7f67acfe53b4df2b9450" }
            ]};

            images = select().kind("Image").taggedBy(tag);
            assert.equal(images.length, 0, "no images matched");
        }
    ]);

    imagesTest("filter taggedFirst", 4, fixtures, [
        "kubeSelect",
        "imageData",
        function(select, data) {
            var tag = { "tag": "2.5", "items": [
                { "image": "sha256:beadfbc3da8d183c245ab5bad4dd185dacde72dbe81b270926e60e705e534afb" },
                { "image": "sha256:0885eeaec4514820b2c879100425e9ea10beaf4412db7f67acfe53b4df2b9450" }
            ]};

            var images = select().kind("Image").taggedFirst(tag);
            assert.equal(images.length, 1, "number of images");
            assert.ok("/oapi/v1/images/sha256:beadfbc3da8d183c245ab5bad4dd185dacde72dbe81b270926e60e705e534afb" in images, "matched busybee");
            assert.ok(!("/oapi/v1/images/sha256:0885eeaec4514820b2c879100425e9ea10beaf4412db7f67acfe53b4df2b9450" in images), "didn't match juggs");

            tag = { "tag": "2.5", "items": [
                { "image": "sha256:00329beccad118aa937e839d536d753ee612b67f8feb6adb519e7f5aa6e75fbe" },
                { "image": "sha256:0085eeaec4514820b2c879100425e9ea10beaf4412db7f67acfe53b4df2b9450" }
            ]};

            images = select().kind("Image").taggedFirst(tag);
            assert.equal(images.length, 0, "no images matched");
        }
    ]);


    imagesTest("filter listTagNames", 3, fixtures, [
        "kubeSelect",
        "imageData",
        function(select, data) {
            var names = select().listTagNames("sha256:c1ee91e9f0f96ea280d17befdd968ce4e37653939fc9e5e36429cd9674a28719");
            assert.deepEqual(names, ["marmalade/busybee:latest", "marmalade/juggs:extratag"], "got right names");

            names = select().listTagNames("sha256:0885eeaec4514820b2c879100425e9ea10beaf4412db7f67acfe53b4df2b9450");
            assert.deepEqual(names, ["marmalade/juggs:latest"], "got another image tag name");

            names = select().listTagNames("sha256:2077956b196342f92271663ec85124aef44ee486f141b7d48e6ce5be410d78f1");
            assert.deepEqual(names, [], "no names returned");
        }
    ]);

    imagesTest("split dockerImageManifest", 3, fixtures, [
        "kubeSelect",
        "imageData",
        function(select, data) {
            var items = select().kind("DockerImageManifest").name("sha256:63da16dc866fa7bfca4dd9d45b70feda28aa383c9ca1f1766c127ccc715a8cb7");
            assert.equal(items.length, 1, "only manifest returned");

            var item = items["/internal/manifests/sha256:63da16dc866fa7bfca4dd9d45b70feda28aa383c9ca1f1766c127ccc715a8cb7"];
            assert.ok(!!item, "got right manifest");

            assert.equal(item.manifest.history[0].v1Compatibility.config.Hostname, "13709f13afe1", "parsed manifest and compat");
        }
    ]);

    imagesTest("filter dockerConfigLabels", 3, fixtures, [
        "kubeSelect",
        "imageData",
        function(select, data) {
            var results = select().kind("Image").dockerImageConfig().dockerConfigLabels();
            assert.equal(results.length, 1, "got one set of labels");

            var again = select().kind("Image").dockerImageConfig().dockerConfigLabels();
            assert.strictEqual(results, again, "cached results");

            var labels = results["/oapi/v1/images/sha256:63da16dc866fa7bfca4dd9d45b70feda28aa383c9ca1f1766c127ccc715a8cb7"];
            assert.deepEqual(labels, { "Test": "Value", "version": "1.0" }, "got right labels");
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

    angular.bootstrap(document, ['registry.images.tests']);
}

/* Invoke the test suite with this data */
suite([
    { "kind": "ImageStream", "apiVersion": "v1",
      "metadata": { "name": "busybee", "namespace": "marmalade",
           "selfLink": "/oapi/v1/namespaces/marmalade/imagestreams/busybee",
           "uid": "4612c052-b44e-11e5-a4da-5254009e00f1"
      },
      "spec": {},
      "status": {
            "dockerImageRepository": "172.30.87.3:5000/marmalade/busybee",
            "tags": [
                { "tag": "0.x", "items": [
                        { "created": "2016-01-06T08:19:58Z",
                            "dockerImageReference": "172.30.87.3:5000/marmalade/busybee@sha256:beadfbc3da8d183c245ab5bad4dd185dacde72dbe81b270926e60e705e534afb",
                            "image": "sha256:beadfbc3da8d183c245ab5bad4dd185dacde72dbe81b270926e60e705e534afb"
                        } ]
                },
                { "tag": "latest", "items": [
                        { "created": "2016-01-06T08:19:58Z",
                            "dockerImageReference": "172.30.87.3:5000/marmalade/busybee@sha256:c1ee91e9f0f96ea280d17befdd968ce4e37653939fc9e5e36429cd9674a28719",
                            "image": "sha256:c1ee91e9f0f96ea280d17befdd968ce4e37653939fc9e5e36429cd9674a28719"
                        } ]
                }
            ]
        }
    },
    { "kind": "ImageStream", "apiVersion": "v1",
        "metadata": { "name": "juggs", "namespace": "marmalade",
            "selfLink": "/oapi/v1/namespaces/marmalade/imagestreams/juggs",
            "uid": "84e3a672-b44e-11e5-a4da-5254009e00f1"
        },
        "spec": {},
        "status": {
            "dockerImageRepository": "172.30.87.3:5000/marmalade/juggs",
            "tags": [
                { "tag": "2.11", "items": [
                    { "created": "2016-01-06T08:21:43Z",
                        "dockerImageReference": "172.30.87.3:5000/marmalade/juggs@sha256:b074b7b7905895741f7425ab4e78b9df384aaa518258d2e81d9e904ecf6c9f0f",
                        "image": "sha256:b074b7b7905895741f7425ab4e78b9df384aaa518258d2e81d9e904ecf6c9f0f"
                    } ]
                },
                { "tag": "2.5", "items": [
                    { "created": "2016-01-06T08:21:46Z",
                        "dockerImageReference": "172.30.87.3:5000/marmalade/juggs@sha256:d0329beccad118aa937e839d536d753ee612b67f8feb6adb519e7f5aa6e75fbe",
                        "image": "sha256:d0329beccad118aa937e839d536d753ee612b67f8feb6adb519e7f5aa6e75fbe"
                    } ]
                },
                { "tag": "latest", "items": [
                    { "created": "2016-01-06T08:21:43Z",
                        "dockerImageReference": "172.30.87.3:5000/marmalade/juggs@sha256:0885eeaec4514820b2c879100425e9ea10beaf4412db7f67acfe53b4df2b9450",
                        "image": "sha256:0885eeaec4514820b2c879100425e9ea10beaf4412db7f67acfe53b4df2b9450"
                    } ]
                },
                { "tag": "extratag", "items": [
                        { "created": "2016-01-06T08:19:58Z",
                            "dockerImageReference": "172.30.87.3:5000/marmalade/busybee@sha256:c1ee91e9f0f96ea280d17befdd968ce4e37653939fc9e5e36429cd9674a28719",
                            "image": "sha256:c1ee91e9f0f96ea280d17befdd968ce4e37653939fc9e5e36429cd9674a28719"
                        } ]
                }
            ]
        }
    },
    { "kind": "ImageStream", "apiVersion": "v1",
        "metadata": { "name": "origin", "namespace": "marmalade",
            "selfLink": "/oapi/v1/namespaces/marmalade/imagestreams/origin",
            "uid": "94813e0a-b44e-11e5-a4da-5254009e00f1"
        },
        "spec": {},
        "status": {
            "dockerImageRepository": "172.30.87.3:5000/marmalade/origin",
            "tags": [
                { "tag": "latest", "items": [
                    { "created": "2016-01-06T08:22:10Z",
                        "dockerImageReference": "172.30.87.3:5000/marmalade/origin@sha256:6077956b196342f92271663ec85124aef44ee486f141b7d48e6ce5be410d78f1",
                        "image": "sha256:6077956b196342f92271663ec85124aef44ee486f141b7d48e6ce5be410d78f1"
                    } ]
                }
            ]
        }
    },

    { "kind": "Image", "apiVersion": "v1", "metadata": {
            "name": "sha256:0885eeaec4514820b2c879100425e9ea10beaf4412db7f67acfe53b4df2b9450",
            "selfLink": "/oapi/v1/images/sha256:0885eeaec4514820b2c879100425e9ea10beaf4412db7f67acfe53b4df2b9450",
        },
        "dockerImageReference": "172.30.87.3:5000/marmalade/juggs@sha256:0885eeaec4514820b2c879100425e9ea10beaf4412db7f67acfe53b4df2b9450",
        "dockerImageMetadata": { "kind": "DockerImage", "apiVersion": "1.0", "Id": "",
            "Created": null, "ContainerConfig": {} },
        "dockerImageMetadataVersion": "1.0",
    },
    {
        "kind": "Image", "apiVersion": "v1", "metadata": {
            "name": "sha256:6077956b196342f92271663ec85124aef44ee486f141b7d48e6ce5be410d78f1",
            "selfLink": "/oapi/v1/images/sha256:6077956b196342f92271663ec85124aef44ee486f141b7d48e6ce5be410d78f1",
        },
        "dockerImageReference": "172.30.87.3:5000/marmalade/origin@sha256:6077956b196342f92271663ec85124aef44ee486f141b7d48e6ce5be410d78f1",
        "dockerImageMetadata": { "kind": "DockerImage", "apiVersion": "1.0", "Id": "",
            "Created": null, "ContainerConfig": {} },
        "dockerImageMetadataVersion": "1.0",
    },
    { "kind": "Image", "apiVersion": "v1",
        "metadata": {
            "name": "sha256:98842019ab49391fe6b419eb131211ceb1aa17a89f655b05e7305366fecea5f2",
            "selfLink": "/oapi/v1/images/sha256:98842019ab49391fe6b419eb131211ceb1aa17a89f655b05e7305366fecea5f2",
        },
        "dockerImageReference": "172.30.87.3:5000/zerog/test@sha256:98842019ab49391fe6b419eb131211ceb1aa17a89f655b05e7305366fecea5f2",
        "dockerImageMetadata": { "kind": "DockerImage", "apiVersion": "1.0", "Id": "",
            "Created": null, "ContainerConfig": {} },
        "dockerImageMetadataVersion": "1.0",
    },
    {
        "kind": "Image", "apiVersion": "v1", "metadata": {
            "name": "sha256:a7ca0c3e270a994cfdef0a1d77d8bd41d401135f2f9e02e0a3661cd026e81a77",
            "selfLink": "/oapi/v1/images/sha256:a7ca0c3e270a994cfdef0a1d77d8bd41d401135f2f9e02e0a3661cd026e81a77",
        },
        "dockerImageReference": "172.30.87.3:5000/zerog/test@sha256:a7ca0c3e270a994cfdef0a1d77d8bd41d401135f2f9e02e0a3661cd026e81a77",
        "dockerImageMetadata": { "kind": "DockerImage", "apiVersion": "1.0", "Id": "",
            "Created": null, "ContainerConfig": {} },
        "dockerImageMetadataVersion": "1.0",
    },
    {
        "kind": "Image", "apiVersion": "v1", "metadata": {
            "name": "sha256:b074b7b7905895741f7425ab4e78b9df384aaa518258d2e81d9e904ecf6c9f0f",
            "selfLink": "/oapi/v1/images/sha256:b074b7b7905895741f7425ab4e78b9df384aaa518258d2e81d9e904ecf6c9f0f",
        },
        "dockerImageReference": "172.30.87.3:5000/marmalade/juggs@sha256:b074b7b7905895741f7425ab4e78b9df384aaa518258d2e81d9e904ecf6c9f0f",
        "dockerImageMetadata": { "kind": "DockerImage", "apiVersion": "1.0", "Id": "",
            "Created": null, "ContainerConfig": {} },
        "dockerImageMetadataVersion": "1.0",
    },
    {
        "kind": "Image", "apiVersion": "v1", "metadata": {
            "name": "sha256:beadfbc3da8d183c245ab5bad4dd185dacde72dbe81b270926e60e705e534afb",
            "selfLink": "/oapi/v1/images/sha256:beadfbc3da8d183c245ab5bad4dd185dacde72dbe81b270926e60e705e534afb",
        },
        "dockerImageReference": "172.30.87.3:5000/marmalade/busybee@sha256:beadfbc3da8d183c245ab5bad4dd185dacde72dbe81b270926e60e705e534afb",
        "dockerImageMetadata": { "kind": "DockerImage", "apiVersion": "1.0", "Id": "",
            "Created": null, "ContainerConfig": {} },
        "dockerImageMetadataVersion": "1.0",
    },
    {
        "kind": "Image", "apiVersion": "v1", "metadata": {
            "name": "sha256:c1ee91e9f0f96ea280d17befdd968ce4e37653939fc9e5e36429cd9674a28719",
            "selfLink": "/oapi/v1/images/sha256:c1ee91e9f0f96ea280d17befdd968ce4e37653939fc9e5e36429cd9674a28719",
        },
        "dockerImageReference": "172.30.87.3:5000/marmalade/busybee@sha256:c1ee91e9f0f96ea280d17befdd968ce4e37653939fc9e5e36429cd9674a28719",
        "dockerImageMetadata": { "kind": "DockerImage", "apiVersion": "1.0", "Id": "",
            "Created": null, "ContainerConfig": {} },
        "dockerImageMetadataVersion": "1.0",
    },
    {
        "kind": "Image", "apiVersion": "v1", "metadata": {
            "name": "sha256:63da16dc866fa7bfca4dd9d45b70feda28aa383c9ca1f1766c127ccc715a8cb7",
            "selfLink": "/oapi/v1/images/sha256:63da16dc866fa7bfca4dd9d45b70feda28aa383c9ca1f1766c127ccc715a8cb7",
            "annotations": { "openshift.io/image.managed": "true" }
        },
        "dockerImageReference": "172.30.198.253:5000/marmalade/juggs@sha256:63da16dc866fa7bfca4dd9d45b70feda28aa383c9ca1f1766c127ccc715a8cb7",
        "dockerImageMetadata": { "kind": "DockerImage", "apiVersion": "1.0",
            "Id": "fc5cd5d8ca78a17843aba9b1b66e9d0e17200d86b0aad9a4f70d893a10c26b6d",
            "Parent": "9192c6aa777087e5c06e1d5f1771295f7cd79d9473d71dba2241e68aa2d36807",
            "Created": "2016-03-04T16:50:11Z",
            "Container": "7a453b461abfb9410f73e4449ed50d5840a44afb25b0144715b4266ee6d48f2d",
            "ContainerConfig": { "Hostname": "13709f13afe1",
                "User": "nobody:wheel", "ExposedPorts": { "8888/tcp": {} },
                "Env": [ "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" ],
                "Cmd": [ "/bin/sh", "-c", "#(nop) LABEL version=1.0" ],
                "Image": "9192c6aa777087e5c06e1d5f1771295f7cd79d9473d71dba2241e68aa2d36807",
                "Entrypoint": [ "top", "-b" ],
                "OnBuild": [ "ADD . /app/src" ],
                "Labels": { "Test": "Value", "version": "1.0" }
            },
            "DockerVersion": "1.9.1",
            "Config": { "Hostname": "13709f13afe1", "User": "nobody:wheel",
                "ExposedPorts": { "8888/tcp": {} },
                "Env": [ "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" ],
                "Cmd": [ "-c" ],
                "Image": "9192c6aa777087e5c06e1d5f1771295f7cd79d9473d71dba2241e68aa2d36807",
                "Entrypoint": [ "top", "-b" ],
                "OnBuild": [ "ADD . /app/src" ],
                "Labels": { "Test": "Value", "version": "1.0" }
            },
            "Architecture": "amd64",
            "Size": 126388696
        },
        "dockerImageMetadataVersion": "1.0",
        "dockerImageManifest": "{\n   \"schemaVersion\": 1,\n   \"name\": \"marmalade/juggs\",\n   \"tag\": \"2.8\",\n   \"architecture\": \"amd64\",\n   \"fsLayers\": [\n      {\n         \"blobSum\": \"sha256:a3ed95caeb02ffe68cdd9fd84406680ae93d633cb16422d00e8a7c22955b46d4\"\n      },\n      {\n         \"blobSum\": \"sha256:a3ed95caeb02ffe68cdd9fd84406680ae93d633cb16422d00e8a7c22955b46d4\"\n      },\n      {\n         \"blobSum\": \"sha256:a3ed95caeb02ffe68cdd9fd84406680ae93d633cb16422d00e8a7c22955b46d4\"\n      },\n      {\n         \"blobSum\": \"sha256:a3ed95caeb02ffe68cdd9fd84406680ae93d633cb16422d00e8a7c22955b46d4\"\n      },\n      {\n         \"blobSum\": \"sha256:a3ed95caeb02ffe68cdd9fd84406680ae93d633cb16422d00e8a7c22955b46d4\"\n      },\n      {\n         \"blobSum\": \"sha256:a3ed95caeb02ffe68cdd9fd84406680ae93d633cb16422d00e8a7c22955b46d4\"\n      },\n      {\n         \"blobSum\": \"sha256:a3ed95caeb02ffe68cdd9fd84406680ae93d633cb16422d00e8a7c22955b46d4\"\n      },\n      {\n         \"blobSum\": \"sha256:a3ed95caeb02ffe68cdd9fd84406680ae93d633cb16422d00e8a7c22955b46d4\"\n      },\n      {\n         \"blobSum\": \"sha256:a3ed95caeb02ffe68cdd9fd84406680ae93d633cb16422d00e8a7c22955b46d4\"\n      },\n      {\n         \"blobSum\": \"sha256:74fc2669b7664c1705ea18d946fb92111a2904fdc69c24dc25db546923663c4b\"\n      },\n      {\n         \"blobSum\": \"sha256:a3ed95caeb02ffe68cdd9fd84406680ae93d633cb16422d00e8a7c22955b46d4\"\n      },\n      {\n         \"blobSum\": \"sha256:8cbbdaf3178f15e3e23f5eb59c754d16511edf100ba0e57557e47c8a5924d422\"\n      },\n      {\n         \"blobSum\": \"sha256:bc66c3b5709234727e260b55c5553c2bf9608084419271b08bca484914624d84\"\n      },\n      {\n         \"blobSum\": \"sha256:a3ed95caeb02ffe68cdd9fd84406680ae93d633cb16422d00e8a7c22955b46d4\"\n      },\n      {\n         \"blobSum\": \"sha256:a3ed95caeb02ffe68cdd9fd84406680ae93d633cb16422d00e8a7c22955b46d4\"\n      },\n      {\n         \"blobSum\": \"sha256:a3ed95caeb02ffe68cdd9fd84406680ae93d633cb16422d00e8a7c22955b46d4\"\n      },\n      {\n         \"blobSum\": \"sha256:f810322bba2c5f0a6dd58ba31eba0543baabb4533e479ab2db376aaa8064be55\"\n      }\n   ],\n   \"history\": [\n      {\n         \"v1Compatibility\": \"{\\\"id\\\":\\\"fc5cd5d8ca78a17843aba9b1b66e9d0e17200d86b0aad9a4f70d893a10c26b6d\\\",\\\"parent\\\":\\\"9192c6aa777087e5c06e1d5f1771295f7cd79d9473d71dba2241e68aa2d36807\\\",\\\"created\\\":\\\"2016-03-04T16:50:11.993242911Z\\\",\\\"container\\\":\\\"7a453b461abfb9410f73e4449ed50d5840a44afb25b0144715b4266ee6d48f2d\\\",\\\"container_config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"nobody:wheel\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"ExposedPorts\\\":{\\\"8888/tcp\\\":{}},\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"/bin/sh\\\",\\\"-c\\\",\\\"#(nop) LABEL version=1.0\\\"],\\\"Image\\\":\\\"9192c6aa777087e5c06e1d5f1771295f7cd79d9473d71dba2241e68aa2d36807\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":[\\\"top\\\",\\\"-b\\\"],\\\"OnBuild\\\":[\\\"ADD . /app/src\\\"],\\\"Labels\\\":{\\\"Test\\\":\\\"Value\\\",\\\"version\\\":\\\"1.0\\\"},\\\"StopSignal\\\":\\\"SIGKILL\\\"},\\\"docker_version\\\":\\\"1.9.1\\\",\\\"config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"nobody:wheel\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"ExposedPorts\\\":{\\\"8888/tcp\\\":{}},\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"-c\\\"],\\\"Image\\\":\\\"9192c6aa777087e5c06e1d5f1771295f7cd79d9473d71dba2241e68aa2d36807\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":[\\\"top\\\",\\\"-b\\\"],\\\"OnBuild\\\":[\\\"ADD . /app/src\\\"],\\\"Labels\\\":{\\\"Test\\\":\\\"Value\\\",\\\"version\\\":\\\"1.0\\\"},\\\"StopSignal\\\":\\\"SIGKILL\\\"},\\\"architecture\\\":\\\"amd64\\\",\\\"os\\\":\\\"linux\\\"}\"\n      },\n      {\n         \"v1Compatibility\": \"{\\\"id\\\":\\\"9192c6aa777087e5c06e1d5f1771295f7cd79d9473d71dba2241e68aa2d36807\\\",\\\"parent\\\":\\\"425d372ab4256cc54cbbd1bd6ea9e00ce11fb8685175b72e5193f5a067bb6a31\\\",\\\"created\\\":\\\"2016-03-04T16:50:06.235447946Z\\\",\\\"container\\\":\\\"a13a641996f5d0425de27a7fd80d30174e165acd7bf913432f899ab2f57e0154\\\",\\\"container_config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"nobody:wheel\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"ExposedPorts\\\":{\\\"8888/tcp\\\":{}},\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"/bin/sh\\\",\\\"-c\\\",\\\"#(nop) LABEL Test=Value\\\"],\\\"Image\\\":\\\"425d372ab4256cc54cbbd1bd6ea9e00ce11fb8685175b72e5193f5a067bb6a31\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":[\\\"top\\\",\\\"-b\\\"],\\\"OnBuild\\\":[\\\"ADD . /app/src\\\"],\\\"Labels\\\":{\\\"Test\\\":\\\"Value\\\"},\\\"StopSignal\\\":\\\"SIGKILL\\\"},\\\"docker_version\\\":\\\"1.9.1\\\",\\\"config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"nobody:wheel\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"ExposedPorts\\\":{\\\"8888/tcp\\\":{}},\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"-c\\\"],\\\"Image\\\":\\\"425d372ab4256cc54cbbd1bd6ea9e00ce11fb8685175b72e5193f5a067bb6a31\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":[\\\"top\\\",\\\"-b\\\"],\\\"OnBuild\\\":[\\\"ADD . /app/src\\\"],\\\"Labels\\\":{\\\"Test\\\":\\\"Value\\\"},\\\"StopSignal\\\":\\\"SIGKILL\\\"},\\\"architecture\\\":\\\"amd64\\\",\\\"os\\\":\\\"linux\\\"}\"\n      },\n      {\n         \"v1Compatibility\": \"{\\\"id\\\":\\\"425d372ab4256cc54cbbd1bd6ea9e00ce11fb8685175b72e5193f5a067bb6a31\\\",\\\"parent\\\":\\\"9a7e5193513a4e07bcdcffacb9f1996ef7162a4d2c196d2eaa5b2b959d641dac\\\",\\\"created\\\":\\\"2016-03-04T16:50:00.89289203Z\\\",\\\"container\\\":\\\"2a9474018a32f776c8470897e6600b6a62503a734ae2775a5fbedd9ba9b28307\\\",\\\"container_config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"nobody:wheel\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"ExposedPorts\\\":{\\\"8888/tcp\\\":{}},\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"/bin/sh\\\",\\\"-c\\\",\\\"#(nop) ARG simple\\\"],\\\"Image\\\":\\\"9a7e5193513a4e07bcdcffacb9f1996ef7162a4d2c196d2eaa5b2b959d641dac\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":[\\\"top\\\",\\\"-b\\\"],\\\"OnBuild\\\":[\\\"ADD . /app/src\\\"],\\\"Labels\\\":{},\\\"StopSignal\\\":\\\"SIGKILL\\\"},\\\"docker_version\\\":\\\"1.9.1\\\",\\\"config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"nobody:wheel\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"ExposedPorts\\\":{\\\"8888/tcp\\\":{}},\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"-c\\\"],\\\"Image\\\":\\\"9a7e5193513a4e07bcdcffacb9f1996ef7162a4d2c196d2eaa5b2b959d641dac\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":[\\\"top\\\",\\\"-b\\\"],\\\"OnBuild\\\":[\\\"ADD . /app/src\\\"],\\\"Labels\\\":{},\\\"StopSignal\\\":\\\"SIGKILL\\\"},\\\"architecture\\\":\\\"amd64\\\",\\\"os\\\":\\\"linux\\\"}\"\n      },\n      {\n         \"v1Compatibility\": \"{\\\"id\\\":\\\"9a7e5193513a4e07bcdcffacb9f1996ef7162a4d2c196d2eaa5b2b959d641dac\\\",\\\"parent\\\":\\\"dce61bf7ed98793fcfc6c09b6e096a0b74c58648397454660d4a896289f8adc9\\\",\\\"created\\\":\\\"2016-03-04T16:49:55.64958347Z\\\",\\\"container\\\":\\\"6fc564cbd8a2f53f81e1be0cf8b2752448c9b51d69787706bd1a40efc4b53870\\\",\\\"container_config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"nobody:wheel\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"ExposedPorts\\\":{\\\"8888/tcp\\\":{}},\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"/bin/sh\\\",\\\"-c\\\",\\\"#(nop) ARG hello=test\\\"],\\\"Image\\\":\\\"dce61bf7ed98793fcfc6c09b6e096a0b74c58648397454660d4a896289f8adc9\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":[\\\"top\\\",\\\"-b\\\"],\\\"OnBuild\\\":[\\\"ADD . /app/src\\\"],\\\"Labels\\\":{},\\\"StopSignal\\\":\\\"SIGKILL\\\"},\\\"docker_version\\\":\\\"1.9.1\\\",\\\"config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"nobody:wheel\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"ExposedPorts\\\":{\\\"8888/tcp\\\":{}},\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"-c\\\"],\\\"Image\\\":\\\"dce61bf7ed98793fcfc6c09b6e096a0b74c58648397454660d4a896289f8adc9\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":[\\\"top\\\",\\\"-b\\\"],\\\"OnBuild\\\":[\\\"ADD . /app/src\\\"],\\\"Labels\\\":{},\\\"StopSignal\\\":\\\"SIGKILL\\\"},\\\"architecture\\\":\\\"amd64\\\",\\\"os\\\":\\\"linux\\\"}\"\n      },\n      {\n         \"v1Compatibility\": \"{\\\"id\\\":\\\"dce61bf7ed98793fcfc6c09b6e096a0b74c58648397454660d4a896289f8adc9\\\",\\\"parent\\\":\\\"a6853913f7a2789d8e91b4be6db0f3ca1fa635942981e6289d4cb067289be53f\\\",\\\"created\\\":\\\"2016-03-04T16:49:50.274796262Z\\\",\\\"container\\\":\\\"90360222ef8c7a4978c0a27542d78175b16cf1b559ea3a0c344c21d6596f8878\\\",\\\"container_config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"nobody:wheel\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"ExposedPorts\\\":{\\\"8888/tcp\\\":{}},\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"/bin/sh\\\",\\\"-c\\\",\\\"#(nop) ONBUILD ADD . /app/src\\\"],\\\"Image\\\":\\\"a6853913f7a2789d8e91b4be6db0f3ca1fa635942981e6289d4cb067289be53f\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":[\\\"top\\\",\\\"-b\\\"],\\\"OnBuild\\\":[\\\"ADD . /app/src\\\"],\\\"Labels\\\":{},\\\"StopSignal\\\":\\\"SIGKILL\\\"},\\\"docker_version\\\":\\\"1.9.1\\\",\\\"config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"nobody:wheel\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"ExposedPorts\\\":{\\\"8888/tcp\\\":{}},\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"-c\\\"],\\\"Image\\\":\\\"a6853913f7a2789d8e91b4be6db0f3ca1fa635942981e6289d4cb067289be53f\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":[\\\"top\\\",\\\"-b\\\"],\\\"OnBuild\\\":[\\\"ADD . /app/src\\\"],\\\"Labels\\\":{},\\\"StopSignal\\\":\\\"SIGKILL\\\"},\\\"architecture\\\":\\\"amd64\\\",\\\"os\\\":\\\"linux\\\"}\"\n      },\n      {\n         \"v1Compatibility\": \"{\\\"id\\\":\\\"a6853913f7a2789d8e91b4be6db0f3ca1fa635942981e6289d4cb067289be53f\\\",\\\"parent\\\":\\\"e4c263ade6bb3cc552dbcd46c38ecdacb871e3e18b4db92451cf89823fb1140d\\\",\\\"created\\\":\\\"2016-03-04T16:49:43.316816134Z\\\",\\\"container\\\":\\\"ada3ba6c28f4d40ad447384f990d4a2075abf86b821cbd5b1f3b339aae2bda7b\\\",\\\"container_config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"nobody:wheel\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"ExposedPorts\\\":{\\\"8888/tcp\\\":{}},\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"/bin/sh\\\",\\\"-c\\\",\\\"#(nop) STOPSIGNAL [SIGKILL]\\\"],\\\"Image\\\":\\\"e4c263ade6bb3cc552dbcd46c38ecdacb871e3e18b4db92451cf89823fb1140d\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":[\\\"top\\\",\\\"-b\\\"],\\\"OnBuild\\\":[],\\\"Labels\\\":{},\\\"StopSignal\\\":\\\"SIGKILL\\\"},\\\"docker_version\\\":\\\"1.9.1\\\",\\\"config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"nobody:wheel\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"ExposedPorts\\\":{\\\"8888/tcp\\\":{}},\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"-c\\\"],\\\"Image\\\":\\\"e4c263ade6bb3cc552dbcd46c38ecdacb871e3e18b4db92451cf89823fb1140d\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":[\\\"top\\\",\\\"-b\\\"],\\\"OnBuild\\\":[],\\\"Labels\\\":{},\\\"StopSignal\\\":\\\"SIGKILL\\\"},\\\"architecture\\\":\\\"amd64\\\",\\\"os\\\":\\\"linux\\\"}\"\n      },\n      {\n         \"v1Compatibility\": \"{\\\"id\\\":\\\"e4c263ade6bb3cc552dbcd46c38ecdacb871e3e18b4db92451cf89823fb1140d\\\",\\\"parent\\\":\\\"b3dd495a125e98acf8497462f7e59ddc59230f6e49a1e0c0a56a28007475af2e\\\",\\\"created\\\":\\\"2016-03-04T16:49:36.966840962Z\\\",\\\"container\\\":\\\"75a79bb684c3ff1a8b9bccd1f046e87f84b9da4722b8b45853602f0a69f4cb27\\\",\\\"container_config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"nobody:wheel\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"ExposedPorts\\\":{\\\"8888/tcp\\\":{}},\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"/bin/sh\\\",\\\"-c\\\",\\\"#(nop) CMD [\\\\\\\"-c\\\\\\\"]\\\"],\\\"Image\\\":\\\"b3dd495a125e98acf8497462f7e59ddc59230f6e49a1e0c0a56a28007475af2e\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":[\\\"top\\\",\\\"-b\\\"],\\\"OnBuild\\\":[],\\\"Labels\\\":{}},\\\"docker_version\\\":\\\"1.9.1\\\",\\\"config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"nobody:wheel\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"ExposedPorts\\\":{\\\"8888/tcp\\\":{}},\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"-c\\\"],\\\"Image\\\":\\\"b3dd495a125e98acf8497462f7e59ddc59230f6e49a1e0c0a56a28007475af2e\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":[\\\"top\\\",\\\"-b\\\"],\\\"OnBuild\\\":[],\\\"Labels\\\":{}},\\\"architecture\\\":\\\"amd64\\\",\\\"os\\\":\\\"linux\\\"}\"\n      },\n      {\n         \"v1Compatibility\": \"{\\\"id\\\":\\\"b3dd495a125e98acf8497462f7e59ddc59230f6e49a1e0c0a56a28007475af2e\\\",\\\"parent\\\":\\\"2fef6101c97c5ca0a234e41eea1cdd577d6d9b1a21897147f8b662889f1e1890\\\",\\\"created\\\":\\\"2016-03-04T16:49:32.056781057Z\\\",\\\"container\\\":\\\"076b707ed7bf04602d56b714deb3270998c5b145520b925fc9d8029b28e1484e\\\",\\\"container_config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"nobody:wheel\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"ExposedPorts\\\":{\\\"8888/tcp\\\":{}},\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"/bin/sh\\\",\\\"-c\\\",\\\"#(nop) ENTRYPOINT \\\\u0026{[\\\\\\\"top\\\\\\\" \\\\\\\"-b\\\\\\\"]}\\\"],\\\"Image\\\":\\\"2fef6101c97c5ca0a234e41eea1cdd577d6d9b1a21897147f8b662889f1e1890\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":[\\\"top\\\",\\\"-b\\\"],\\\"OnBuild\\\":[],\\\"Labels\\\":{}},\\\"docker_version\\\":\\\"1.9.1\\\",\\\"config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"nobody:wheel\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"ExposedPorts\\\":{\\\"8888/tcp\\\":{}},\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":null,\\\"Image\\\":\\\"2fef6101c97c5ca0a234e41eea1cdd577d6d9b1a21897147f8b662889f1e1890\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":[\\\"top\\\",\\\"-b\\\"],\\\"OnBuild\\\":[],\\\"Labels\\\":{}},\\\"architecture\\\":\\\"amd64\\\",\\\"os\\\":\\\"linux\\\"}\"\n      },\n      {\n         \"v1Compatibility\": \"{\\\"id\\\":\\\"2fef6101c97c5ca0a234e41eea1cdd577d6d9b1a21897147f8b662889f1e1890\\\",\\\"parent\\\":\\\"6559b720edfb44ed193826e8a98181ecd0f8412d36ae141891a6be8ac33f13fe\\\",\\\"created\\\":\\\"2016-03-04T16:49:27.230310779Z\\\",\\\"container\\\":\\\"b1fff8a998363845efbbc77e64e58a2ef8cd422896a40816fe5016a0d66c8804\\\",\\\"container_config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"nobody:wheel\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"ExposedPorts\\\":{\\\"8888/tcp\\\":{}},\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"/bin/sh\\\",\\\"-c\\\",\\\"#(nop) USER [nobody:wheel]\\\"],\\\"Image\\\":\\\"6559b720edfb44ed193826e8a98181ecd0f8412d36ae141891a6be8ac33f13fe\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":null,\\\"OnBuild\\\":[],\\\"Labels\\\":{}},\\\"docker_version\\\":\\\"1.9.1\\\",\\\"config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"nobody:wheel\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"ExposedPorts\\\":{\\\"8888/tcp\\\":{}},\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"/bin/sh\\\",\\\"-c\\\",\\\"\\\\\\\"/echo-script\\\\\\\"\\\"],\\\"Image\\\":\\\"6559b720edfb44ed193826e8a98181ecd0f8412d36ae141891a6be8ac33f13fe\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":null,\\\"OnBuild\\\":[],\\\"Labels\\\":{}},\\\"architecture\\\":\\\"amd64\\\",\\\"os\\\":\\\"linux\\\"}\"\n      },\n      {\n         \"v1Compatibility\": \"{\\\"id\\\":\\\"6559b720edfb44ed193826e8a98181ecd0f8412d36ae141891a6be8ac33f13fe\\\",\\\"parent\\\":\\\"21356dd5eb576b1af9a101f0acb3729b3fe5c6a4a935a0efbe52d328603c6538\\\",\\\"created\\\":\\\"2016-03-04T16:49:19.278707045Z\\\",\\\"container\\\":\\\"a9ec15a2ac6c962d3f7141f789e0a703f68b1b35386b226485a470fdc297c921\\\",\\\"container_config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"ExposedPorts\\\":{\\\"8888/tcp\\\":{}},\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"/bin/sh\\\",\\\"-c\\\",\\\"#(nop) ADD file:32d397773a81df8feb5d5baf04619f65e2a1e4fddf24bbceb85157ff7f0db752 in /usr/bin\\\"],\\\"Image\\\":\\\"21356dd5eb576b1af9a101f0acb3729b3fe5c6a4a935a0efbe52d328603c6538\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":null,\\\"OnBuild\\\":[],\\\"Labels\\\":{}},\\\"docker_version\\\":\\\"1.9.1\\\",\\\"config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"ExposedPorts\\\":{\\\"8888/tcp\\\":{}},\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"/bin/sh\\\",\\\"-c\\\",\\\"\\\\\\\"/echo-script\\\\\\\"\\\"],\\\"Image\\\":\\\"21356dd5eb576b1af9a101f0acb3729b3fe5c6a4a935a0efbe52d328603c6538\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":null,\\\"OnBuild\\\":[],\\\"Labels\\\":{}},\\\"architecture\\\":\\\"amd64\\\",\\\"os\\\":\\\"linux\\\",\\\"Size\\\":125275044}\"\n      },\n      {\n         \"v1Compatibility\": \"{\\\"id\\\":\\\"21356dd5eb576b1af9a101f0acb3729b3fe5c6a4a935a0efbe52d328603c6538\\\",\\\"parent\\\":\\\"7fd39f4f39c71d76250adac15d7385fd6d68274e8a7ddd032b0b0bb6b3280a39\\\",\\\"created\\\":\\\"2016-03-04T16:48:53.085321054Z\\\",\\\"container\\\":\\\"7749a20ab52bd8714b5cc2823d3c09767f574b8f2d4bd4393b37f0a4964f3376\\\",\\\"container_config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"ExposedPorts\\\":{\\\"8888/tcp\\\":{}},\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"/bin/sh\\\",\\\"-c\\\",\\\"#(nop) CMD [\\\\\\\"/bin/sh\\\\\\\" \\\\\\\"-c\\\\\\\" \\\\\\\"\\\\\\\\\\\\\\\"/echo-script\\\\\\\\\\\\\\\"\\\\\\\"]\\\"],\\\"Image\\\":\\\"7fd39f4f39c71d76250adac15d7385fd6d68274e8a7ddd032b0b0bb6b3280a39\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":null,\\\"OnBuild\\\":[],\\\"Labels\\\":{}},\\\"docker_version\\\":\\\"1.9.1\\\",\\\"author\\\":\\\"cockpit@example.com\\\",\\\"config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"ExposedPorts\\\":{\\\"8888/tcp\\\":{}},\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"/bin/sh\\\",\\\"-c\\\",\\\"\\\\\\\"/echo-script\\\\\\\"\\\"],\\\"Image\\\":\\\"7fd39f4f39c71d76250adac15d7385fd6d68274e8a7ddd032b0b0bb6b3280a39\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":null,\\\"OnBuild\\\":[],\\\"Labels\\\":{}},\\\"architecture\\\":\\\"amd64\\\",\\\"os\\\":\\\"linux\\\"}\"\n      },\n      {\n         \"v1Compatibility\": \"{\\\"id\\\":\\\"7fd39f4f39c71d76250adac15d7385fd6d68274e8a7ddd032b0b0bb6b3280a39\\\",\\\"parent\\\":\\\"b6962728b43855b1c803aec38e67e70bd137040543def671e415834cdfc01552\\\",\\\"created\\\":\\\"2016-03-04T16:48:47.790555865Z\\\",\\\"container\\\":\\\"ab835892b5519c2d0ffd84e22fe3d971a4a80d9d3e31757c7dce5379b947887e\\\",\\\"container_config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"ExposedPorts\\\":{\\\"8888/tcp\\\":{}},\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"/bin/sh\\\",\\\"-c\\\",\\\"chmod +x /echo-script\\\"],\\\"Image\\\":\\\"b6962728b43855b1c803aec38e67e70bd137040543def671e415834cdfc01552\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":null,\\\"OnBuild\\\":[],\\\"Labels\\\":{}},\\\"docker_version\\\":\\\"1.9.1\\\",\\\"author\\\":\\\"cockpit@example.com\\\",\\\"config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"ExposedPorts\\\":{\\\"8888/tcp\\\":{}},\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"sh\\\"],\\\"Image\\\":\\\"b6962728b43855b1c803aec38e67e70bd137040543def671e415834cdfc01552\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":null,\\\"OnBuild\\\":[],\\\"Labels\\\":{}},\\\"architecture\\\":\\\"amd64\\\",\\\"os\\\":\\\"linux\\\",\\\"Size\\\":49}\"\n      },\n      {\n         \"v1Compatibility\": \"{\\\"id\\\":\\\"b6962728b43855b1c803aec38e67e70bd137040543def671e415834cdfc01552\\\",\\\"parent\\\":\\\"b70fe9098263c3c82a67bc22caf523ced24185975088fd1043a799a6b4273882\\\",\\\"created\\\":\\\"2016-03-04T16:48:42.037533681Z\\\",\\\"container\\\":\\\"e16228a90ccf6d29c214833ba202b94b467979f5db03797d0a27da8430509966\\\",\\\"container_config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"ExposedPorts\\\":{\\\"8888/tcp\\\":{}},\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"/bin/sh\\\",\\\"-c\\\",\\\"#(nop) ADD file:b35fc316562d0e29fa7ae1e767f3597811f4349e30aa74122b67965a103f817a in /\\\"],\\\"Image\\\":\\\"b70fe9098263c3c82a67bc22caf523ced24185975088fd1043a799a6b4273882\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":null,\\\"OnBuild\\\":[],\\\"Labels\\\":{}},\\\"docker_version\\\":\\\"1.9.1\\\",\\\"author\\\":\\\"cockpit@example.com\\\",\\\"config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"ExposedPorts\\\":{\\\"8888/tcp\\\":{}},\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"sh\\\"],\\\"Image\\\":\\\"b70fe9098263c3c82a67bc22caf523ced24185975088fd1043a799a6b4273882\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":null,\\\"OnBuild\\\":[],\\\"Labels\\\":{}},\\\"architecture\\\":\\\"amd64\\\",\\\"os\\\":\\\"linux\\\",\\\"Size\\\":49}\"\n      },\n      {\n         \"v1Compatibility\": \"{\\\"id\\\":\\\"b70fe9098263c3c82a67bc22caf523ced24185975088fd1043a799a6b4273882\\\",\\\"parent\\\":\\\"6e45971d34d5ecfc0b946014369c8dacab8f2177bbd3751dd5289b9a5ba59df2\\\",\\\"created\\\":\\\"2016-03-04T16:48:36.879318282Z\\\",\\\"container\\\":\\\"a759048c873ac86cef61a9aec0ac72734cfe53feb7acd81a2b4975473675ed20\\\",\\\"container_config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"ExposedPorts\\\":{\\\"8888/tcp\\\":{}},\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"/bin/sh\\\",\\\"-c\\\",\\\"#(nop) EXPOSE 8888/tcp\\\"],\\\"Image\\\":\\\"6e45971d34d5ecfc0b946014369c8dacab8f2177bbd3751dd5289b9a5ba59df2\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":null,\\\"OnBuild\\\":[],\\\"Labels\\\":{}},\\\"docker_version\\\":\\\"1.9.1\\\",\\\"author\\\":\\\"cockpit@example.com\\\",\\\"config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"ExposedPorts\\\":{\\\"8888/tcp\\\":{}},\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"sh\\\"],\\\"Image\\\":\\\"6e45971d34d5ecfc0b946014369c8dacab8f2177bbd3751dd5289b9a5ba59df2\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":null,\\\"OnBuild\\\":[],\\\"Labels\\\":{}},\\\"architecture\\\":\\\"amd64\\\",\\\"os\\\":\\\"linux\\\"}\"\n      },\n      {\n         \"v1Compatibility\": \"{\\\"id\\\":\\\"6e45971d34d5ecfc0b946014369c8dacab8f2177bbd3751dd5289b9a5ba59df2\\\",\\\"parent\\\":\\\"fef924a0204a00b3ec67318e2ed337b189c99ea19e2bf10ed30a13b87c5e17ab\\\",\\\"created\\\":\\\"2016-03-04T16:48:31.254943299Z\\\",\\\"container\\\":\\\"0484d0202032d11f48613463684f344ddc4f238635dcb640774e00828251f57d\\\",\\\"container_config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"/bin/sh\\\",\\\"-c\\\",\\\"#(nop) MAINTAINER cockpit@example.com\\\"],\\\"Image\\\":\\\"65e4158d96256e032299e07ac28308d644c0e81d52b18dcb08847a5027b4f107\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":null,\\\"OnBuild\\\":[],\\\"Labels\\\":{}},\\\"docker_version\\\":\\\"1.9.1\\\",\\\"author\\\":\\\"cockpit@example.com\\\",\\\"config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":[\\\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\\\"],\\\"Cmd\\\":[\\\"sh\\\"],\\\"Image\\\":\\\"65e4158d96256e032299e07ac28308d644c0e81d52b18dcb08847a5027b4f107\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":null,\\\"OnBuild\\\":[],\\\"Labels\\\":{}},\\\"architecture\\\":\\\"amd64\\\",\\\"os\\\":\\\"linux\\\"}\"\n      },\n      {\n         \"v1Compatibility\": \"{\\\"id\\\":\\\"fef924a0204a00b3ec67318e2ed337b189c99ea19e2bf10ed30a13b87c5e17ab\\\",\\\"parent\\\":\\\"9a163e0b8d138ec700b5a5f7e62509012f7eb34b9f86cd3bbeb3d183958114a9\\\",\\\"created\\\":\\\"2016-02-16T22:59:37.407805421Z\\\",\\\"container\\\":\\\"d23509cd0189de02bef382544ebfab515f29094f3c0e2f161fa7ce09afa8974e\\\",\\\"container_config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":null,\\\"Cmd\\\":[\\\"/bin/sh\\\",\\\"-c\\\",\\\"#(nop) CMD [\\\\\\\"sh\\\\\\\"]\\\"],\\\"Image\\\":\\\"9a163e0b8d138ec700b5a5f7e62509012f7eb34b9f86cd3bbeb3d183958114a9\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":null,\\\"OnBuild\\\":null,\\\"Labels\\\":{}},\\\"docker_version\\\":\\\"1.9.1\\\",\\\"config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":null,\\\"Cmd\\\":[\\\"sh\\\"],\\\"Image\\\":\\\"9a163e0b8d138ec700b5a5f7e62509012f7eb34b9f86cd3bbeb3d183958114a9\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":null,\\\"OnBuild\\\":null,\\\"Labels\\\":{}},\\\"architecture\\\":\\\"amd64\\\",\\\"os\\\":\\\"linux\\\"}\"\n      },\n      {\n         \"v1Compatibility\": \"{\\\"id\\\":\\\"9a163e0b8d138ec700b5a5f7e62509012f7eb34b9f86cd3bbeb3d183958114a9\\\",\\\"created\\\":\\\"2016-02-16T22:59:36.792440427Z\\\",\\\"container\\\":\\\"13709f13afe11b7d4a007d2866afd20c5b783f0a89f4e6792a28102a4c12c473\\\",\\\"container_config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":null,\\\"Cmd\\\":[\\\"/bin/sh\\\",\\\"-c\\\",\\\"#(nop) ADD file:7cdf7a89f6a004b2e9501317bd72bd863d93a51255d8f83b2ed3058d385a4938 in /\\\"],\\\"Image\\\":\\\"\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":null,\\\"OnBuild\\\":null,\\\"Labels\\\":null},\\\"docker_version\\\":\\\"1.9.1\\\",\\\"config\\\":{\\\"Hostname\\\":\\\"13709f13afe1\\\",\\\"Domainname\\\":\\\"\\\",\\\"User\\\":\\\"\\\",\\\"AttachStdin\\\":false,\\\"AttachStdout\\\":false,\\\"AttachStderr\\\":false,\\\"Tty\\\":false,\\\"OpenStdin\\\":false,\\\"StdinOnce\\\":false,\\\"Env\\\":null,\\\"Cmd\\\":null,\\\"Image\\\":\\\"\\\",\\\"Volumes\\\":null,\\\"WorkingDir\\\":\\\"\\\",\\\"Entrypoint\\\":null,\\\"OnBuild\\\":null,\\\"Labels\\\":null},\\\"architecture\\\":\\\"amd64\\\",\\\"os\\\":\\\"linux\\\",\\\"Size\\\":1113554}\"\n      }\n   ],\n   \"signatures\": [\n      {\n         \"header\": {\n            \"jwk\": {\n               \"crv\": \"P-256\",\n               \"kid\": \"VQO7:TVYU:FARI:VIFC:P2YU:W23P:AC7V:7ZXR:I5RO:DTY4:NRES:MGXE\",\n               \"kty\": \"EC\",\n               \"x\": \"EsCEZHIfgzZDBsbCzgCng884FdTcwyQ8dZbhap2cpgo\",\n               \"y\": \"9Hlp74n2G2aMwzyvvM9G-8BbrXDp2dl9rt2RGbidQ8I\"\n            },\n            \"alg\": \"ES256\"\n         },\n         \"signature\": \"MFqsTUp-ci7Th-1r02bHj8eDh5xRg_WtjpN7WD4dI2Tuvg96fyGH6rf5bYKIjEVKz1_3Z42Ma06DDw8hSsMOGw\",\n         \"protected\": \"eyJmb3JtYXRMZW5ndGgiOjI3NjU1LCJmb3JtYXRUYWlsIjoiQ24wIiwidGltZSI6IjIwMTYtMDMtMDRUMTY6NTA6MzJaIn0\"\n      }\n   ]\n}"
    }
]);
