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

    angular.module('kubernetes.connection', [
        'ui.bootstrap',
        'kubeClient',
        'kubeClient.cockpit',
        'kubeUtils',
    ])

    .factory("connectionActions", [
        "$q",
        "cockpitKubeDiscover",
        "cockpitKubectlConfig",
        "cockpitRunCommand",
        "cockpitConnectionInfo",
        "KubeMapNamedArray",
        "KubeTranslate",
        function($q, cockpitKubeDiscover, kubectl, runCommand,
                 cockpitConnectionInfo, mapNamedArray, translate) {

            var DEFAULT_ADDRESS = "http://localhost:8080";
            var _ = translate.gettext;

            function kubectlError(ex) {
                // Because angular warns about all throws
                var defer = $q.defer();
                console.warn("Unexpected Kubectl Error", ex);
                defer.reject(new Error(_("Error writing kubectl config")));
                return defer.promise;
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
                            result.defaultAddress = "https://" + address + ":" + options.port;

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
                    cluster: {
                        address: DEFAULT_ADDRESS
                    }
                };

                config = config ? config : {};
                cluster = cluster ? cluster : default_cluster;

                function ensureValid(name, options) {
                    var added;
                    var chars = "abcdefghijklmnopqrstuvwxyz";
                    name = name.toLowerCase().replace(/^[^a-z0-9\/-]+$/i, "-");
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
                    user.name = generateUserName(user, cluster ? cluster.name : "");

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

            function writeKubectlClusterCA(cluster, pem) {
                var SCRIPT = 'f=$(mktemp); echo "$2" > "$f"; kubectl config set-cluster $1 --certificate-authority="$f" --embed-certs=true; rm "$f"';
                var args = [ "/bin/sh", "-c", SCRIPT, "--", cluster.name, pem ];
                return runCommand(args).then(function (r) {
                    console.log(r);
                    return kubectlData().then(function (data) {
                        return loadConfigData(data);
                    });
                }).catch(kubectlError);
            }

            function writeKubectlConfig(cluster, user, context) {
                var defer = $q.defer();
                var promises = [];
                var cluster_args;
                var user_args;

                if (user && user.user) {
                    user_args = [ "kubectl", "config", "set-credentials",
                                  user.name, "--username=" + (user.user.username || "") ];
                    if (user.user.password)
                        user_args.push("--password=" + (user.user.password || ""));
                    promises.push(runCommand(user_args));
                }

                if (cluster && cluster.cluster) {
                    cluster_args = [ "kubectl", "config", "set-cluster",
                                     cluster.name, "--server=" + cluster.cluster.server,
                                     "--insecure-skip-tls-verify=" + !!cluster.cluster["insecure-skip-tls-verify"]
                    ];
                    promises.push(runCommand(cluster_args));
                    console.log(cluster_args);
                }

                return $q.all(promises).then(function() {
                    var cmd_args;
                    if (context) {
                        cmd_args = [ "kubectl", "config", "set-context", context.name ];

                        angular.forEach(["namespace", "user", "cluster"], function(value, key) {
                            if (context.context && context.context[value])
                                cmd_args.push("--" + value + "=" + context.context[value]);
                        });

                        console.log(cmd_args);
                        return runCommand(cmd_args).then(function() {
                            console.log(context.name);
                            return runCommand([ "kubectl", "config", "use-context", context.name ]);
                        });
                    }
                }).then(kubectlData).then(function () {
                    return kubectlData().then(function(data) {
                        return loadConfigData(data);
                    });
                }).catch(kubectlError);
            }

            return {
                prepareData: prepareData,
                load: load,
                writeKubectlClusterCA: writeKubectlClusterCA,
                writeKubectlConfig: writeKubectlConfig
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
        function($q, $scope, instance, dialogData, connectionActions, CockpitKubeRequest, kubectl) {
            var trustedCerts = {};
            angular.extend($scope, dialogData);

            $scope.$on("selectUser", function (ev, user) {
                $scope.currentUser = user;
            });

            $scope.$on("selectCluster", function (ev, cluster) {
                $scope.currentCluster = cluster;
            });

            $scope.trustCert = function(cluster, pem) {
                var options, address;
                if ($scope.haveKubectl) {
                    return connectionActions.writeKubectlClusterCA(cluster, pem);
                } else {
                    options = kubectl.generateKubeOptions(cluster.cluster || {});
                    address = options.address || "localhost";
                    trustedCerts[address] = pem;
                    return $q.when({
                        currentUser: $scope.currentUser,
                        currentCluster: cluster,
                    });
                }
            };

            $scope.connect = function(data) {
                var cluster, user, options, address;

                cluster = data.currentCluster ? data.currentCluster.cluster : null;
                user = data.currentUser ? data.currentUser.user : null;

                options = kubectl.generateKubeOptions(cluster, user);
                address = options.address || "localhost";

                if (!$scope.haveKubectl && options.tls && trustedCerts[address])
                    options.tls["authority"] = { data: trustedCerts[address] };

                console.log(options);
                var promise = new CockpitKubeRequest("GET", "/api", "", options);
                return promise.then(function() {
                    return $scope.haveKubectl ? "kubectl" : options;
                }).catch(function (ex) {
                    var defer = $q.defer();

                    data.error = ex;
                    console.log(ex);
                    angular.extend($scope, data);

                    $scope.$broadcast("loadData");
                    defer.reject([]);

                    return defer.promise;
                });
            };
        }
    ])

    .directive("authForm", [
        "$q",
        "connectionActions",
        "KubeTranslate",
        "KubeFormat",
        function($q, connectionActions, translate, format) {
        var _ = translate.gettext;
        return {
            restrict: "E",
            scope: true,
            link: function($scope, element, attrs) {
                $scope.fields = {};

                function loadData() {
                    console.log($scope.clusters);
                    if ($scope.error) {
                        $scope.failure(format.format(_("Connection Error: $0"), $scope.error.problem));
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
                    var defer = $q.defer();
                    var errors = [];
                    var ex;
                    var address_re = /^[a-z0-9\:\/.-]+$/i;
                    var address = $scope.fields.address;
                    var cluster = { cluster: {} };
                    var user;

                    if (!$scope.fields.address || !address_re.test(address.toLowerCase())) {
                        ex = _("Please provide a valid address");
                        ex.target = "#kubernetes-address";
                        errors.push(ex);
                        ex = null;
                    }

                    if (address.indexOf("http://") !== 0 &&
                        address.indexOf("https://") !== 0)
                            address = "http://" + address;

                    user = $scope.useAuth ? $scope.currentUser : null;
                    if (!user && $scope.useAuth)
                        user = { user: {} };

                    if (user && !$scope.fields.username &&
                        (!user.name || user.user.username)) {
                        ex = _("Please provide a username");
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
                    }

                    if (errors.length > 0)
                        defer.reject(errors);
                    else
                        defer.resolve(connectionActions.prepareData($scope.config, cluster, user));

                    return defer.promise;
                }

                $scope.selectCluster = function selectCluster(cluster) {
                    var inner = cluster && cluster.cluster ? cluster.cluster : {};
                    $scope.fields.address = inner.server;
                    $scope.fields.skipVerify = inner["insecure-skip-tls-verify"];
                    $scope.$emit("selectCluster", cluster);
                };

                $scope.selectUser = function selectUser(user) {
                    var inner = user && user.user ? user.user : {};
                    $scope.fields.username = inner.username;
                    $scope.fields.password = inner.password;
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
                    return validate().then(function(data) {
                        if ($scope.haveKubectl) {
                            return connectionActions.writeKubectlConfig(data.cluster, data.user, data.context);
                        } else {
                            return $q.when({
                                currentUser: data.user,
                                currentCluster: data.cluster,
                            });
                        }
                    }).then(function(data) {
                        return $scope.connect(data);
                    });
                };

                $scope.$on("loadData", loadData);
                loadData();
            },
            templateUrl: "views/auth-form.html"
        };
    } ])

    .directive("authRejectedCert", [
        "$q",
        "connectionActions",
        "cockpitRunCommand",
        "KubeTranslate",
        "KubeFormat",
        function($q, connectionActions, runCommand, translate, format) {
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
                        var promise;
                        var cluster = { cluster: { address: $scope.address } };
                        if ($scope.currentCluster)
                            cluster = $scope.currentCluster;

                        var data = connectionActions.prepareData($scope.config, cluster);

                        console.log($scope.currentCluster);
                        console.log(data);
                        if ($scope.action == "pem") {
                            promise = $scope.trustCert(data.cluster, pem);
                        } else {
                            data.cluster.cluster['insecure-skip-tls-verify'] = true;
                            if ($scope.haveKubectl) {
                                promise = connectionActions.writeKubectlConfig(data.cluster);
                            } else {
                                promise = $q.when({
                                    currentUser: data.user,
                                    currentCluster: data.cluster,
                                });
                            }
                        }

                        return promise.then(function(data) {
                            return $scope.connect(data);
                        });
                    };

                    $scope.$on("loadData", loadData);
                    loadData();
                },
                templateUrl: "views/auth-rejected-cert.html"
            };
        }
    ]);

}());
