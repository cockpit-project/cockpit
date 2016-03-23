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

    angular.module('registry.projects', [
        'ngRoute',
        'ui.cockpit',
        'kubeClient',
        'kubernetes.listing',
        'registry.policy',
    ])

    .config(['$routeProvider',
        function($routeProvider) {
            $routeProvider
                .when('/projects/:namespace?', {
                    controller: 'ProjectsCtrl',
                    templateUrl: function(params) {
                        if (!params['namespace'])
                            return 'views/projects-page.html';
                        else
                            return 'views/project-page.html';
                    }
                });
        }
    ])

    .controller('ProjectsCtrl', [
        '$scope',
        '$routeParams',
        '$location',
        'kubeSelect',
        'kubeLoader',
        'projectData',
        'projectActions',
        'ListingState',
        function($scope, $routeParams, $location, select, loader, projectData, projectAction, ListingState) {
            loader.watch("users");
            loader.watch("groups");
            loader.watch("policybindings");

            var namespace = $routeParams["namespace"] || "";
            if (namespace) {
                $scope.listing = new ListingState($scope);

                $scope.project = function() {
                    return select().kind("Project").name(namespace).one();
                };

            } else {

                $scope.listing = new ListingState($scope);

                $scope.projects = function() {
                    return select().kind("Project");
                };

                $scope.$on("activate", function(ev, id) {
                    if (!$scope.listing.expandable) {
                        ev.preventDefault();
                        $location.path('/projects/' + id);
                    }
                });
            }

            angular.extend($scope, projectData);
            angular.extend($scope, projectAction);

            $scope.users = function() {
                return select().kind("User");
            };

            $scope.groups = function() {
                return select().kind("Group");
            };
        }
    ])

    .factory("projectData", [
        'kubeSelect',
        'kubeLoader',
        'projectPolicy',
        function(select, loader, policy) {

            /*
             * To use this you would have a user or group, and do:
             *
             * rolebindings = select().kind("RoleBindings").containsSubject(user_name);
             * rolebindings = select().kind("RoleBindings").containsSubject(user_object);
             * rolebindings = select().kind("RoleBindings").containsSubject(group_object);
             */
            select.register({
                name: "containsSubject",
                digests: function(arg) {
                    var meta, i, len, subjects, ret = [];
                    if (typeof arg == "string") {
                        ret.push(arg);
                    } else if (arg.kind == "User" || arg.kind == "Group") {
                        meta = arg.metadata || { };
                        ret.push(meta.name + ":" + arg.kind);
                    } else if (arg.kind == "RoleBinding") {
                        subjects = arg.subjects || [];
                        for (i = 0, len = subjects.length; i < len; i++) {
                            ret.push(subjects[i].name);
                            ret.push(subjects[i].name + ":" + subjects[i].kind);
                        }
                    }
                    return ret;
                }
            });

            function subjectRoleBindings(subject, namespace) {
                return select().kind("RoleBinding").namespace(namespace).containsSubject(subject);
            }

            function subjectIsMember(subject, namespace) {
                return subjectRoleBindings(subject, namespace).one() ? true : false;
            }

            function formatMembers(members, kind) {
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

            return {
                subjectRoleBindings: subjectRoleBindings,
                subjectIsMember: subjectIsMember,
                formatMembers: formatMembers,
            };
        }
    ])

    .directive('projectPanel', [
        'kubeLoader',
        'kubeSelect',
        function(loader, select) {
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

                    var currProject = scope.id;
                    loader.load("Project", null, null);
                    scope.project = function() {
                        return select().kind("Project").name(currProject).one();
                    };

                },
                templateUrl: "views/project-panel.html"
            };
        }
    ])

    .directive('projectBody',
        function() {
            return {
                restrict: 'A',
                templateUrl: 'views/project-body.html'
            };
        }
    )

    .directive('projectListing',
        function() {
            return {
                restrict: 'A',
                templateUrl: 'views/project-listing.html'
            };
        }
    )

    .factory('projectActions', [
        '$modal',
        function($modal) {
            function createProject() {
                return $modal.open({
                    controller: 'ProjectModifyCtrl',
                    templateUrl: 'views/project-modify.html',
                    resolve: {
                        dialogData: function() {
                            return { };
                        }
                    },
                }).result;
            }

            function modifyProject(project) {
                return $modal.open({
                    animation: false,
                    controller: 'ProjectModifyCtrl',
                    templateUrl: 'views/project-modify.html',
                    resolve: {
                        dialogData: function() {
                            return { project: project };
                        }
                    },
                }).result;
            }

            function createUser() {
                return $modal.open({
                    controller: 'UserNewCtrl',
                    templateUrl: 'views/add-user-dialog.html',
                });
            }
            function createGroup() {
                return $modal.open({
                    controller: 'GroupNewCtrl',
                    templateUrl: 'views/add-group-dialog.html',
                });
            }
            return {
                createProject: createProject,
                modifyProject: modifyProject,
                createGroup: createGroup,
                createUser: createUser,
            };
        }
    ])

    .controller('ProjectModifyCtrl', [
        '$q',
        '$scope',
        "dialogData",
        "kubeMethods",
        function($q, $scope, dialogData, methods) {
            var project = dialogData.project || { };
            var meta = project.metadata || { };
            var annotations = meta.annotations || { };

            var DISPLAY = "openshift.io/display-name";
            var DESCRIPTION = "openshift.io/description";

            var fields = {
                name: meta.name || "",
                display: annotations[DISPLAY] || "",
                description: annotations[DESCRIPTION] || "",
            };

            $scope.fields = fields;

            $scope.performCreate = function performCreate() {
                var defer;

                var request = {
                    kind: "ProjectRequest",
                    apiVersion:"v1",
                    metadata:{ name: fields.name.trim(), },
                    displayName: fields.display.trim(),
                    description: fields.description.trim()
                };

                return methods.check(request, { "metadata.name": "#project-new-name" })
                    .then(function() {
                        return methods.create(request);
                    });
            };

            $scope.performModify = function performModify() {
                var anno = { };
                var data = { metadata: { annotations: anno } };

                var value = fields.display.trim();
                if (value !== annotations[DISPLAY])
                    anno[DISPLAY] = value;
                value = fields.description.trim();
                if (value !== annotations[DESCRIPTION])
                    anno[DESCRIPTION] = value;

                return methods.check(data, { })
                    .then(function() {
                        return methods.patch(project, data);
                    });
            };

            angular.extend($scope, dialogData);
        }
    ])

    .controller('UserNewCtrl', [
        '$q',
        '$scope',
        "kubeMethods",
        function($q, $scope, methods) {
            var fields = {
                name: "",
                identities: ""
            };

            $scope.fields = fields;

            $scope.performCreate = function performCreate() {
                var defer;
                var identities = [];
                if (fields.identities.trim() !== "")
                    identities = [fields.identities.trim()];

                var user = {
                    "kind": "User",
                    "apiVersion": "v1",
                    "metadata": {
                        "name": fields.name.trim()
                    },
                    "identities": identities
                };

                return methods.check(user, { "metadata.name": "#user_name" })
                    .then(function() {
                        return methods.create(user);
                    });
            };
        }
    ])

    .controller('GroupNewCtrl', [
        '$q',
        '$scope',
        "kubeMethods",
        function($q, $scope, methods) {
            var fields = {
                name: ""
            };

            $scope.fields = fields;

            $scope.performCreate = function performCreate() {
                var defer;

                var group = {
                    "kind": "Group",
                    "apiVersion": "v1",
                    "metadata": {
                        "name": fields.name.trim()
                    }
                };

                return methods.check(group, { "metadata.name": "#group_name" })
                    .then(function() {
                        return methods.create(group);
                    });
            };
        }
    ]);
}());
