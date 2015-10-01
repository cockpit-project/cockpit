define([
    "jquery",
    "base1/cockpit",
    "base1/angular",
    "kubernetes/client",
    "base1/moment",
], function($, cockpit, angular, kubernetes, moment) {
    'use strict';

    return angular.module('kubernetes', [
            'ngAnimate',
            'ngRoute',
            'ui.bootstrap',
            'kubernetes.containers',
            'kubernetes.dashboard',
            'kubernetes.details',
            'kubernetes.graph',
            'kubernetes.images',
            'kubernetes.topology'
        ])
        .config(['$routeProvider', function($routeProvider) {
            $routeProvider.otherwise({ redirectTo: '/' });
        }])

        .controller('MainCtrl', [
            '$scope',
            '$route',
            '$routeParams',
            '$location',
            'kubernetesClient',
            function($scope, $route, $routeParams, $location, client) {
                $scope.$route = $route;
                $scope.$location = $location;
                $scope.$routeParams = $routeParams;

                /* Used to set detect which route is active */
                $scope.is_active = function is_active(template) {
                    var current = $scope.$route.current;
                    return current && current.loadedTemplateUrl === template;
                };

                /* Used by child scopes */
                $scope.client = client;

                /* Used while debugging */
                $scope.console = console;

                /* When set then we hide the application */
                $scope.curtains = { state: 'silent' };

                var timeout = window.setTimeout(function() {
                    $scope.curtains = { state: 'connecting' };
                    $scope.$digest();
                    timeout = null;
                }, 1000);

                function handle(promise) {
                    promise
                        .always(function() {
                            window.clearTimeout(timeout);
                            timeout = null;
                        })
                        .done(function() {
                            $scope.curtains = null;
                            $scope.$digest();
                        })
                        .fail(function(ex) {
                            $scope.curtains = { state: 'failed', failure: ex };
                            $scope.$digest();
                        });
                }

                handle(client.connect());

                $scope.reconnect = function reconnect() {
                    $scope.curtains = { state: 'connecting' };
                    handle(client.connect(true));
                };
        }])

        /* Override the default angularjs exception handler */
        .factory('$exceptionHandler', ['$log', function($log) {
            return function(exception, cause) {

                /* Displays an oops if we're running in cockpit */
                cockpit.oops();

                /* And log with the default implementation */
                $log.error.apply($log, arguments);
            };
        }])

        /* The default orderBy filter doesn't work on objects */
        .filter('orderObjectBy', function() {
            return function(items, field) {
                var i, sorted = [];
                for (i in items)
                    sorted.push(items[i]);
                if (!angular.isArray(field))
                    field = [ String(criteria) ];
                var criteria = field.map(function(v) {
                    return v.split('.');
                });
                function value(obj, x) {
                    return obj ? obj[x] : undefined;
                }
                sorted.sort(function(a, b) {
                    var ra, rb, i, len = criteria.length;
                    for (i = 0; i < len; i++) {
                        ra = criteria[i].reduce(value, a);
                        rb = criteria[i].reduce(value, b);
                        if (ra === rb)
                            continue;
                        return (ra > rb ? 1 : -1);
                    }
                    return 0;
                });
                return sorted;
            };
        })

        .filter("timeAgo", function() {
            return function(when) {
                if (when)
                    return moment(when).fromNow();
                return "";
            };
        })

        .filter("formatBytes", function() {
            return function(num) {
                if (typeof num == "number")
                    return cockpit.format_bytes(num);
                return num;
            };
        })

        .factory('kubernetesClient', function() {
            return kubernetes.k8client();
        })

        .directive('listingTable', [
            'kubernetesFilter',
            function(filter) {
                return {
                    restrict: 'A',
                    link: function(scope, element, attrs) {
                        var selection = { };

                        /* Only view selected items? */
                        scope.quiet = false;

                        scope.selection = selection;

                        scope.selected = function selected(id) {
                            if (angular.isUndefined(id)) {
                                for (id in selection)
                                    return true;
                                return false;
                            } else {
                                return id in selection;
                            }
                        };

                        scope.select = function select(id, ev) {
                            var value;

                            /* Check that either .btn or li were not clicked */
                            if (ev && $(ev.target).parents().addBack().filter(".btn, li").length > 0)
                                return;

                            if (!id) {
                                Object.keys(selection).forEach(function(old) {
                                    delete selection[old];
                                });
                                scope.quiet = false;
                            } else {
                                value = !(id in selection);
                                if (value)
                                    selection[id] = true;
                                else
                                    delete selection[id];
                            }
                        };

                        scope.connect = function connect(what) {
                            scope.$broadcast("connect", what);
                        };

                        filter.register_listing(scope);
                    }
                };
            }
        ])

        .directive('listingPanel', [
            function() {
                return {
                    restrict: 'A',
                    scope: true,
                    link: function(scope, element, attrs) {
                        var tab = 'main';
                        scope.tab = function(name, ev) {
                            if (ev) {
                                tab = name;
                                ev.stopPropagation();
                            }
                            return tab === name;
                        };
                    },
                    templateUrl: function(element, attrs) {
                        var kind = attrs.kind || "default";
                        return "views/" + kind.toLowerCase() + "-panel.html";
                    }
                };
            }
        ])

        .directive('kubernetesFilterBar', [
            'kubernetesClient',
            'kubernetesFilter',
            function(client, filter) {
                return {
                    restrict: 'E',
                    scope: true,
                    link: function(scope, element, attrs) {
                        scope.filter = filter;

                        scope.namespaces = client.select("Namespace");
                        client.track(scope.namespaces);
                        $(scope.namespaces).on("changed", function () {
                            scope.$digest();
                        });
                        scope.$on("$destroy", function() {
                            client.track(scope.namespaces, false);
                        });

                        scope.filter_click = function filter_click(ev) {
                            if (!filter.listing)
                                return;

                            var value = !filter.listing.quiet;

                            /* If cannot set to true then open the menu */
                            if (value && !filter.listing.selected()) {
                                ev.stopPropagation();
                                element.children().first().addClass("open");
                            } else
                                filter.listing.quiet = value;
                        };
                    },
                    templateUrl: 'views/filter-bar.html'
                };
            }
        ])

        .factory('kubernetesFilter', [
            "kubernetesClient",
            "$location",
            "$rootScope",
            "$timeout",
            function(client, $location, $rootScope, $timeout) {
                var module = {
                    namespace: "",
                    listing: null,
                    set_namespace: set_namespace,
                    register_listing: register_listing
                };

                function set_namespace(namespace) {
                    var request_namespace = $location.search().namespace;
                    request_namespace = request_namespace ? request_namespace : null;
                    module.namespace = namespace ? namespace : null;

                    if (request_namespace !== module.namespace) {
                        $timeout(function () {
                            $location.search({namespace: module.namespace});
                        }, 0);
                    }

                    if (client.namespace() !==  module.namespace)
                        client.namespace(module.namespace);
                }

                $(client).on("namespace", function (event, new_namespace) {
                    if (new_namespace != module.namespace)
                        set_namespace(new_namespace);
                });

                $rootScope.$on("$routeChangeSuccess", function (event, current, prev) {
                    set_namespace($location.search().namespace);
                });

                $rootScope.$on('$routeChangeStart', function(next, current) {
                    var params = $location.search();
                    if (module.namespace && !params.namespace)
                        $location.search({namespace: module.namespace});
                });

                var registered = null;

                function register_listing(scope) {
                    if (registered) {
                        registered();
                        registered = null;
                    }

                    module.listing = scope;
                    if (scope) {
                        registered = scope.$on("$destroy", function() {
                            if (module.listing === scope) {
                                registered = null;
                                module.listing = null;
                            }
                        });
                    }
                }

                return module;
            }
        ]);
});
