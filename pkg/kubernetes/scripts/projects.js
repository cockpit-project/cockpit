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

    function toName(object) {
        if (object && typeof object == "object")
            return object.metadata.name;
        else
            return object;
    }

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
        'roleActions',
        function($scope, $routeParams, $location, select, loader, projectData, projectAction, ListingState, roleAction) {
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
                    ev.preventDefault();
                    $location.path('/projects/' + id);
                });
            }

            angular.extend($scope, projectData);
            angular.extend($scope, roleAction);
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
            var registryRoles = [{ ocRole: "registry-admin", displayRole :"Admin"},
                { ocRole:"registry-editor", displayRole :"Push" },
                { ocRole:"registry-viewer", displayRole :"Pull" }];

            function getRegistryRolesMap() {
                return registryRoles;
            }
            function getDisplayRole(ocRole) {
                var i;
                var displayRole;
                for (i = registryRoles.length - 1; i >= 0; i--) {
                    if(registryRoles[i].ocRole === ocRole) {
                        displayRole = registryRoles[i].displayRole;
                        break;
                    }
                }
                return displayRole;
            }
            function getOcRolesList() {
                var ocRoles = [];
                angular.forEach(registryRoles, function(r) {
                    ocRoles.push(r.ocRole);
                });
                return ocRoles;
            }
            function getAllRoles(member, project) {
                if (!member && !project)
                    return [];
                var projectName = toName(project);
                var roleBinds = subjectRoleBindings(member, projectName);
                var roleBind, meta, ret = [];
                angular.forEach(roleBinds, function(roleBind) {
                    meta = roleBind.metadata || { };
                    if (meta.name)
                        ret.push(meta.name);
                });
                return ret;
            }
            function getRegistryRoles(member, project) {
                if (!member && !project)
                    return [];
                var projectName = toName(project);
                var roleBinds = subjectRoleBindings(member, projectName);
                var ocRegistryRoles = getOcRolesList();
                var roles = [];
                var roleBind, meta;
                angular.forEach(roleBinds, function(roleBind) {
                    meta = roleBind.metadata || { };
                    if (meta.name && ocRegistryRoles.indexOf(meta.name)!== -1) {
                        roles.push(getDisplayRole(meta.name));
                    }
                });
                return roles;
            }
            function isRegistryRole(member, displayRole, project) {
                var oc_roles = getRegistryRoles(member, project);
                if(oc_roles.indexOf(displayRole) !== -1) {
                    return true;
                }
                return false;
            }
            function isRoles(member, namespace) {
                var oc_roles = getAllRoles(member, namespace);
                if(oc_roles.length === 0) {
                    return false;
                }
                return true;
            }
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
                namespace = toName(namespace);
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

            var sharedVerb = "get";
            var sharedResource = "imagestreams/layers";
            var sharedRole = "system:image-puller";
            var sharedKind = "SystemGroup";
            var sharedSubject = "system:authenticated";

            function shareImages(project, shared) {
                var subject = {
                    kind: sharedKind,
                    name: sharedSubject,
                };
                if (shared)
                    return policy.addToRole(project, sharedRole, subject);
                else
                    return policy.removeFromRole(project, sharedRole, subject);
            }

            function sharedImages(project) {
                if (!project)
                    return null;

                var response = policy.whoCan(project, sharedVerb, sharedResource);
                if (!response)
                    return null;

                var i, len, groups = response.groups || [];
                for (i = 0, len = groups.length; i < len; i++) {
                    if (groups[i] == sharedSubject)
                        return true;
                }

                return false;
            }

            return {
                subjectRoleBindings: subjectRoleBindings,
                subjectIsMember: subjectIsMember,
                formatMembers: formatMembers,
                shareImages: shareImages,
                sharedImages: sharedImages,
                getAllRoles: getAllRoles,
                isRegistryRole: isRegistryRole,
                isRoles: isRoles,
                getRegistryRolesMap: getRegistryRolesMap,
                getRegistryRoles: getRegistryRoles,
            };
        }
    ])

    .directive('projectPanel', [
        'kubeLoader',
        'kubeSelect',
        'projectData',
        'roleActions',
        function(loader, select, projectData, roleActions) {
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
                    angular.extend(scope, projectData);
                    angular.extend(scope, roleActions);
                    loader.load("Project", null, currProject);
                    scope.project = function() {
                        return select().kind("Project").name(currProject).one();
                    };
                },
                templateUrl: "views/project-panel.html"
            };
        }
    ])

    .directive('projectBody', [
        'projectData',
        function(data) {
            return {
                restrict: 'A',
                templateUrl: 'views/project-body.html',
                link: function(scope, element, attrs) {
                    scope.sharedImages = data.sharedImages;
                },
            };
        }
    ])

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

    .factory('roleActions', [
        '$modal',
        function($modal) {
            function addMember(project) {
                return $modal.open({
                    controller: 'MemberNewCtrl',
                    templateUrl: 'views/add-member-role-dialog.html',
                    resolve: {
                        fields : function(){
                            var fields = {};
                            fields.namespace = toName(project);
                            return fields;
                        }
                    },
                });
            }
            function changeRole(member, roleMp, roles, project) {
                return $modal.open({
                    controller: 'ChangeRoleCtrl',
                    templateUrl: function() {
                        if(roles.indexOf(roleMp.displayRole) >= 0) {
                            return 'views/remove-role-dialog.html';
                        } else {
                            return 'views/add-role-dialog.html';
                        }
                    },
                    resolve: {
                        fields: function(){
                            var fields = {};
                            fields.member = member;
                            fields.ocRole = roleMp.ocRole;
                            fields.displayRole = roleMp.displayRole;
                            fields.roles = roles;
                            fields.namespace = toName(project);
                            return fields;
                        }
                    },
                });
            }
            return {
                addMember: addMember,
                changeRole: changeRole,
            };
        }
    ])

    .controller('ChangeRoleCtrl', [
        '$q',
        '$scope',
        'projectPolicy',
        'kubeLoader',
        'kubeSelect',
        'fields',
        function($q, $scope, projectPolicy, loader, kselect, fields) {
            $scope.fields = fields;
            var namespace = $scope.fields.namespace;

            $scope.performCreate = function performCreate() {
                var role = $scope.fields.ocRole;
                var memberObj = $scope.fields.member;
                var subject = {
                    kind: memberObj.kind,
                    name: memberObj.metadata.name,
                };
                return projectPolicy.addToRole(namespace, role, subject);
            };

            $scope.performRemove = function performRemove() {
                var role = $scope.fields.ocRole;
                var memberObj = $scope.fields.member;
                var subject = {
                    kind: memberObj.kind,
                    name: memberObj.metadata.name,
                };
                return projectPolicy.removeFromRole(namespace, role, subject);
            };
        }
    ])

    .controller('MemberNewCtrl', [
        '$q',
        '$scope',
        'projectData',
        'projectPolicy',
        'kubeSelect',
        'fields',
        function($q, $scope, projectData, projectPolicy, kselect, fields) {
            var selectMember = 'Select Member';
            var NAME_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
            var selectRole = 'Select Role';
            var registryRoles = [{ ocRole: "registry-admin", displayRole :"Admin"},
                { ocRole:"registry-editor", displayRole :"Push" },
                { ocRole:"registry-viewer", displayRole :"Pull" }];

            $scope.select = {
                member: selectMember,
                members: getAllMembers(fields.namespace),
                displayRole: selectRole,
                roles: registryRoles,
                kind: "",
                ocRole: "",
            };

            var namespace = fields.namespace;

            function getAllMembers() {
                var users = kselect().kind("User");
                var groups = kselect().kind("Groups");
                var members = [];
                angular.forEach(users, function(user) {
                    members.push({
                        kind: user.kind,
                        name: user.metadata.name,
                    });
                });
                angular.forEach(groups, function(group) {
                    members.push({
                        kind: group.kind,
                        name: group.metadata.name,
                    });
                });
                return members;
            }
            function validate(memberName, role) {
                var defer = $q.defer();
                var ex;
                if (memberName !== undefined) {
                    if (!memberName)
                        ex = new Error("The member name cannot be empty.");
                    else if (memberName === selectMember)
                        ex = new Error("Please select a valid Member.");
                    else if (!NAME_RE.test(memberName))
                        ex = new Error("The member name contains invalid characters.");

                    if(ex) {
                        ex.target = "#add_member_group";
                        defer.reject(ex);
                    }
                }
                if (!role || role === selectRole) {
                    ex = new Error("Please select a valid Role.");
                    ex.target = "#add_role";
                    defer.reject(ex);
                }

                if (!ex) {
                    defer.resolve();
                }

                return defer.promise;
            }
            $scope.performCreate = function performCreate() {
                var role = $scope.select.ocRole;
                var memberName = $scope.select.memberName;
                var member = $scope.select.member;
                var memberObj, kind;
                if (memberName && memberName === member) {
                    //dropdown value selected
                    memberObj = $scope.select.memberObj;
                    memberName = memberObj.name;
                    kind = memberObj.kind;
                } else if(memberName && member === selectMember) {
                    //input field has value
                    kind = "User";
                } else if(!memberName && member === selectMember) {
                    //nothing selected
                    memberName = selectMember;
                    kind = null;
                }

                return validate(memberName, role).then(function() {
                    var subject = {
                        kind: kind,
                        name: memberName,
                    };
                    return projectPolicy.addToRole(namespace, role, subject);
                });
            };
        }
    ])

    .controller('ProjectModifyCtrl', [
        '$q',
        '$scope',
        "dialogData",
        "projectData",
        "kubeMethods",
        function($q, $scope, dialogData, projectData, methods) {
            var project = dialogData.project || { };
            var meta = project.metadata || { };
            var annotations = meta.annotations || { };

            var DISPLAY = "openshift.io/display-name";
            var DESCRIPTION = "openshift.io/description";

            var shared = false;
            if (meta.name)
                shared = projectData.sharedImages(meta.name);

            var fields = {
                name: meta.name || "",
                display: annotations[DISPLAY] || "",
                description: annotations[DESCRIPTION] || "",
                access: shared ? "shared" : "private",
            };

            $scope.fields = fields;
            $scope.labels = {
                access: {
                    "private": "Only allow members to pull images",
                    "shared": "Allow non-members to pull images",
                }
            };

            $scope.performCreate = function performCreate() {
                var defer;

                var name = fields.name.trim();
                var request = {
                    kind: "ProjectRequest",
                    apiVersion:"v1",
                    metadata:{ name: name, },
                    displayName: fields.display.trim(),
                    description: fields.description.trim()
                };

                return methods.check(request, { "metadata.name": "#project-new-name" })
                    .then(function() {
                        return methods.create(request)
                            .then(function() {
                                return projectData.shareImages(name, fields.access === "shared");
                            });
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
                        return $q.all([
                            methods.patch(project, data),
                            projectData.shareImages(project, fields.access === "shared")
                        ]);
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
