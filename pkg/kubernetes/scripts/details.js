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

(function() {
    "use strict";

    var angular = require('angular');
    require('kubernetes-object-describer/dist/object-describer.js');

    require('./containers');
    require('./date');
    require('./dialog');
    require('./kube-client');
    require('./listing');
    require('./utils');
    require('./volumes');

    require('../views/details-page.html');
    require('../views/pod-container.html');
    require('../views/details-page.html');
    require('../views/item-delete.html');
    require('../views/route-modify.html');
    require('../views/replicationcontroller-modify.html');
    require('../views/service-modify.html');
    require('../views/deploymentconfig-body.html');
    require('../views/replicationcontroller-pods.html');
    require('../views/replicationcontroller-body.html');
    require('../views/route-body.html');
    require('../views/service-body.html');
    require('../views/service-endpoint.html');

    require('../views/pod-page.html');
    require('../views/image-page.html');
    require('../views/registry-dashboard-page.html');
    require('../views/details-page.html');
    require('../views/project-page.html');
    require('../views/topology-page.html');
    require('../views/node-page.html');
    require('../views/dashboard-page.html');
    require('../views/nodes-page.html');
    require('../views/deploymentconfig-page.html');
    require('../views/pv-page.html');
    require('../views/container-page.html');
    require('../views/service-page.html');
    require('../views/group-page.html');
    require('../views/containers-page.html');
    require('../views/projects-page.html');
    require('../views/user-page.html');
    require('../views/images-page.html');
    require('../views/replicationcontroller-page.html');
    require('../views/route-page.html');
    require('../views/imagestream-page.html');
    require('../views/volumes-page.html');

    function validItem(item, type) {
        var valid = (item && (!type || item.kind === type) &&
                     item.spec && item.metadata);
        var type_name = type ? type : "Object";

        if (!valid)
            console.warn("Invalid "+ type_name, item);

        return valid;
    }

    function format_addresses_with_ports(addresses, ports) {
        var text = addresses.join(", ");

        if (ports && ports.length) {
            text = text + ":" + ports.map(function(p) {
                if (p.protocol === "TCP")
                    return p.port;
                else
                    return p.port + "/" + p.protocol;
            }).join(", ");
        }

        return text;
    }

    angular.module('kubernetes.details', [
        'ngRoute',
        'ui.cockpit',
        'kubernetesUI',
        'kubeClient',
        'kubeUtils',
        'kubernetes.listing',
        'kubernetes.date',
        'kubernetes.volumes',
        'kubernetes.containers',
    ])

    .config([
        '$routeProvider',
        function($routeProvider) {
            $routeProvider
                .when('/list/:namespace?', {
                    templateUrl: 'views/details-page.html',
                    controller: 'DetailsCtrl'
                })
                .when('/l/pods/:pod_namespace/:pod_name/:container_name', {
                        templateUrl: 'views/pod-container.html',
                        controller: 'ContainerCtrl',
                })
                .when('/l/:target_type/:target_namespace/:target', {
                        templateUrl: function (params) {
                            var re = /s$/;
                            var kind = params.target_type || "";

                            return 'views/' + kind.replace(re, "") + "-page.html";
                        },
                        controller: 'DetailCtrl',
                        resolve: {
                            'kindData': [
                                'kindData',
                                function (kindData) {
                                    return kindData();
                                }
                            ]
                        }
                })
                .when('/l/:target_type', {
                    templateUrl: 'views/details-page.html',
                    controller: 'DetailCtrl',
                    resolve: {
                        'kindData': [
                            'kindData',
                            function (kindData) {
                                return kindData();
                            }
                        ]
                    }
                });
        }
    ])

    .factory("kindData", [
        "$q",
        "$route",
        "$location",
        function($q, $route, $location) {
            var typesToKinds = {
                'services': 'Service',
                'routes': 'Route',
                'deploymentconfigs': 'DeploymentConfig',
                'replicationcontrollers': 'ReplicationController',
                'pods': 'Pod',
            };

            return function() {
                var current = $route.current.params['target_type'];
                var kind;
                if (current)
                    kind = typesToKinds[current];

                if (!kind) {
                    $location.path('/');
                    return $q.reject();
                }

                return $q.when({
                    'kind' : kind,
                    'type' : current,
                });
            };
        }
    ])

    .factory("detailsWatch", [
        "kubeLoader",
        "KubeDiscoverSettings",
        function (loader, settings) {
            return function(until) {
                loader.watch("Pod", until);
                loader.watch("Service", until);
                loader.watch("ReplicationController", until);
                loader.watch("Endpoints", until);
                loader.watch("PersistentVolumeClaim", until);
                settings().then(function(settings) {
                    if (settings.flavor === "openshift") {
                        loader.watch("DeploymentConfig", until);
                        loader.watch("Route", until);
                    }
                });
            };
        }
    ])

    .factory("detailsData", [
        'kubeSelect',
        'volumeData',
        'KubeContainers',
        "KubeTranslate",
        function (select, volumeData, containers, translate) {
            var _ = translate.gettext;
            var names = {
                'services': {
                    'name' : _("Services")
                },
                'routes': {
                    'name' : _("Routes"),
                    'flavor': "openshift"
                },
                'deploymentconfigs': {
                    'name': _("Deployment Configs"),
                    'flavor': "openshift"
                },
                'replicationcontrollers': {
                     'name' : _("Replication Controllers")
                },
                'pods': {
                    'name' : _("Pods")
                }
            };

            function item_identifier(item) {
                var meta = item.metadata || { };
                var id = item.kind.toLowerCase() + "s/";
                if (meta.namespace)
                    id = id + meta.namespace + "/";
                return id + meta.name;
            }

            function service_endpoint(service) {
                return select().kind("Endpoints")
                               .namespace(service.metadata.namespace)
                               .name(service.metadata.name).one();
            }

            function replicationcontroller_pods(item) {
                var meta = item.metadata || {};
                var spec = item.spec || {};
                return select().kind("Pod")
                               .namespace(meta.namespace || "")
                               .label(spec.selector || {});
            }

            function podStatus(item) {
                var status = item.status || {};
                var meta = item.metadata || {};

                if (meta.deletionTimestamp)
                    return "Terminating";
                else
                    return status.phase;
            }

            return {
                itemIdentifier: item_identifier,
                serviceEndpoint: service_endpoint,
                replicationcontrollerPods: replicationcontroller_pods,
                podStatus: podStatus,
                volumesForPod: volumeData.volumesForPod,
                claimFromVolumeSource: volumeData.claimFromVolumeSource,
                containers: containers,
                names: names
            };
        }
    ])

    /*
     * The controller for the details view.
     */
    .controller('DetailsCtrl', [
        '$scope',
        'kubeLoader',
        'kubeSelect',
        'KubeDiscoverSettings',
        'ListingState',
        '$location',
        'itemActions',
        'detailsData',
        'detailsWatch',
        function($scope, loader, select, discoverSettings, ListingState,
                 $location, actions, detailsData, detailsWatch) {

            loader.listen(function() {
                $scope.pods = select().kind("Pod");
                $scope.services = select().kind("Service");
                $scope.replicationcontrollers = select().kind("ReplicationController");
                $scope.deploymentconfigs = select().kind("DeploymentConfig");
                $scope.routes = select().kind("Route");
            }, $scope);

            detailsWatch($scope);
            $scope.listing = new ListingState($scope);
            $scope.showAll = true;

            $scope.$on("activate", function(ev, id) {
                ev.preventDefault();
                actions.navigate(id);
            });

            /* All the data and actions available on the $scope */
            angular.extend($scope, detailsData);
            angular.extend($scope, actions);
        }
    ])

    .controller('DetailCtrl', [
        '$scope',
        'kindData',
        'kubeLoader',
        'kubeSelect',
        'ListingState',
        '$routeParams',
        '$location',
        'itemActions',
        'detailsData',
        'detailsWatch',
        function($scope, kindData, loader, select, ListingState, $routeParams,
                 $location, actions, detailsData, detailsWatch) {

            var target = $routeParams["target"] || "";
            $scope.target = target;
            $scope.name = detailsData.names[kindData.type].name;

            loader.listen(function() {
                if (kindData.type)
                    $scope[kindData.type] = select().kind(kindData.kind);

                if (target && $routeParams.target_namespace) {
                    $scope.item = select().kind(kindData.kind)
                                          .namespace($routeParams.target_namespace)
                                          .name(target)
                                          .one();
                }
            }, $scope);

            detailsWatch($scope);
            $scope.listing = new ListingState($scope);
            $scope.listing.inline = true;

            $scope.$on("activate", function(ev, id) {
                ev.preventDefault();
                actions.navigate(id);
            });

            /* All the data and actions available on the $scope */
            angular.extend($scope, detailsData);
            angular.extend($scope, actions);
            angular.extend($scope, kindData);
        }
    ])

    .directive('kubernetesServiceCluster', function() {
        return {
            restrict: 'E',
            link: function($scope, element, attributes) {
                $scope.$watchGroup(["item.spec.clusterIP",
                                    "item.spec.ports"], function(values) {
                    var text = format_addresses_with_ports([values[0]],
                                                           values[1]);
                    element.text(text);
                });
            }
        };
    })

    .factory('itemActions', [
        '$modal',
        '$location',
        function($modal, $location) {
            function deleteItem(item) {
                return $modal.open({
                    animation: false,
                    controller: 'ItemDeleteCtrl',
                    templateUrl: 'views/item-delete.html',
                    resolve: {
                        dialogData: function() {
                            return { item: item };
                        }
                    },
                }).result;
            }

            function modifyRoute(item) {
                return $modal.open({
                    animation: false,
                    controller: 'RouteModifyCtrl',
                    templateUrl: 'views/route-modify.html',
                    resolve: {
                        dialogData: function() {
                            return { item: item };
                        }
                    },
                }).result;
            }

            function modifyRC(item) {
                return $modal.open({
                    animation: false,
                    controller: 'RCModifyCtrl',
                    templateUrl: 'views/replicationcontroller-modify.html',
                    resolve: {
                        dialogData: function() {
                            return { item: item };
                        }
                    },
                }).result;
            }

            function modifyService(item) {
                return $modal.open({
                    animation: false,
                    controller: 'ServiceModifyCtrl',
                    templateUrl: 'views/service-modify.html',
                    resolve: {
                        dialogData: function() {
                            return { item: item };
                        }
                    },
                }).result;
            }

            function navigate(path) {
                var prefix = '/l';
                path = path ? path : "";
                if (!path)
                    prefix = "/list";

                if (path && path.indexOf('/') !== 0)
                    prefix = prefix + '/';

                $location.path(prefix + path);
            }

            return {
                modifyRC: modifyRC,
                modifyRoute: modifyRoute,
                deleteItem: deleteItem,
                modifyService: modifyService,
                navigate: navigate,
            };
        }
    ])

    .controller("ItemDeleteCtrl", [
        "$scope",
        "$modalInstance",
        "dialogData",
        "kubeMethods",
        function($scope, $instance, dialogData, methods) {
            angular.extend($scope, dialogData);

            $scope.performDelete = function performDelete() {
                return methods.delete($scope.item);
            };
        }
    ])

    .controller("RCModifyCtrl", [
        "$q",
        "$scope",
        "$modalInstance",
        "dialogData",
        "kubeMethods",
        "KubeTranslate",
        function($q, $scope, $instance, dialogData, methods, translate) {
            var _ = translate.gettext;
            var item = dialogData.item;
            var fields = {};

            if (!validItem(item, "ReplicationController")) {
                $scope.$applyAsync(function () {
                    $scope.$dismiss();
                });
                return;
            }

            fields.replicas = item.spec ? item.spec.replicas : 1;

            function validate() {
                var defer = $q.defer();
                var replicas = Number(fields.replicas.trim());
                var ex;

                if (isNaN(replicas) || replicas < 0)
                    ex = new Error(_("Not a valid number of replicas"));
                else if (replicas > 128)
                    ex = new Error(_("The maximum number of replicas is 128"));

                if (ex) {
                    ex.target = "#replicas";
                    defer.reject(ex);
                } else {
                    defer.resolve({ spec: { replicas: replicas } });
                }

                return defer.promise;
            }

            $scope.fields = fields;
            $scope.item = item;

            $scope.performModify = function performModify() {
                return validate().then(function(data) {
                    return methods.patch($scope.item, data);
                });
            };
        }
    ])

    .controller("RouteModifyCtrl", [
        "$q",
        "$scope",
        "$modalInstance",
        "dialogData",
        "kubeMethods",
        "KubeTranslate",
        function($q, $scope, $instance, dialogData, methods, translate) {
            var _ = translate.gettext;
            var fields = {};

            if (!validItem(dialogData.item, "Route")) {
                $scope.$applyAsync(function () {
                    $scope.$dismiss();
                });
                return;
            }

            fields.host = dialogData.item.spec.host;

            function validate() {
                var defer = $q.defer();
                var host = fields.host.trim();
                var ex;

                if (!host) {
                    ex = new Error(_("Not a valid value for Host"));
                    ex.target = "#host-value";
                    defer.reject(ex);
                } else {
                    defer.resolve({ spec: { host: fields.host.trim() } });
                }

                return defer.promise;
            }

            $scope.fields = fields;
            angular.extend($scope, dialogData);

            $scope.performModify = function performModify() {
                return validate().then(function(data) {
                    return methods.patch($scope.item, data);
                });
            };
        }
    ])

    .controller("ServiceModifyCtrl", [
        "$q",
        "$scope",
        "$modalInstance",
        "dialogData",
        'kubeLoader',
        'kubeSelect',
        "KubeRequest",
        "KubeTranslate",
        "KubeFormat",
        function($q, $scope, $instance, dialogData, loader, select, KubeRequest, translate, format) {
            var _ = translate.gettext;
            var fields = {};
            var key;

            if (!validItem(dialogData.item, "Service")) {
                $scope.$applyAsync(function () {
                    $scope.$dismiss();
                });
                return;
            }


            $scope.rcs = select().kind("ReplicationController")
                                 .namespace(dialogData.item.metadata.namespace || "")
                                 .label(dialogData.item.spec.selector || {});

            for (key in $scope.rcs) {
                var item = $scope.rcs[key];
                fields[key] = {
                    name: item.metadata.name,
                    replicas: item.spec.replicas,
                };
            }

            $scope.service = dialogData.item;
            $scope.fields = fields;
            angular.extend($scope, dialogData);

            function validate() {
                var defer = $q.defer();
                var link;
                var objects = [];
                var failures = [];

                for (link in fields) {
                    var ex;
                    var replicas = Number(fields[link].replicas);
                    var name = fields[link].name;

                    if (isNaN(replicas) || replicas < 0)
                        ex = new Error(_("Not a valid number of replicas"));
                    else if (replicas > 128)
                        ex = new Error(_("The maximum number of replicas is 128"));

                    if (ex) {
                        ex.target = "#" + name;
                        failures.push(ex);
                    } else {
                        objects.push({
                            link: link,
                            name: name,
                            data: { spec: { replicas: replicas } }
                        });
                    }
                }

                if (failures.length > 0) {
                    defer.reject(failures);
                } else
                    defer.resolve(objects);

                return defer.promise;
            }

            $scope.performModify = function performModify() {
                var defer = $q.defer();
                var link;
                var req;

                validate().then(function (objects) {
                    function step() {
                        var obj = objects.shift();
                        if (!obj) {
                            defer.resolve();
                            return;
                        }

                        defer.notify(format.format(_("Updating $0..."), obj.name));

                        var config = { headers: { "Content-Type": "application/strategic-merge-patch+json" } };
                        new KubeRequest("PATCH", obj.link, JSON.stringify(obj.data), config)
                            .then(function(response) {
                                step();
                            }, function(response) {
                                var resp = response.data;
                                return defer.reject(resp || response);
                            });
                    }

                    step();

                }).catch(function(exs) {
                    defer.reject(exs);
                });

                var promise = defer.promise;
                promise.cancel = function cancel() {
                    if (req && req.cancel)
                        req.cancel();
                };

                return promise;
            };
        }
    ])

    .directive('deploymentconfigBody',
        function() {
            return {
                restrict: 'A',
                templateUrl: 'views/deploymentconfig-body.html'
            };
        }
    )

    .directive('replicationcontrollerPods',
        function() {
            return {
                restrict: 'A',
                templateUrl: 'views/replicationcontroller-pods.html'
            };
        }
    )

    .directive('replicationcontrollerBody',
        function() {
            return {
                restrict: 'A',
                templateUrl: 'views/replicationcontroller-body.html'
            };
        }
    )

    .directive('routeBody',
        function() {
            return {
                restrict: 'A',
                templateUrl: 'views/route-body.html'
            };
        }
    )

    .directive('serviceBody',
        function() {
            return {
                restrict: 'A',
                templateUrl: 'views/service-body.html'
            };
        }
    )

    .directive('serviceEndpoint',
        function() {
            return {
                restrict: 'A',
                templateUrl: 'views/service-endpoint.html'
            };
        }
    );
}());
