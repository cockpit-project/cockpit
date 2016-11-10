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
    require('angular-route');

    require('./dialog');
    require('./kube-client');
    require('./listing');
    require('./policy');

    require('../views/projects-page.html');
    require('../views/project-page.html');
    require('../views/user-page.html');
    require('../views/group-page.html');
    require('../views/project-panel.html');
    require('../views/project-body.html');
    require('../views/user-body.html');
    require('../views/group-panel.html');
    require('../views/user-panel.html');
    require('../views/project-listing.html');
    require('../views/project-modify.html');
    require('../views/project-modify.html');
    require('../views/project-delete.html');
    require('../views/add-group-dialog.html');
    require('../views/user-group-add.html');
    require('../views/user-group-remove.html');
    require('../views/group-delete.html');
    require('../views/add-user-dialog.html');
    require('../views/user-modify.html');
    require('../views/user-add-membership.html');
    require('../views/user-remove-membership.html');
    require('../views/user-delete.html');
    require('../views/add-member-role-dialog.html');
    require('../views/remove-role-dialog.html');
    require('../views/add-role-dialog.html');

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
                })
                .when('/users/:user', {
                    controller: 'UserCtrl',
                    templateUrl: function(params) {
                        return 'views/user-page.html';
                    }
                })
                .when('/groups/:group', {
                    controller: 'GroupCtrl',
                    templateUrl: function(params) {
                        return 'views/group-page.html';
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
            loader.watch("users", $scope);
            loader.watch("groups", $scope);
            loader.watch("policybindings", $scope);
            var namespace = $routeParams["namespace"] || "";
            $scope.projName = namespace;
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
            }
            $scope.$on("activate", function(ev, id) {
                ev.preventDefault();
                $location.path(id);
            });
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

    .controller('UserCtrl', [
        '$scope',
        '$routeParams',
        '$location',
        'kubeSelect',
        'kubeLoader',
        'projectData',
        'projectActions',
        'roleActions',
        'ListingState',
        function($scope, $routeParams, $location, select, loader, projectData, projectAction, roleActions, ListingState) {
            loader.watch("users", $scope);
            loader.watch("groups", $scope);
            var user = $routeParams["user"] || "";
            $scope.userName = user;
            if (user) {
                $scope.user = function() {
                    return select().kind("User").name(user).one();
                };
                $scope.listing = new ListingState($scope);
                $scope.$on("activate", function(ev, id) {
                    ev.preventDefault();
                    $location.path(id);
                });
            } else {
                $scope.listing = new ListingState($scope);
                $location.path("/projects");
            }
            $scope.projects = function() {
                return select().kind("Project");
            };
            $scope.groups = function() {
                return select().kind("Group");
            };
            $scope.users = function() {
                return select().kind("User");
            };
            angular.extend($scope, projectData);
            angular.extend($scope, projectAction);
            angular.extend($scope, roleActions);
        }
    ])

    .controller('GroupCtrl', [
        '$scope',
        '$routeParams',
        '$location',
        'kubeSelect',
        'kubeLoader',
        'projectData',
        'projectActions',
        'roleActions',
        'ListingState',
        function($scope, $routeParams, $location, select, loader, projectData, projectAction, roleActions, ListingState) {
            loader.watch("users", $scope);
            loader.watch("groups", $scope);
            var group = $routeParams["group"] || "";
            $scope.groupName = group;
            if (group) {
                var groupObj = select().kind("Group").name(group);
                if (!groupObj || groupObj.length < 1) {
                     $scope.group = null;
                    return;
                }
                $scope.group = function() {
                    return select().kind("Group").name(group).one();
                };
                $scope.listing = new ListingState($scope);
                $scope.$on("activate", function(ev, id) {
                    ev.preventDefault();
                    $location.path(id);
                });

            } else {
                $scope.listing = new ListingState($scope);
                $location.path("/projects");
            }
            $scope.projects = function() {
                return select().kind("Project");
            };
            $scope.groups = function() {
                return select().kind("Group");
            };
            $scope.users = function() {
                return select().kind("User");
            };
            angular.extend($scope, projectData);
            angular.extend($scope, projectAction);
            angular.extend($scope, roleActions);
        }
    ])

    .factory("projectData", [
        '$q',
        'kubeSelect',
        'kubeLoader',
        'projectPolicy',
        function($q, select, loader, policy) {
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
                    if (registryRoles[i].ocRole === ocRole) {
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
                        if (roles.indexOf(getDisplayRole(meta.name) === -1))
                            roles.push(getDisplayRole(meta.name));
                    }
                });
                return roles;
            }
            function isRegistryRole(member, displayRole, project) {
                var oc_roles = getRegistryRoles(member, project);
                if (oc_roles.indexOf(displayRole) !== -1) {
                    return true;
                }
                return false;
            }
            function hasRegistryRole(member, project) {
                var oc_roles = getRegistryRoles(member, project);
                if (oc_roles.length === 0) {
                    return false;
                }
                return true;
            }
            function isRoles(member, namespace) {
                var oc_roles = getAllRoles(member, namespace);
                if (oc_roles.length === 0) {
                    return false;
                }
                return true;
            }
            function getProjectsWithMember(projects, member) {
                if (!projects && !member)
                    return [];
                var projList = [];
                if (member) {
                    angular.forEach(projects, function(project) {
                        if (project && subjectIsMember(member, project.metadata.name))
                            projList.push(project);
                    });
                }
                return projList;
            }

            function getGroupsWithMember(groups, member) {
                if (!groups && !member)
                    return [];
                var grpList = [];
                if (member) {
                    angular.forEach(groups, function(group) {
                        if (group && group.users && group.users.indexOf(member) != -1)
                            grpList.push(group);
                    });
                }
                return grpList;
            }
            function getMembershipOfUser(projects, groups, user) {
                var members = [];
                var userProjects = getProjectsWithMember(projects, user);
                angular.forEach(userProjects, function(project) {
                    members.push(project.metadata.name);
                });
                var userGroups = getGroupsWithMember(groups, user);
                angular.forEach(userGroups, function(group) {
                    members.push(group.metadata.name);
                });
                return members;
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
                if (!subject || !namespace)
                    return null;
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
            var sharedRole = "registry-viewer";
            var sharedKind = "Group";
            var anonymousGroup = "system:unauthenticated";
            var sharedGroup = "system:authenticated";
            var registryAdmin = "registry-admin";

            function shareImages(project, accessPolicy) {
                var anonSubject = {
                    kind: sharedKind,
                    name: anonymousGroup,
                };
                var sharedSubject = {
                    kind: sharedKind,
                    name: sharedGroup,
                };
                if (accessPolicy === "anonymous") {
                    return policy.addToRole(project, sharedRole, anonSubject);
                } else if (accessPolicy === "shared") {
                    return policy.removeFromRole(project, sharedRole, anonSubject)
                        .then(function() {
                            return policy.addToRole(project, sharedRole, sharedSubject);
                        });
                } else {
                    return policy.removeFromRole(project, sharedRole, anonSubject)
                        .then(function() {
                            return policy.removeFromRole(project, sharedRole, sharedSubject);
                        });
                }
            }

            function sharedImages(project) {
                if (!project)
                    return null;

                var response = policy.whoCan(project, sharedVerb, sharedResource);
                if (!response)
                    return null;

                var projState = {};
                projState[anonymousGroup] = null;
                projState[sharedGroup] = null;

                var i, len, groups = response.groups || [];
                for (i = 0, len = groups.length; i < len; i++) {
                    if (projState.hasOwnProperty(groups[i]))
                        projState[groups[i]] = true;
                }

                if (projState[anonymousGroup])
                    return "anonymous";
                else if (projState[sharedGroup])
                    return "shared";
                return "private";
            }

            function makeRegistryAdmin(project, currentUser) {
                var subject = {
                    kind: 'User',
                    name: toName(currentUser),
                };
                //if system:admin then return
                if (currentUser && currentUser.groups &&
                    currentUser.groups.indexOf("system:cluster-admins") !== -1) {
                    return $q.when({ });
                }
                var oc_roles = getRegistryRoles(currentUser, project);
                if (oc_roles.indexOf(registryAdmin) !== -1) {
                    //for templates with registryAdmin
                    //if registryAdmin role exists then return
                    return $q.when({ });
                }
                return policy.addToRole(project, registryAdmin, subject);
            }

            function isSameUser(currUser, userName) {
                return currUser ? toName(currUser) === toName(userName) : false;
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
                getGroupsWithMember: getGroupsWithMember,
                getProjectsWithMember: getProjectsWithMember,
                getMembershipOfUser: getMembershipOfUser,
                isSameUser: isSameUser,
                makeRegistryAdmin: makeRegistryAdmin,
                hasRegistryRole: hasRegistryRole,
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

    .directive('userBody', [
        function() {
            return {
                restrict: 'A',
                templateUrl: 'views/user-body.html',
                link: function(scope, element, attrs) {
                },
            };
        }
    ])

    .directive('groupPanel', [
        'kubeLoader',
        'kubeSelect',
        'projectData',
        function(loader, select, projectData) {
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

                    var currGroup = scope.id;
                    loader.load("Groups");
                    scope.group = function() {
                        return select().kind("Group").name(currGroup).one();
                    };
                    scope.projects = function() {
                        return select().kind("Project");
                    };
                    angular.extend(scope, projectData);
                },
                templateUrl: "views/group-panel.html"
            };
        }
    ])

    .directive('userPanel', [
        'kubeLoader',
        'kubeSelect',
        'projectData',
        'projectActions',
        function(loader, select, projectData, projectAction) {
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

                    var currUser = scope.id;
                    loader.load("Users");
                    angular.extend(scope, projectData);
                    angular.extend(scope, projectAction);
                    scope.user = function() {
                        return select().kind("User").name(currUser).one();
                    };
                    scope.groups = function() {
                        return select().kind("Group");
                    };
                    scope.projects = function() {
                        return select().kind("Project");
                    };

                },
                templateUrl: "views/user-panel.html"
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
        'projectData',
        function($modal, projectData) {
            function createProject(currentUser) {
                return $modal.open({
                    controller: 'ProjectModifyCtrl',
                    templateUrl: 'views/project-modify.html',
                    resolve: {
                        dialogData: function() {
                            return { currUser: currentUser };
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
            function removeProject(project) {
                return $modal.open({
                    animation: false,
                    controller: 'ProjectModifyCtrl',
                    templateUrl: 'views/project-delete.html',
                    resolve: {
                        dialogData: function() {
                            return { project: project };
                        }
                    },
                }).result;
            }
            function createGroup() {
                return $modal.open({
                    controller: 'GroupNewCtrl',
                    templateUrl: 'views/add-group-dialog.html',
                });
            }
            function addUserToGroup(groupObj) {
                return $modal.open({
                    controller: 'GroupChangeCtrl',
                    templateUrl: 'views/user-group-add.html',
                    resolve:{
                        fields: function() {
                            return { group: groupObj };
                        }
                    }
                });
            }
            function removeUserFromGroup(user, groupObj) {
                return $modal.open({
                    controller: 'GroupChangeCtrl',
                    templateUrl: 'views/user-group-remove.html',
                    resolve:{
                        fields: function() {
                            return { group: groupObj, user: user };
                        }
                    }
                });
            }
            function removeGroup(projects, groupObj) {
                return $modal.open({
                    controller: 'GroupChangeCtrl',
                    templateUrl: 'views/group-delete.html',
                    resolve:{
                        fields: function() {
                            var members = projectData.getProjectsWithMember(projects, groupObj.metadata.name);
                            return { group: groupObj, projects: projects , members: members };
                        }
                    }
                });
            }
            function createUser() {
                return $modal.open({
                    controller: 'UserNewCtrl',
                    templateUrl: 'views/add-user-dialog.html',
                });
            }
            function modifyUser(userObj) {
                return $modal.open({
                    animation: false,
                    controller: 'UserChangeCtrl',
                    templateUrl: 'views/user-modify.html',
                    resolve: {
                        fields: function() {
                            return { user: userObj };
                        }
                    },
                }).result;
            }
            function addMemberToParent(memberObj) {
                return $modal.open({
                    controller: 'UserChangeCtrl',
                    templateUrl: 'views/user-add-membership.html',
                    resolve:{
                        fields: function() {
                            return { memberObj: memberObj };
                        }
                    }
                });
            }
            function removeMemberFromParent(memberObj, parentObj) {
                return $modal.open({
                    controller: 'UserChangeCtrl',
                    templateUrl: 'views/user-remove-membership.html',
                    resolve:{
                        fields: function() {
                            return { parentObj: parentObj, memberObj: memberObj };
                        }
                    }
                });
            }
            function removeUser(projects, groups, userObj) {
                return $modal.open({
                    controller: 'UserChangeCtrl',
                    templateUrl: 'views/user-delete.html',
                    resolve:{
                        fields: function() {
                            var members = projectData.getMembershipOfUser(projects, groups, userObj.metadata.name);
                            return { user: userObj, projects: projects, groups: groups ,
                                members: members };
                        }
                    }
                });
            }
            return {
                createProject: createProject,
                modifyProject: modifyProject,
                createGroup: createGroup,
                createUser: createUser,
                removeProject: removeProject,
                removeUser: removeUser,
                modifyUser: modifyUser,
                addMemberToParent: addMemberToParent,
                removeMemberFromParent: removeMemberFromParent,
                removeGroup: removeGroup,
                addUserToGroup: addUserToGroup,
                removeUserFromGroup: removeUserFromGroup,
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
                        fields: function(){
                            return { namespace: toName(project) };
                        }
                    },
                });
            }
            function changeRole(member, roleMp, roles, project) {
                return $modal.open({
                    controller: 'ChangeRoleCtrl',
                    templateUrl: function() {
                        if (roles.indexOf(roleMp.displayRole) >= 0) {
                            return 'views/remove-role-dialog.html';
                        } else {
                            return 'views/add-role-dialog.html';
                        }
                    },
                    resolve: {
                        fields: function(){
                            return { member: member, ocRole: roleMp.ocRole,
                                displayRole: roleMp.displayRole, roles: roles,
                                namespace: toName(project) };
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
            $scope.selected = {
                member: selectMember,
                members: getAllMembers(),
                displayRole: selectRole,
                roles: projectData.getRegistryRolesMap(),
                kind: "",
                ocRole: "",
            };
            $scope.itemTracker= function(item) {
              return item.kind + "/" + item.name;
            };
            var namespace = fields.namespace;

            function getAllMembers() {
                var users = kselect().kind("User");
                var groups = kselect().kind("Group");
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

                    if (ex) {
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
                var role = $scope.selected.ocRole;
                var memberName = $scope.selected.memberName;
                var member = $scope.selected.member;
                var memberObj, kind;
                if (memberName && memberName === member) {
                    //dropdown value selected
                    memberObj = $scope.selected.memberObj;
                    memberName = memberObj.name;
                    kind = memberObj.kind;
                } else if (memberName && member === selectMember) {
                    //input field has value
                    kind = "User";
                } else if (!memberName && member === selectMember) {
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
        'kubeSelect',
        "dialogData",
        "projectData",
        '$location',
        '$timeout',
        "kubeMethods",
        function($q, $scope, kselect, dialogData, projectData, $location, $timeout, methods) {
            var project = dialogData.project || { };
            var meta = project.metadata || { };
            var annotations = meta.annotations || { };

            var DISPLAY = "openshift.io/display-name";
            var DESCRIPTION = "openshift.io/description";

            var fields = {
                name: meta.name || "",
                display: annotations[DISPLAY] || "",
                description: annotations[DESCRIPTION] || "",
                access: null,
            };

            /*
             * This data may not be available yet, so continue to ask until it is.
             * The called function takes care of not making duplicate requests.
             */
            var timr;
            function updateShared() {
                timr = null;
                if (fields.access === null)
                    fields.access = projectData.sharedImages(meta.name);
                if (fields.access === null)
                    timr = $timeout(updateShared, 500);
            }
            updateShared();
            $scope.$on("$destroy", function() {
                if (timr !== null)
                    $timeout.cancel(timr);
            });

            angular.extend($scope, projectData);
            $scope.fields = fields;
            $scope.labels = {
                access: {
                    "private": "Private: Allow only specific users or groups to pull images",
                    "shared": "Shared: Allow any authenticated user to pull images",
                    "anonymous" : "Anonymous: Allow all unauthenticated users to pull images",
                }
            };
            function getProjects() {
                return kselect().kind("Project");
            }
            function getGroups() {
                return kselect().kind("Group");
            }
            $scope.performDelete = function performDelete(project) {
                var promise = methods.delete(project)
                    .then(function() {
                        $location.path("/projects");
                    }, function(ex) {
                        return $q.reject(ex);
                    });

                return promise;
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
                        return methods.create(request);
                    })
                    .then(function(){
                        return projectData.shareImages(name, fields.access);
                    })
                    .then(function(){
                        return projectData.makeRegistryAdmin(name, dialogData.currUser);
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
                            projectData.shareImages(project, fields.access)
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

    .factory('memberActions', [
        "kubeMethods",
        function(methods) {
            function removeUserFromGroup(user, group) {
                var userName = toName(user);
                var users = group.users || [];
                var index = users.indexOf(userName);
                if (index >= 0)
                    users.splice(index, 1);
                var patchData = { "users": users };
                return methods.patch(group, patchData);
            }
            function addUserToGroup(user, group) {
                var userName = toName(user);
                var users = group.users || [];
                var index = users.indexOf(userName);
                if (index == -1)
                    users.push(userName);
                var patchData = { "users": users };
                return methods.patch(group, patchData);
            }
            return {
                removeUserFromGroup: removeUserFromGroup,
                addUserToGroup: addUserToGroup,
            };
        }
    ])

    .controller('UserChangeCtrl', [
        '$q',
        '$scope',
        'kubeSelect',
        'kubeLoader',
        "kubeMethods",
        'projectData',
        'projectPolicy',
        '$location',
        'memberActions',
        "fields",
        function($q, $scope, kselect, loader, methods, projectData, projectPolicy, $location, memberActions, fields) {
            function getPolicyBinding(namespace){
                return kselect().kind("PolicyBinding").namespace(namespace).name(":default");
            }
            function getMembers() {
                var members = [];
                var groups = getGroups();
                var projects = getProjects();
                angular.forEach(groups, function(group) {
                    members.push(group);
                });
                angular.forEach(projects, function(project) {
                    members.push(project);
                });
                return members;
            }
            function getProjects() {
                return kselect().kind("Project");
            }
            function getGroups() {
                return kselect().kind("Group");
            }
            $scope.itemTracker= function(item) {
              return item.kind + "/" + item.metadata.name;
            };
            $scope.selected = {
                member: 'Select Member',
                members: getMembers,
                roles: projectData.getRegistryRolesMap,
                role: 'Select Role',
            };
            angular.extend($scope, projectData);
            $scope.fields = fields;
            if (fields.user && fields.user.identities)
                $scope.fields.identities = fields.user.identities.toString();
            else
                $scope.fields.identities = '';

            $scope.performModify = function performModify() {
                var identities = [];
                var user = $scope.fields.user;
                var data = {"identities": identities };

                if (fields.identities.trim() !== "") {
                    var idList = fields.identities.trim().split(",");
                    identities.push.apply(identities, idList);
                }

                return methods.check(data, { })
                    .then(function() {
                        return $q.all([
                            methods.patch(user, data),
                        ]);
                    });
            };

            $scope.performDelete = function performDelete(user) {
                var chain = $q.when();
                var fail = false;

                chain = removeMemberFromParents(user);
                var promise = chain.then(function() {
                        $location.path("/projects");
                    }, function(ex) {
                        if (ex.code === 404) {
                            loader.handle(user, true, "User");
                            $location.path("/projects");
                        } else {
                            return $q.reject(ex);
                        }
                });

                return promise;
            };
            function removeMemberFromParents(member) {
                var chain = $q.when();
                var policyBinding;
                var groups = projectData.getGroupsWithMember(getGroups(), member.metadata.name);
                angular.forEach(groups, function(g) {
                    chain = chain.then(function() {
                        return memberActions.removeUserFromGroup(member, g);
                    });
                });
                var projects = projectData.getProjectsWithMember(getProjects(), member.metadata.name);
                angular.forEach(projects, function(project) {
                    policyBinding = getPolicyBinding(project.metadata.name);
                    var subjectRoleBindings = projectData.subjectRoleBindings(member.metadata.name, project.metadata.name);
                    var subject = {
                        kind: member.kind,
                        name: member.metadata.name,
                    };
                    chain = chain.then(function() {
                        return projectPolicy.removeMemberFromPolicyBinding(policyBinding,
                            project.metadata.name, subjectRoleBindings, subject);
                    });
                });
                chain = chain.then(function() {
                    return methods.delete(member);
                });
                return chain;
            }

            $scope.addMemberToParent = function addMemberToParent() {
                var patchData;
                var users;
                var patchObj;
                if ($scope.selected.parentObj.kind === "Project") {
                    var project = $scope.selected.parentObj.metadata.name;
                    var policyBinding = getPolicyBinding(project);
                    var memberObj = $scope.fields.memberObj;
                    var role = $scope.selected.ocRole;
                    var subject = {
                        kind: memberObj.kind,
                        name: memberObj.metadata.name,
                    };
                    return projectPolicy.addToRole(project, role, subject);

                } else if ($scope.selected.parentObj.kind === "Group") {
                    return memberActions.addUserToGroup($scope.fields.memberObj, $scope.selected.parentObj);
                }
            };

            $scope.removeMemberFromParent = function removeMemberFromParent() {
                if ($scope.fields.parentObj.kind === "Group") {
                    return memberActions.removeUserFromGroup($scope.fields.memberObj, $scope.fields.parentObj);
                } else {
                    //Project
                    var member = $scope.fields.memberObj;
                    var project = $scope.fields.parentObj.metadata.name;
                    var policyBinding = getPolicyBinding(project);
                    var subjectRoleBindings = projectData.subjectRoleBindings(member.metadata.name, project);
                    var subject = {
                        kind: member.kind,
                        name: member.metadata.name,
                    };
                    return projectPolicy.removeMemberFromPolicyBinding(policyBinding, project, subjectRoleBindings, subject);
                }
            };

        }
    ])

    .controller('GroupChangeCtrl', [
        '$q',
        '$scope',
        'kubeSelect',
        "kubeMethods",
        'projectData',
        'memberActions',
        'projectPolicy',
        '$location',
        "fields",
        function($q, $scope, kselect, methods, projectData, memberActions, projectPolicy, $location, fields) {
            function getUsers() {
                return kselect().kind("User");
            }
            function getProjects() {
                return kselect().kind("Project");
            }
            function getPolicyBinding(namespace){
                return kselect().kind("PolicyBinding").namespace(namespace).name(":default");
            }
            $scope.select = {
                member: 'Select Member',
                members: getUsers(),
            };
            angular.extend($scope, projectData);
            $scope.fields = fields;
            $scope.fields.grpProjects = projectData.getProjectsWithMember(getProjects(), fields.group.metadata.name);
            function removeMemberFromParents(member) {
                var chain = $q.when();
                var policyBinding;
                var projects = projectData.getProjectsWithMember(getProjects(), member.metadata.name);
                angular.forEach(projects, function(project) {
                    policyBinding = getPolicyBinding(project.metadata.name);
                    var subjectRoleBindings = projectData.subjectRoleBindings(member.metadata.name, project.metadata.name);
                    var subject = {
                        kind: member.kind,
                        name: member.metadata.name,
                    };
                    chain = chain.then(function() {
                        return projectPolicy.removeMemberFromPolicyBinding(policyBinding,
                            project.metadata.name, subjectRoleBindings, subject);
                    });
                });
                chain = chain.then(function() {
                        return methods.delete(member);
                    });
                return chain;
            }
            $scope.performDelete = function performDelete(group) {
                var chain = $q.when();
                var fail = false;

                chain = removeMemberFromParents(group);
                var promise = chain.then(function() {
                        $location.path("/projects");
                    }, function(ex) {
                        if (ex.code === 404){
                            $location.path("/projects");
                        } else {
                            return $q.reject(ex);
                        }
                });

                return promise;
            };
            $scope.addUserToGroup = function addUserToGroup() {
                return memberActions.addUserToGroup($scope.select.member, $scope.fields.group);
            };
            $scope.removeUserFromGroup = function removeUserFromGroup() {
                return memberActions.removeUserFromGroup($scope.fields.user, $scope.fields.group);
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
