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
require("./connection");

var QUnit = require("qunit-tests");

(function() {
    "use strict";

    var fixtures = [];

    var configJson;

    /* Filled in with a function */
    var inject;
    var assert = QUnit;

    var module = angular.module("kubernetes.connection.tests", [
        "kubeClient",
        'kubeClient.cockpit',
        "kubernetes.connection",
    ]);

    function connectionTest(name, count, fixtures, func) {
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

    connectionTest("sessionCertificates test", 5, fixtures, [
        "sessionCertificates",
        function(sessionCertificates) {
            sessionCertificates.trustCert(null, "data");
            assert.equal(sessionCertificates.getCert("localhost"), "data", "data retrive");
            assert.equal(sessionCertificates.getCert(null), "data", "null is localhost");
            sessionCertificates.trustCert({}, "data1");
            assert.equal(sessionCertificates.getCert("localhost"), "data1", "blank server retrive");
            assert.equal(sessionCertificates.getCert("address"), undefined, "missing is undefined");
            sessionCertificates.trustCert({ server: "address" }, "address-data");
            assert.equal(sessionCertificates.getCert("address"), undefined, "address data");
        }
    ]);

    connectionTest("cockpitKubectlConfig parseKubeConfig", 5, fixtures, [
        "cockpitKubectlConfig",
        function (ckg) {
            var alpha = {
                "address": "alfa.org",
                "headers": {
                    "Authorization": "Bearer provider-token"
                },
                "port": 443,
                "tls": {
                    "validate": false,
                    "authority": undefined,
                    "certificate": undefined,
                    "key": undefined,
                }
            };

            var bravo = {
                "address": "bravo.org",
                "headers": {
                    "Authorization": "Bearer provider-access-token"
                },
                "port": 8080,
                "tls": {
                    "authority": {
                        "file": "cert-authority-file"
                    },
                    "certificate": undefined,
                    "key": undefined,
                    "validate": true
                }
            };

            var charlie = {
                "address": "charlie.org",
                "headers": {
                    "Authorization": "Bearer token"
                },
                "port": 8080
            };

            var delta1 = {
                "address": "delta.org",
                "headers": {},
                "port": 443,
                "tls": {
                    "authority": undefined,
                    "certificate": {
                        "file": "cert-file"
                    },
                    "key": {
                        "file": "key-file"
                    },
                    "validate": true
                }
            };

            var delta2 = {
                "address": "delta.org",
                "headers": {
                    "Authorization": "Basic dXNlcjpwYXNzd29yZA=="
                },
                "port": 443,
                "tls": {
                    "validate": true,
                    "authority": undefined,
                    "certificate": undefined,
                    "key": undefined,
                }
            };
            var configData = JSON.stringify(configJson);
            assert.deepEqual(ckg.parseKubeConfig(configData), alpha);
            assert.deepEqual(ckg.parseKubeConfig(configData, "bravo-with-access-token-auth-provider"), bravo);
            assert.deepEqual(ckg.parseKubeConfig(configData, "charlie-with-token"), charlie);
            assert.deepEqual(ckg.parseKubeConfig(configData, "delta-with-cert"), delta1);
            assert.deepEqual(ckg.parseKubeConfig(configData, "delta-with-basic"), delta2);
        }
    ]);

    connectionTest("connectionActions prepareData", 6, fixtures, [
        "connectionActions",
        function(connectionActions) {
            var cluster, context, user, data, config;
            data = connectionActions.prepareData();
            assert.deepEqual(data, {
                "cluster": {
                    "cluster": {
                        "server": "http://localhost:8080"
                    },
                    "name": "localhost:8080"
                },
                "context": {
                    "context": {
                        "cluster": "localhost:8080",
                        "user": undefined
                    },
                    "name": "localhost:8080/noauth"
                },
                "user": undefined
            }, "got right empty values");

            cluster = {
                "cluster": { "server": "https://127.0.0.1:8000" },
                "name": "name"
            };
            user = {
                "user": { "token": "token" },
                "name": "user"
            };

            context = {
                "context": {
                    "user": "user",
                    "cluster": "name"
                },
                name : "existing"
            };

            config = {
                users: [user],
                clusters: [cluster],
                contexts: [ context ]
            };

            data = connectionActions.prepareData(config, cluster, user);
            assert.deepEqual(data, {
                "cluster": {
                    "cluster": { "server": "https://127.0.0.1:8000" },
                    "name": "name"
                },
                "context": { "name" : "existing" },
                "user": {
                    "user": { "token": "token" },
                    "name": "user"
                }
            }, "matched existing");

            // remove names
            delete cluster.name;
            delete user.name;
            data = connectionActions.prepareData({}, cluster, user);
            assert.deepEqual(data, {
                "cluster": {
                    "cluster": { "server": "https://127.0.0.1:8000" },
                    "name": "127-0-0-1:8000"
                },
                "context": {
                    "name": "127-0-0-1:8000/user/127-0-0-1:8000",
                    "context": {
                        "user": "user/127-0-0-1:8000",
                        "cluster": "127-0-0-1:8000"
                    }
                },
                "user": {
                    "user": { "token": "token" },
                    "name": "user/127-0-0-1:8000"
                },
            }, "generated names");

            // No dups
            config = {
                contexts: [{ "name": "127-0-0-1:8000/user/127-0-0-1:8000" }],
            };
            data = connectionActions.prepareData(config, cluster, user);
            var pos = data.context.name.indexOf("127-0-0-1:8000/user/127-0-0-1:8000");
            assert.ok(data.context.name != "127-0-0-1:8000/user/127-0-0-1:8000" && pos === 0, "dedup context name");

            config = {
                clusters: [{ "name": "127-0-0-1:8000" }],
            };
            delete cluster.name;
            data = connectionActions.prepareData(config, cluster, user);
            pos = data.cluster.name.indexOf("127-0-0-1:8000");
            assert.ok(data.cluster.name != "127-0-0-1:8000" && pos === 0, "dedup cluster name");

            config = {
                users: [{ "name": "user/127-0-0-1:8000" }],
            };
            delete user.name;
            data = connectionActions.prepareData(config, cluster, user);
            pos = data.user.name.indexOf("user/127-0-0-1:8000");
            assert.ok(data.user.name != "user/127-0-0-1:8000" && pos === 0, "dedup user name");
        }
    ]);

    angular.module('exceptionOverride', []).factory('$exceptionHandler', function() {
        return function(exception, cause) {
            exception.message += ' (caused by "' + cause + '")';
            throw exception;
        };
    });

    configJson = {
        "clusters": [{
            "name": "alfa",
            "cluster": {
                "insecure-skip-tls-verify": true,
                "server": "https://alfa.org"
            }
        }, {
            "name": "bravo",
            "cluster": {
                "server": "https://bravo.org:8080",
                "certificate-authority": "cert-authority-file"
            }
        }, {
            "name": "charlie",
            "cluster": {
                "server": "http://charlie.org"
            }
        }, {
            "name": "delta",
            "cluster": {
                "server": "https://delta.org:443"
            }
        }],
        "contexts": [{
            "name": "alfa-with-token-auth-provider",
            "context": {
                "cluster": "alfa",
                "user": "token-auth-provider"
            }
        }, {
            "name": "bravo-with-access-token-auth-provider",
            "context": {
                "cluster": "bravo",
                "user": "access-token-auth-provider"
            }
        }, {
            "name": "charlie-with-token",
            "context": {
                "cluster": "charlie",
                "user": "token"
            }
        }, {
            "name": "delta-with-cert",
            "context": {
                "cluster": "delta",
                "user": "cert"
            }
        }, {
            "name": "delta-with-basic",
            "context": {
                "cluster": "delta",
                "user": "basic"
            }
        }],
        "current-context": "alfa-with-token-auth-provider",
        "users": [{
            "name": "token-auth-provider",
            "user": {
                "auth-provider": {
                    "config": {
                        "token": "provider-token"
                    },
                    "name": "gcp"
                }
            }
        }, {
            "name": "access-token-auth-provider",
            "user": {
                "auth-provider": {
                    "config": {
                        "access-token": "provider-access-token"
                    },
                    "name": "gcp"
                }
            }
        }, {
            "name": "token",
            "user": {
                "token": "token"
            }
        }, {
            "name": "cert",
            "user": {
                "client-certificate": "cert-file",
                "client-key": "key-file"
            }
        }, {
            "name": "basic",
            "user": {
                "username": "user",
                "password": "password"
            }
        }]
    };

    module.run([
        '$injector',
        function($injector) {
            inject = function inject(func) {
                return $injector.invoke(func);
            };
            QUnit.start();
        }
    ]);

    angular.bootstrap(document, ['kubernetes.connection.tests']);
}());
