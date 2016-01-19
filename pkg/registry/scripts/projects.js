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

    /* Move this elsewhere once we reuse it */
    var NAME_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

    angular.module('registry.projects', [
        'ngRoute',
        'kubeClient'
    ])

    .config(['$routeProvider',
        function($routeProvider) {
            $routeProvider.when('/projects/:namespace?', {
                templateUrl: 'views/projects-page.html',
                controller: 'ProjectsCtrl',
                reloadOnSearch: false,
            });
        }
    ])

    .factory("projectUtil", [
        function() {
            return {
                formatMembers: function (members, kind) {
                    var mlist = "";
                    var i;
                    if (!members || members.length === 0)
                        return mlist;
                    if (members.length <= 3) {
                        for (i = members.length - 1; i >= 0; i--) {
                            mlist += members[i] + ",";
                        }
                    } else {
                        if (kind === "Groups") {
                            mlist = members.length + " " + kind;
                        } else if (kind === "Users") {
                            mlist = members.length + " " + kind;
                        }
                    }
                    return mlist;
                }
            };
        }
    ])

    .controller('ProjectsCtrl', [
        '$scope',
        'kubeLoader',
        'kubeSelect',
        '$modal',
        'projectUtil',
        function($scope, loader, select, $modal, util) {
            loader.watch("users");
            loader.watch("groups");
            loader.load("Project", null, null);

            $scope.users = function() {
                return select().kind("User");
            };

            $scope.groups = function() {
                return select().kind("Group");
            };

            $scope.projects = function() {
                return select().kind("Project");
            };

            $scope.formatMembers = util.formatMembers;
        }
    ])

    .factory('projectActions', [
        '$modal',
        function($modal) {
            function createDialog() {
                return $modal.open({
                    controller: 'ProjectNewCtrl',
                    templateUrl: 'views/project-new-dialog.html',
                });
            }

            return {
                create: createDialog,
            };
        }
    ])

    .controller('ProjectNewCtrl', [
        '$q',
        '$scope',
        "kubeMethods",
        function($q, $scope, methods) {
            var fields = {
                name: "",
                display: "",
                description: ""
            };

            $scope.fields = fields;

            $scope.performCreate = function performCreate() {
                var defer, ex;

                var name = fields.name.trim();
                var display = fields.display.trim();
                var description = fields.description.trim();

                if (!NAME_RE.test(name)) {
                    console.log("name is", name, $scope);
                    ex = new Error("Invalid project name");
                    ex.target = "#project-new-name";
                    defer = $q.defer();
                    defer.reject(ex);
                    return defer.promise;
                }

                var project = {
                    kind: "Project",
                    apiVersion: "v1",
                    metadata: {
                        name: name,
                        annotations: {
                            "openshift.io/description": description,
                            "openshift.io/display-name": display,
                        }
                    }
                };

                return methods.create(project);
            };
        }
    ]);
}());
