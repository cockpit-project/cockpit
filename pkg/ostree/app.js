(function() {
    "use strict";

    var cockpit = require('cockpit');
    var moment = require('moment');

    var angular = require('angular');
    require('angular-dialog.js');
    require('angular-route');
    require('angular-gettext/dist/angular-gettext.js');
    require('angular-bootstrap-npm/dist/angular-bootstrap.js');

    var client = require('./client');
    require('./remotes');

    var _ = cockpit.gettext;
    cockpit.translate();

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

    angular.module('ostree', [
            'ngRoute',
            'gettext',
            'ui.cockpit',
            'ostree.remotes',
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

                var timeout;
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
                timeout = window.setTimeout(function() {
                    set_curtains({ state: 'connecting' });
                    document.body.removeAttribute('hidden');
                    timeout = null;
                }, 1000);

                function handle(promise) {
                    promise
                        .always(function() {
                            document.body.removeAttribute('hidden');
                            window.clearTimeout(timeout);
                            timeout = null;
                        })
                        .done(function(connection) {
                            timeout = window.setTimeout(check_empty, 1000);
                        })
                        .fail(show_failure);
                }

                function on_connection_lost(event, ex) {
                    show_failure(ex);
                }
                client.addEventListener("connectionLost", on_connection_lost);
                client.addEventListener("changed", check_empty);

                handle(client.connect());
                $scope.reconnect = function reconnect() {
                    set_curtains({ state: 'connecting' });
                    handle(client.connect());
                };

                $scope.$on("$destroy", function() {
                    client.removeEventListener("connectionLost", on_connection_lost);
                    client.removeEventListener("changed", check_empty);
                });
            }
        ])

        .controller('indexController', [
            '$scope',
            function($scope) {
                $scope.os = null;
                $scope.track_id = track_id;

                $scope.displayOS = function(os) {
                    $scope.os = os;
                    $scope.currentOrigin = client.get_default_origin(os);
                };

                $scope.knownVersions = function() {
                    var origin = $scope.currentOrigin || {};
                    return client.known_versions_for($scope.os,
                                                     origin.remote,
                                                     origin.branch);
                };

                $scope.itemMatches = function(item, proxy_arg) {
                    return client.item_matches(item, proxy_arg);
                };

                $scope.$on("changeOrigin", function (ev, remote, branch) {
                    $scope.$applyAsync(function() {
                        var origin = {
                            "remote": remote,
                            "branch": branch,
                        };

                        var defaultOrigin = client.get_default_origin($scope.os) || {};
                        if (!origin.branch)
                            origin.branch = defaultOrigin.branch;
                        if (!origin.remote)
                            origin.remote = defaultOrigin.remote;

                        $scope.currentOrigin = origin;
                    });
                });

                function on_changed() {
                    $scope.$applyAsync(function() {
                        $scope.runningMethod = client.running_method;
                        $scope.os_list = client.os_list;
                        if (client.os_list) {
                            if (!$scope.os || !client.get_os_proxy($scope.os))
                                $scope.displayOS(client.os_list[0]);
                        } else {
                            $scope.displayOS(null);
                        }
                    });
                }

                client.connect().
                    done(function () {
                        client.addEventListener("changed", on_changed);
                        on_changed();
                    });

                $scope.$on("$destroy", function() {
                    client.removeEventListener("changed", on_changed);
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
            '$modal',
            "remoteActions",
            function($modal, remoteActions) {
                return {
                    restrict: 'E',
                    templateUrl: "ostree-check.html",
                    scope: {
                        os: "=",
                        runningMethod: "=",
                        currentOrigin: "="
                    },
                    link: function(scope, element, attrs) {
                        scope.error = null;
                        scope.progressMsg = null;
                        scope.isRunning = false;
                        scope.branches = {};

                        function updateBranchCache(remote, branch) {
                            scope.isRunning = true;

                            /* We want to populate the list with already downloaded updates
                             * but this can error if there are no new updates or the remote
                             * hasn't yes been downloaded from so we ignore errors.
                             * If there is a real error, the use will see if when they
                             * check for updates.
                             */
                            client.cache_update_for(scope.os,
                                                    remote,
                                                    branch)
                                .always(function () {
                                    scope.$applyAsync(function () {
                                        scope.isRunning = false;
                                    });
                                });
                        }

                        scope.$watch("currentOrigin.remote", function (newValue) {
                            var branches = {
                                remote: newValue
                            };

                            if (!newValue) {
                                scope.branches = {};
                                return;
                            }

                            // Only run when remote is changed by loading new OS
                            // dialog takes care of this when changed there
                            if (scope.branches.remote === newValue)
                                return;

                            scope.isRunning = true;
                            remoteActions.listBranches(newValue)
                                .then(function (data) {
                                    branches.list = data;
                                }, function (ex) {
                                    branches.error = cockpit.message(ex);
                                })
                                .then(function () {
                                    scope.$applyAsync(function() {
                                        scope.branches = branches;
                                        scope.isRunning = false;
                                    });
                                });
                        });

                        scope.$watch("runningMethod", function() {
                            var expected = "DownloadUpdateRpmDiff:" + scope.os;
                            var expected2 = "DownloadRebaseRpmDiff:" + scope.os;
                            scope.isRunning = expected === client.running_method ||
                                              expected2 === client.running_method;
                        });

                        scope.checkForUpgrades = function() {
                            var origin = scope.currentOrigin || {};
                            scope.error = null;
                            scope.progressMsg = _("Checking for updates");

                            var promise = client.check_for_updates(scope.os,
                                                                   origin.remote,
                                                                   origin.branch);
                            notify_result(promise, scope);
                        };

                        scope.switchBranch = function(branch) {
                            if (!scope.currentOrigin)
                                return;

                            scope.error = null;

                            updateBranchCache(scope.currentOrigin.remote, branch);
                            scope.$emit("changeOrigin", scope.currentOrigin.remote, branch);
                        };

                        scope.changeRepository = function() {
                            scope.error = null;
                            var promise = $modal.open({
                                animation: false,
                                controller: 'ChangeRepositoryCtrl',
                                templateUrl: 'repository-dialog.html',
                                resolve: {
                                    dialogData: function() {
                                        var origin = scope.currentOrigin || {};
                                        return {
                                            "remote": origin.remote,
                                            "branch": origin.branch,
                                            "os": scope.os
                                        };
                                    }
                                },
                            }).result;

                            /* If the change is successful */
                            promise.then(function(result) {
                                scope.branches = result.branches;
                                scope.$emit("changeOrigin", result.remote, result.branch);
                            });
                            return promise;
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
                            else if (!scope.item.id)
                                expected = "Rebase:";

                            if (scope.item && scope.item.osname)
                                expected = expected + scope.item.osname.v;

                            scope.isRunning = expected === client.running_method;
                        }

                        scope.error = null;
                        scope.progressMsg = null;
                        scope.id = track_id(scope.item);
                        scope.active = 'tree';

                        function on_changed() {
                            scope.$digest();
                        }

                        scope.matches = function (proxy_arg) {
                            return client.item_matches(scope.item, proxy_arg);
                        };

                        scope.packages = client.packages(scope.item);
                        scope.packages.addEventListener("changed", on_changed);
                        scope.$on("$destroy", function() {
                            scope.packages.removeEventListener("changed", on_changed);
                        });

                        scope.signature_obj = client.signature_obj;

                        scope.isRunning = false;
                        set_running();
                        scope.$watch("runningMethod", set_running);

                        scope.isUpdate = function () {
                            return scope.matches('CachedUpdate') && !scope.matches('DefaultDeployment');
                        };

                        scope.isRollback = function() {
                            return scope.matches('RollbackDeployment') &&
                                   !scope.matches('CachedUpdate');
                        };

                        scope.isRebase = function() {
                            return scope.item && !scope.item.id &&
                                   !client.item_matches(scope.item, 'BootedDeployment', 'origin') &&
                                   !scope.matches('RollbackDeployment') &&
                                   !scope.matches('DefaultDeployment');
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

                        scope.doRebase = function(os, origin, hash) {
                            scope.error = null;
                            var args = {
                                "reboot" : cockpit.variant("b", true),
                                "revision" : cockpit.variant("s", hash),
                            };
                            var promise = client.run_transaction("Rebase", [args, origin, []], os);
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
}());
