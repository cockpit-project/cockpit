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

var cockpit = require('cockpit');
var angular = require('angular');

require('angular-dialog.js');
require('./utils');

var _ = cockpit.gettext;
var client = require('./client');

angular.module('ostree.remotes', [
    'ui.cockpit',
    'ostree.utils',
])

.factory("remoteActions", [
    "$q",
    "$timeout",
    "config",
    function($q, $timeout, config) {
        function listRemotes() {
            return cockpit.spawn(["ostree", "remote", "list"],
                                 { "superuser" : "try", "err" : "message"}).
                then(function(data) {
                    var d = data.trim().split(/\r\n|\r|\n/);
                    return d.sort();
                });
        }

        function listBranches(remote) {
            return client.reload().then(function () {
                return cockpit.spawn(["ostree", "remote", "refs", remote],
                                     { "superuser" : "try", "err" : "message"}).
                    then(function(data) {
                        var d = [];
                        angular.forEach(data.trim().split(/\r\n|\r|\n/), function (v, k) {
                            var parts = v.split(":");
                            if (parts.length > 1)
                                d.push(parts.slice(1).join(":"));
                            else
                                d.push(v);
                        });
                        return d.sort();
                    });
                });
        }

        function addRemote(name, url, gpg) {
            var cmd = ["ostree", "remote", "add" ];
            if (gpg)
                cmd.push("--set=gpg-verify=true");
            else
                cmd.push("--set=gpg-verify=false");
            cmd.push(name, url);

            return cockpit.spawn(cmd, { "superuser" : "try", "err" : "message"});
        }

        function deleteRemote(name) {
            return cockpit.spawn(["ostree", "remote", "delete", name],
                                 { "superuser" : "try", "err" : "message"});
        }

        function importGPGKey(name, key) {
            var process = cockpit.spawn(["ostree", "remote", "gpg-import", "--stdin", name],
                                        { "superuser" : "try", "err" : "message"});
            process.input(key);
            return process;
        }

        function getRemoteSettingsFile(name) {
            return cockpit.file("/etc/ostree/remotes.d/" + name + ".conf",
                                { "superuser" : "try"});
        }

        function getSectionName(name) {
            return 'remote "' + name + '"';
        }

        function loadRemoteSettings(name) {
            var file = getRemoteSettingsFile(name);
            var section = getSectionName(name);
            var d = $q.defer();
            file.read()
                .done(function (content, tag) {
                    var data = config.parseData(content);
                    if (data[section])
                        d.resolve(data[section]);
                    else
                        d.reject(_("No configuration data found"));
                })
                .fail(function (ex) {
                    d.reject(ex);
                })
                .always(function () {
                    file.close();
                });

            return d.promise;
        }

        function updateRemoteSettings(name, options) {
            var file = getRemoteSettingsFile(name);
            var section = getSectionName(name);
            var d = $q.defer();

            function mutate(content) {
                return config.changeData (content, section, options);
            }

            file.modify(mutate)
                .done(function (content, tag) {
                    d.resolve();
                })
                .fail(function (ex) {
                    d.reject(ex);
                })
                .always(function () {
                    file.close();
                });

            return d.promise;
        }

        return {
            listRemotes: listRemotes,
            listBranches: listBranches,
            loadRemoteSettings: loadRemoteSettings,
            updateRemoteSettings: updateRemoteSettings,
            addRemote: addRemote,
            deleteRemote: deleteRemote,
            importGPGKey: importGPGKey,
        };
    }
])

.directive("editRemote", [
    "$q",
    "remoteActions",
    function($q, remoteActions) {
        return {
            restrict: "E",
            scope: {
                remote: '=remote'
            },
            link: function($scope, element, attrs) {
                $scope.fields = null;
                $scope.showGpgData = false;
                $scope.modalGroupButtonSel = ".group-buttons";
                $scope.modalGroupErrorAfter = true;

                remoteActions.loadRemoteSettings($scope.remote)
                    .then(function (fields) {
                        var verify = fields['gpg-verify'] ? fields['gpg-verify'].toLowerCase() : "";
                        $scope.fields = fields;
                        $scope.fields.gpgVerify = verify == 'true' || verify == '1';
                        $scope.$applyAsync();
                    }, function (ex) {
                        $scope.failure(cockpit.format(_("Couldn't load settings for '$0': $1"),
                                       $scope.remote, cockpit.message(ex)));
                    });

                $scope.cancel = function () {
                    $scope.$emit("formFinished");
                };

                $scope.result = function (success, result) {
                    $scope.$emit("formFinished", success);
                };

                $scope.update = function() {
                    if (!$scope.fields)
                        return;

                    $scope.$emit("formRunning");

                    /* Currently we only touch the gpgVerify field */
                    var verify = !!$scope.fields.gpgVerify;
                    var p = $q.when([]);
                    if (verify && $scope.fields.gpgData) {
                        p = $q.when(remoteActions.importGPGKey($scope.remote,
                                                               $scope.fields.gpgData));
                    }

                    return p.then(function () {
                        return remoteActions.updateRemoteSettings($scope.remote,
                                                                  { "gpg-verify": verify });
                    });
                };

                $scope.delete = function() {
                    $scope.$emit("formRunning");
                    return remoteActions.deleteRemote($scope.remote);
                };

                $scope.toggleGpgData = function() {
                    if (!$scope.fields)
                        return;

                    $scope.showGpgData = !$scope.showGpgData;
                    if ($scope.showGpgData)
                        $scope.fields.gpgVerify = true;
                };
            },
            templateUrl: "edit-remote.html"
        };
    }
])

