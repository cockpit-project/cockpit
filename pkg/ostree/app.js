define([
    "jquery",
    "base1/cockpit",
    "base1/angular",
    "base1/moment",
    "updates/client",
], function($, cockpit, angular, moment, client) {
    'use strict';

    var _ = cockpit.gettext;
    var phantom_checkpoint = phantom_checkpoint || function () { };

    function track_id(item) {
        if (!item)
            return;

        var key = item.osname.v;
        if (item.id)
            key = key + item.id.v;

        if (item.checksum)
            key = key + item.checksum.v;

        return key;
    }

    function notify_result(promise, scope) {
        promise
            .progress(function(msg) {
                scope.$applyAsync(function() {
                    scope.progressMsg = msg;
                });
            })
            .fail(function(ex) {
                scope.$applyAsync(function() {
                    scope.error = cockpit.format(cockpit.message(ex));
                });
            })
            .always(function(ex) {
                scope.$applyAsync(function() {
                    scope.progressMsg = null;
                });
            });
    }


    return angular.module('ostree', [
            'ngRoute',
        ])
        .config([
            '$routeProvider',
             function($routeProvider) {
                $routeProvider.when('/', {
                    templateUrl: 'index.html',
                    controller: 'indexController'
                });
            }
        ])

        .controller('mainController', [
            '$scope',
            '$timeout',
            function($scope, $timeout) {

                function set_curtains(curtains) {
                    $scope.$applyAsync(function() {
                        $scope.curtains = curtains;
                        phantom_checkpoint();
                    });
                }

                function show_failure(ex) {
                    var message = null;
                    var final = false;
                    if (ex.problem === "access-denied") {
                        message = _("Not authorized to update software on this system");
                    } else if (ex.problem === "not-found") {
                        message = _("OSTree is not available on this system");
                        final = true;
                    } else {
                        message = cockpit.message(ex);
                    }

                    set_curtains({ state: 'failed',
                                   failure: ex,
                                   message: message,
                                   final: final });
                }

                function check_empty() {
                    window.clearTimeout(timeout);
                    timeout = null;
                    if (client.os_list && client.os_list.length === 0) {
                        set_curtains({
                            "state" : "empty",
                            "message" : _("No OSTree deployments found"),
                            "failure" : true
                        });
                    } else if ($scope.curtains !== null) {
                        set_curtains(null);
                    }
                }

                $scope.curtains = { state: 'silent' };
                var timeout = window.setTimeout(function() {
                    set_curtains({ state: 'connecting' });
                    $("body").show();
                    timeout = null;
                }, 1000);

                function handle(promise) {
                    promise
                        .always(function() {
                            $("body").show();
                            window.clearTimeout(timeout);
                            timeout = null;
                        })
                        .done(function(connection) {
                            timeout = window.setTimeout(check_empty, 1000);
                        })
                        .fail(show_failure);
                }

                $(client).on("connectionLost.main", function(event, ex) {
                    show_failure(ex);
                });
                $(client).on("changed.main", check_empty);

                handle(client.connect());
                $scope.reconnect = function reconnect() {
                    set_curtains({ state: 'connecting' });
                    handle(client.connect());
                };

                $scope.$on("$destroy", function() {
                    $(client).off(".main");
                });
            }
        ])

        .controller('indexController', [
            '$scope',
            function($scope) {
                $scope.track_id = track_id;

                /*
                 * phantom_checkpoint for tests
                 * on digest
                 */
                $scope.$watch(function() {
                    phantom_checkpoint();
                });

                $scope.knownVersions = function(os) {
                    return client.known_versions_for(os);
                };

                $scope.itemMatches = function(item, proxy_arg) {
                    return client.item_matches(item, proxy_arg);
                };

                client.connect().
                    done(function () {
                        $(client).on("changed.ostreeIndex", function() {
                            $scope.$applyAsync(function() {
                                $scope.runningMethod = client.running_method;
                                $scope.os_list = client.os_list;
                            });
                        });

                        $scope.$applyAsync(function() {
                            $scope.runningMethod = client.running_method;
                            $scope.os_list = client.os_list;
                        });
                    });

                $scope.$on("$destroy", function() {
                    $(client).off(".ostreeIndex");
                });
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

        .directive('ostreeCheck', [
            function() {
                return {
                    restrict: 'E',
                    templateUrl: "ostree-check.html",
                    scope: {
                        os: "=",
                        runningMethod: "="
                    },
                    link: function(scope, element, attrs) {
                        scope.error = null;
                        scope.progressMsg = null;
                        scope.isRunning = false;
                        scope.$watch("runningMethod", function() {
                            var expected = "DownloadUpdateRpmDiff:" + scope.os;
                            scope.isRunning = expected === client.running_method;
                        });

                        scope.checkForUpgrades = function() {
                            scope.error = null;
                            scope.progressMsg = _("Checking for updates");
                            var promise = client.run_transaction("DownloadUpdateRpmDiff",
                                                                 null, scope.os);
                            notify_result(promise, scope);
                        };
                    }
                };
            }
        ])

        .directive('ostreeItem', [
            function() {
                return {
                    restrict: 'E',
                    templateUrl: "ostree-item.html",
                    scope: {
                        item: "=",
                        runningMethod: "="
                    },
                    link: function(scope, element, attrs) {
                        function set_running() {
                            var expected = "";
                            if (client.item_matches(scope.item, "CachedUpdate"))
                                expected = "Deploy:";
                            else if (client.item_matches(scope.item, "RollbackDeployment"))
                                expected = "Rollback:";

                            if (scope.item && scope.item.osname)
                                expected = expected + scope.item.osname.v;

                            scope.isRunning = expected === client.running_method;
                        }

                        scope.error = null;
                        scope.progressMsg = null;
                        scope.id = track_id(scope.item);
                        scope.active = 'tree';

                        scope.packages = client.packages(scope.item);
                        $(scope.packages).on("changed", function() {
                            scope.$digest();
                        });
                        scope.$on("$destroy", function() {
                            $(scope.packages).off();
                        });

                        scope.isRunning = false;
                        set_running();
                        scope.$watch("runningMethod", set_running);

                        scope.matches = function(proxy_arg) {
                            return client.item_matches(scope.item, proxy_arg);
                        };

                        scope.switchTab = function(data) {
                            scope.active = data;
                        };

                        scope.activeTab = function(data) {
                            return scope.active === data;
                        };

                        scope.doRollback = function(os) {
                            scope.error = null;
                            var args = {
                                "reboot" : cockpit.variant("b", true)
                            };
                            var promise = client.run_transaction("Rollback", [args], os);
                            notify_result(promise, scope);
                        };

                        scope.doUpgrade = function(os, hash) {
                            scope.error = null;
                            var args = {
                                "reboot" : cockpit.variant("b", true)
                            };
                            var promise = client.run_transaction("Deploy", [hash, args], os);
                            notify_result(promise, scope);
                        };
                    }
                };
            }
        ])

        .filter('packages', function() {
            return function(number) {
                var format = cockpit.ngettext(_("$0 package"), _("$0 packages"), number);
                return cockpit.format(format, number);
            };
        })

        .filter('releaseName', function() {
            return function(deployment) {
                var formated = "";
                if (!deployment || !deployment.osname)
                    return;

                if (deployment.version)
                    formated = deployment.version.v;

                return cockpit.format("$0 $1", deployment.osname.v, formated);
            };
        })

        .filter("timeAgo", function() {
            return function(when) {
                if (when) {
                    return moment.unix(when).fromNow();
                }
                return "";
            };
        })

        .filter('dateFormat', function() {
            return function(when) {
                var formated;
                if (when) {
                    var d = new Date(when * 1000);
                    return d.toString();
                }
                return formated;
            };
        });
});
