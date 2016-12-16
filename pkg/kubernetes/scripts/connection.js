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

(function() {
    "use strict";

    var angular = require('angular');

    require('./dialog');
    require('./kube-client-cockpit');
    require('./utils');

    require('../views/auth-form.html');
    require('../views/auth-rejected-cert.html');
    require('../views/container-page.html');
    require('../views/containers-page.html');
    require('../views/containers-listing.html');
    require('../views/container-page-inline.html');
    require('../views/container-body.html');
    require('../views/pod-body.html');

    angular.module('kubernetes.connection', [
        'ui.cockpit',
        'kubeClient',
        'kubeClient.cockpit',
        'kubeUtils',
    ])

    .factory("sessionCertificates", [
        "cockpitKubectlConfig",
        function (kubectl) {
            var trustedCerts = {};

            function trustCert(cluster, pem) {
                var options = kubectl.generateKubeOptions(cluster);
                var address = options.address || "localhost";
                trustedCerts[address] = pem;
            }

            function getCert(address) {
                address = address || "localhost";
                return trustedCerts[address];
            }

            return {
                getCert: getCert,
                trustCert: trustCert
            };
        }
    ])

    .factory("connectionActions", [
        "$q",
        "cockpitKubeDiscover",
        "cockpitKubectlConfig",
        "cockpitRunCommand",
        "cockpitConnectionInfo",
        "CockpitKubeRequest",
        "KubeMapNamedArray",
        "CockpitTranslate",
        "sessionCertificates",
        function($q, cockpitKubeDiscover, kubectl, runCommand,
                 cockpitConnectionInfo, CockpitKubeRequest,
                 mapNamedArray, translate, sessionCertificates) {

            var DEFAULT_ADDRESS = "http://localhost:8080";
            var _ = translate.gettext;

            function kubectlError(ex) {
                // Because angular warns about all throws
                console.warn("Unexpected Kubectl Error", ex);
                return $q.reject(new Error(_("Error writing kubectl config")));
            }

            function kubectlData() {
                return kubectl.read().then(function(data) {
                    var config;
                    try {
                        config = JSON.parse(data);
                    } catch (ex) {
                        console.warn("received invalid kubectl config", ex);
                        config = {};
                    }
                    return config;
                });
            }

            function loadConfigData(config, useConfig) {
                var user, cluster, context;
                var contexts = mapNamedArray(config.contexts);
                var users = mapNamedArray(config.users);
                var clusters = mapNamedArray(config.clusters);

                if (useConfig)
                    context = contexts[useConfig["current-context"]];
                else
                    context = contexts[config["current-context"]];

                if (context && context.context) {
                    if (context.context.user)
                        user = users[context.context.user];
                    if (context.context.cluster)
                        cluster = clusters[context.context.cluster];
                }

                return {
                    users: users,
                    clusters: clusters,
                    contexts: contexts,
                    currentUser: user,
                    currentCluster: cluster,
                    currentContext: context,
                    config: config
                };
            }

            function load(error) {
                var defer = $q.defer();
                var promise;

                var result = {
                    haveKubectl: false,
                    defaultAddress: DEFAULT_ADDRESS,
                    error: error,
                    users: undefined,
                    clusters: undefined,
                    contexts: undefined,
                    currentUser: undefined,
                    currentCluster: undefined,
                    currentContext: undefined,
                    config: undefined
                };

                if (!error) {
                    promise = cockpitKubeDiscover().then(function(options) {
                        var address = "localhost";
                        if (options.address)
                            address = options.address;

                        if (options.tls)
                            result.defaultAddress = "https://" + address + ":" + options.port;
                        else
                            result.defaultAddress = "http://" + address + ":" + options.port;

                        return kubectlData();
                    }, function(ex) {
                        result.error = ex;
                        return kubectlData();
                    });
                } else {
                    promise = kubectlData();
                }

                promise.then(function(config) {
                    var useConfig;

                    result.haveKubectl = true;

                    if (cockpitConnectionInfo.type && cockpitConnectionInfo.type != "open")
                        useConfig = cockpitConnectionInfo.kubeConfig;

                    angular.extend(result, loadConfigData(config, useConfig));
                    defer.resolve(result);
                }, function(ex) {
                    if (cockpitConnectionInfo.kubeConfig)
                        angular.extend(result, loadConfigData(cockpitConnectionInfo.kubeConfig));
                    defer.resolve(result);
                });
                return defer.promise;
            }

            function prepareData(config, cluster, user) {
                var i;
                var contexts, context;
                var default_cluster = {
                    cluster: { server: DEFAULT_ADDRESS }
                };

                config = config ? config : {};
                cluster = cluster ? cluster : default_cluster;

                function ensureValid(name, options) {
                    var added;
                    var chars = "abcdefghijklmnopqrstuvwxyz";
                    name = name.toLowerCase().replace(/[^a-z0-9:\/-]/g, "-");
                    while (options[name]) {
                        var length = 0;
                        if (!added)
                            name = name + "/";

                        added = "";

                        while (length < 4) {
                            added += chars[Math.floor(Math.random() * chars.length)];
                            length++;
                        }

                        name = name + added;
                    }
                    return name;
                }

                function generateClusterName(cluster) {
                    var a = document.createElement("a");
                    a.href = cluster.cluster.server;

                    var name = a.hostname;

                    if (a.port)
                        name = name + ":" + a.port;

                    return ensureValid(name, mapNamedArray(config.clusters));
                }

                function generateUserName(user, clusterName) {
                    var name;
                    if (user.user && user.user.username)
                        name = user.user.username;
                    else
                        name = "user";
                    name = name + "/" + clusterName;
                    return ensureValid(name, mapNamedArray(config.users));
                }

                function generateContextName(userName, clusterName) {
                    var name = clusterName + "/" + userName;
                    return ensureValid(name, mapNamedArray(config.contexts));
                }

                if (!cluster.name)
                    cluster.name = generateClusterName(cluster);

                if (user && !user.name)
                    user.name = generateUserName(user, cluster.name);

                contexts = config.contexts || [];
                for (i = 0; i < contexts.length; i++) {
                    var c = contexts[i];
                    if (c.context) {
                        var inner = c.context || {};
                        if (inner.cluster == cluster.name &&
                            (user && inner.user == user.name || !user && !inner.user)) {
                            context = { name: c.name };
                            break;
                        }
                    }
                }

                if (!context) {
                    context = {
                        name: generateContextName(user ? user.name : "noauth", cluster.name),
                        context: {
                            user: user ? user.name : undefined,
                            cluster: cluster.name,
                        }
                    };
                }

                return {
                    cluster: cluster,
                    user: user,
                    context: context
                };
            }

            /* Openshift returns token information in the hash of a Location URL */
            function parseBearerToken(url) {
                var token = null;
                var parser = document.createElement('a');
                parser.href = url;
                var hash = parser.hash;
                if (hash[0] == "#")
                    hash = hash.substr(1);
                hash.split("&").forEach(function(part) {
                    var item = part.split("=");
                    if (item.shift() == "access_token")
                        token = item.join("=");
                });
                return token;
            }

            /* Retrieve a bearer token using basic auth if possible */
            function populateBearerToken(cluster, user) {
                /* The user data without any token */
                var data = angular.extend({ }, user ? user.user : null);

                /* If no password is set, just skip this step */
                if (!data.password)
                    return $q.when();

                delete data.token;

                /* Build an Openshift OAuth WWW-Authenticate request */
                var config = kubectl.generateKubeOptions(cluster.cluster, data);
                var trust = sessionCertificates.getCert(config.address);
                if (config.tls && trust)
                    config.tls["authority"] = { data: trust };

                if (!config.headers)
                    config.headers = { };
                config.headers["X-CSRF-Token"] = "1"; /* Any value will do */
                var path = '/oauth/authorize?response_type=token&client_id=openshift-challenging-client';
                var request = new CockpitKubeRequest("GET", path, "", config);

                return request.then(function(response) {
                    /* Shouldn't return success. Not OAuth capable */
                    return "";
                }, function(response) {
                    if (response.status == 302) {
                        var token, header = response.headers["Location"];
                        if (header) {

                            /*
                             * When OAuth is in play (ie: Openshift, Origin, Atomic, then
                             * user/password basic auth doesn't work for accessing the API.
                             *
                             * Unfortunately kubectl won't let us save both user/password and
                             * the token (if we wanted it for future use). So we have to remove
                             * the user and password data.
                             */
                            token = parseBearerToken(header);
                            if (token) {
                                delete user.user.username;
                                delete user.user.password;
                                user.user.token = token;
                            }
                        }
                        return "";
                    } else if (response.status == 404) {
                        return ""; /* Not OAuth capable */
                    } else {
                        return $q.reject(response);
                    }
                });
            }

            function writeKubectlConfig(cluster, user, context) {
                var cluster_args, user_args, cmd_args;
                var commands = [];
                var promise;

                // Everything here must run serially
                if (user && user.user) {
                    user_args = [ "kubectl", "config", "set-credentials", user.name ];

                    if (user.user.username) {
                        user_args.push("--username=" + user.user.username);
                        user_args.push("--password=" + (user.user.password || ""));
                    }

                    if (user.user.token)
                        user_args.push("--token=" + user.user.token);

                    commands.push(user_args);
                }

                if (cluster && cluster.cluster) {
                    cluster_args = [ "kubectl", "config", "set-cluster",
                                     cluster.name, "--server=" + cluster.cluster.server,
                                     "--insecure-skip-tls-verify=" + !!cluster.cluster["insecure-skip-tls-verify"]
                    ];
                    commands.push(cluster_args);
                }

                if (context) {
                    cmd_args = [ "kubectl", "config", "set-context", context.name ];

                    angular.forEach(["namespace", "user", "cluster"], function(value, key) {
                        if (context.context && context.context[value])
                            cmd_args.push("--" + value + "=" + context.context[value]);
                    });
                    commands.push(cmd_args);
                    commands.push([ "kubectl", "config", "use-context", context.name ]);
                }

                promise = $q.when();
                angular.forEach(commands, function(command) {
                    promise = promise.then(function (result) {
                        return runCommand(command);
                    });
                });

                return promise.then(function () {
                    return kubectlData().then(function(data) {
                        return loadConfigData(data);
                    });
                }).catch(kubectlError);
            }

            return {
                prepareData: prepareData,
                load: load,
                writeKubectlConfig: writeKubectlConfig,
                populateBearerToken: populateBearerToken
            };
        }
    ])

    .controller("ChangeAuthCtrl", [
        "$q",
        "$scope",
        "$modalInstance",
        "dialogData",
        "connectionActions",
        "CockpitKubeRequest",
        "cockpitKubectlConfig",
        "sessionCertificates",
        function($q, $scope, instance, dialogData, connectionActions,
                CockpitKubeRequest, kubectl, sessionCertificates) {
            angular.extend($scope, dialogData);

            function connect(data) {
                var cluster = data.currentCluster ? data.currentCluster.cluster : null;
                var user = data.currentUser ? data.currentUser.user : null;

                var options = kubectl.generateKubeOptions(cluster, user);
                var trust = sessionCertificates.getCert(options.address);

                var force = $scope.haveKubectl ? "kubectl" : options;
                if (options.tls && trust) {
                    options.tls["authority"] = { data: trust };
                    force = options;
                }

                var promise = new CockpitKubeRequest("GET", "/api", "", options);
                return promise.then(function() {
                    return force;
                }).catch(function (ex) {
                    data.error = ex;
                    angular.extend($scope, data);
                    $scope.$broadcast("loadData");

                    return $q.reject([]);
                });
            }

            $scope.$on("selectUser", function (ev, user) {
                var users = $scope.users || {};
                if (user && user.name && !users[user.name])
                    delete user.name;

                $scope.currentUser = user;
            });

            $scope.$on("selectCluster", function (ev, cluster) {
                var clusters = $scope.clusters || {};
                if (cluster && cluster.name && !clusters[cluster.name])
                    delete cluster.name;

                $scope.currentCluster = cluster;
            });

            $scope.saveAndConnect = function (data) {
                return connectionActions.populateBearerToken(data.cluster, data.user)
                    .then(function () {
                        if ($scope.haveKubectl) {
                            return connectionActions.writeKubectlConfig(data.cluster, data.user, data.context);
                        } else {
                            return $q.when({
                                currentUser: data.user,
                                currentCluster: data.cluster,
                            });
                        }
                    }, function (ex) {
                        $scope.currentUser = data.user;
                        $scope.currentCluster = data.cluster;
                        $scope.error = ex;

                        $scope.$broadcast("loadData");
                        return $q.reject([]);
                    }).then(connect);
            };
        }
    ])

    .directive("authForm", [
        "$q",
        "connectionActions",
        "CockpitTranslate",
        "CockpitFormat",
        function($q, connectionActions, translate, format) {
            var _ = translate.gettext;
            return {
                restrict: "E",
                scope: true,
                link: function($scope, element, attrs) {
                    $scope.fields = {};

                    function loadData() {
                        if ($scope.error) {
                            var msg = $scope.error.statusText;
                            if (!msg)
                                msg = $scope.error.problem;

                            if (msg == "not-found")
                                msg = _("Couldn't find running API server");

                            $scope.failure(format.format(_("Connection Error: $0"), msg));
                        }

                        if ($scope.currentCluster)
                            $scope.selectCluster($scope.currentCluster);
                        else
                            $scope.fields.address = $scope.defaultAddress;

                        if ($scope.currentUser)
                            $scope.selectUser($scope.currentUser);

                        $scope.useAuth = !!$scope.currentUser;
                    }

                    function validate() {
                        var errors = [];
                        var ex;
                        var address_re = /^[a-z0-9\:\/.-]+$/i;
                        var address = $scope.fields.address;
                        var cluster = { cluster: {} };
                        var user;

                        if (!$scope.fields.address || !address_re.test(address.toLowerCase())) {
                            ex = new Error(_("Please provide a valid address"));
                            ex.target = "#kubernetes-address";
                            errors.push(ex);
                            ex = null;
                        } else if (address.indexOf("http://") !== 0 &&
                                   address.indexOf("https://") !== 0) {
                            address = "http://" + address;
                        }

                        user = $scope.useAuth ? $scope.currentUser : null;
                        if (!user && $scope.useAuth)
                            user = { user: {} };

                        if (user && !$scope.fields.username &&
                            (!user.name || user.user.username)) {
                            ex = new Error(_("Please provide a username"));
                            ex.target = "#kubernetes-username";
                            errors.push(ex);
                            ex = null;
                        }

                        if ($scope.currentCluster)
                            cluster = $scope.currentCluster;

                        cluster.cluster.server = address;
                        cluster.cluster["insecure-skip-tls-verify"] = !!$scope.fields.skipVerify;

                        if (user) {
                            if ($scope.fields.username) {
                                user.user.username = $scope.fields.username;
                                user.user.password = $scope.fields.password;
                            } else {
                                delete user.user.username;
                                delete user.user.password;
                            }
                            if ($scope.fields.token)
                                user.user.token = $scope.fields.token;
                            else
                                delete user.user.token;
                        }

                        if (errors.length > 0)
                            return $q.reject(errors);

                        var data = connectionActions.prepareData($scope.config, cluster, user);
                        return $q.when(data);
                    }

                    $scope.selectCluster = function selectCluster(cluster) {
                        var inner = cluster && cluster.cluster ? cluster.cluster : {};
                        $scope.fields.address = inner.server;
                        $scope.fields.skipVerify = !!inner["insecure-skip-tls-verify"];
                        $scope.$emit("selectCluster", cluster);
                    };

                    $scope.selectUser = function selectUser(user) {
                        var inner = user && user.user ? user.user : {};
                        $scope.fields.username = inner.username;
                        $scope.fields.password = inner.password;
                        $scope.fields.token = inner.token;
                        $scope.$emit("selectUser", user);
                    };

                    $scope.hasCert = function hasCert(user) {
                        if (user && user.user) return user.user["client-key"] || user.user["client-key-data"];
                        return false;
                    };

                    $scope.toggleAuth = function toggleAuth() {
                        $scope.useAuth = !$scope.useAuth;
                    };

                    $scope.update = function() {
                        return validate().then(function (data) {
                            return $scope.saveAndConnect(data);
                        });
                    };

                    $scope.$on("loadData", loadData);
                    loadData();
                },
                templateUrl: "views/auth-form.html"
            };
        }
    ])

    .directive("authRejectedCert", [
        "$q",
        "connectionActions",
        "sessionCertificates",
        "cockpitRunCommand",
        "CockpitTranslate",
        "CockpitFormat",
        function($q, connectionActions, sessionCertificates,
                 runCommand, translate, format) {
            var _ = translate.gettext;
            return {
                restrict: "E",
                scope: true,
                link: function($scope, element, attrs) {
                    var pem = null;
                    $scope.address = null;

                    function getCertDetails() {
                        var options = $scope.error ? $scope.error.options : {};
                        var cmd = runCommand([ "openssl", "x509", "-noout", "-text" ]);
                        options = options || {};
                        pem = options["rejected-certificate"];
                        cmd.then(function(data) {
                            $scope.details = data;
                        }, function(ex) {
                            var msg = format.format(_("Error getting certificate details: $0"), ex.problem);
                            $scope.failure(msg);
                        });
                        cmd.send(pem);
                        cmd.send("\n\n");
                    }

                    function loadData() {
                        if ($scope.currentCluster)
                            $scope.address = $scope.currentCluster.cluster.server;
                        else
                            $scope.address = $scope.defaultAddress;

                        $scope.action = "skip";
                        $scope.details = null;
                        getCertDetails();
                    }

                    $scope.update = function update() {
                        var cluster = { cluster: { server: $scope.address } };
                        if ($scope.currentCluster)
                            cluster = $scope.currentCluster;

                        var data = connectionActions.prepareData($scope.config, cluster, $scope.currentUser);
                        if ($scope.action == "pem")
                            sessionCertificates.trustCert(data.cluster.cluster, pem);

                        if ($scope.action != "pem")
                            data.cluster.cluster['insecure-skip-tls-verify'] = true;

                        return $scope.saveAndConnect(data);
                    };

                    $scope.$on("loadData", loadData);
                    loadData();
                },
                templateUrl: "views/auth-rejected-cert.html"
            };
        }
    ]);

}());