.directive("addRemote", [
    "$q",
    "remoteActions",
    function($q, remoteActions) {
        return {
            restrict: "E",
            scope: true,
            link: function($scope, element, attrs) {
                $scope.fields = {};
                $scope.modalGroupButtonSel = ".group-buttons";
                $scope.modalGroupErrorAfter = true;

                function validate(fields) {
                    var errors = [];
                    var ex;
                    var name_re = /^[a-z0-9_\.\-]+$/i;
                    var space_re = /\s/;

                    $scope.fields.name = $scope.fields.name ? $scope.fields.name.trim() : null;
                    $scope.fields.url = $scope.fields.url ? $scope.fields.url.trim() : null;

                    if (!$scope.fields.name || !name_re.test($scope.fields.name.toLowerCase())) {
                        ex = new Error(_("Please provide a valid name"));
                        ex.target = "#remote-name";
                        errors.push(ex);
                        ex = null;
                    }

                    if (!$scope.fields.url || space_re.test($scope.fields.url)) {
                        ex = new Error(_("Please provide a valid URL"));
                        ex.target = "#remote-url";
                        errors.push(ex);
                        ex = null;
                    }

                    if (errors.length > 0)
                        return $q.reject(errors);

                    return $q.when({
                        name: $scope.fields.name,
                        url: $scope.fields.url,
                        verify: !!$scope.fields['gpgVerify']
                    });
                }

                $scope.add = function add(cluster) {
                    $scope.$emit("formRunning");
                    return validate().then(function(data) {
                        return remoteActions.addRemote(data.name,
                                                       data.url,
                                                       data.verify);
                    });
                };

                $scope.cancel = function () {
                    $scope.$emit("formFinished");
                };

                $scope.result = function (success, result) {
                    $scope.$emit("formFinished", success);
                };
            },
            templateUrl: "add-remote.html"
        };
    }
])

.controller("ChangeRepositoryCtrl", [
    "$q",
    "$scope",
    "$modalInstance",
    "dialogData",
    "remoteActions",
    function($q, $scope, instance, dialogData, remoteActions) {
        angular.extend($scope, dialogData);

        $scope.loading = true;
        $scope.loading_error = null;
        $scope.adding = false;
        $scope.editing = null;
        $scope.running = false;

        function refreshRemotes() {
            var tmp = $scope.remote;
            $scope.loading = true;
            $scope.remote = null;
            remoteActions.listRemotes()
                .done(function (l) {
                    $scope.remotes = l;
                    if (tmp && l && l.indexOf(tmp) > -1)
                        $scope.remote = tmp;
                })
                .fail(function (ex) {
                    console.warn(ex);
                    $scope.remote = null;
                    $scope.loading_error = cockpit.format(_("Error loading remotes: $0"), cockpit.message(ex));
                })
                .always(function () {
                    $scope.loading = false;
                    $scope.$applyAsync();
                });
        }

        $scope.$on("formRunning", function (ev) {
            $scope.running = true;
        });

        $scope.$on("formFinished", function (ev, success) {
            $scope.running = false;
            if (success) {
                $scope.adding = false;
                $scope.editing = false;
                refreshRemotes();
            }
        });

        $scope.toggleEdit = function (remote, $event) {
            $event.stopPropagation();
            $event.preventDefault();

            if ($scope.running)
                return;

            $scope.editing = remote;
            $scope.adding = false;

        };

        $scope.toggleSelected = function (remote) {
            if ($scope.running)
                return;

            $scope.adding = false;
            $scope.remote = remote;
            if ($scope.editing != remote)
                $scope.editing = null;
        };

        $scope.openAdd = function () {
            if ($scope.running)
                return;

            $scope.adding = true;
            $scope.editing = null;
        };

        $scope.canSubmit = function () {
            return $scope.remote && !$scope.editing && !$scope.adding;
        };

        $scope.update = function () {
            var result = {
                "remote": $scope.remote,
                "branch": $scope.branch,
                "branches": {
                    "remote": $scope.remote
                }
            };

            return remoteActions.listBranches(result.remote)
                .then(function (data) {
                    result.branches.list = data;
                    // Current branch doesn't exist change
                    // to the first listed branch
                    if (data.indexOf(result.branch) < 0)
                        result.branch = data[0];
                }, function (ex) {
                    // Can't list branches use default branch
                    result.branches.error = cockpit.message(ex);
                    result.branch = null;
                })
                .then(function () {
                    return client.cache_update_for($scope.os, result.remote,
                                                   result.branch)
                                .then(function () {
                                    return result;
                                }, function () {
                                    return result;
                                });
                });
        };

        refreshRemotes();
    }
]);
