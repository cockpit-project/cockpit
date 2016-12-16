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

    var angular = require('angular');
    require('./kube-client');

    angular.module('registry.policy', [
        'kubeClient',
    ])

    .factory("projectPolicy", [
        '$q',
        '$rootScope',
        'kubeLoader',
        'kubeMethods',
        function($q, $rootScope, loader, methods) {

            /*
             * Data loading hacks:
             *
             * We would like to watch rolebindings, but sadly that's not supported
             * by origin. So we have to watch policybindings and then infer the
             * rolebindings from there.
             *
             * In addition we would like to be able to load User and Group objects,
             * even if only for a certain project. However, non-cluster admins
             * fail to do this, so we simulate these objects from the role bindings.
             */
            loader.listen(function(present, removed) {
                var link, expire = { };
                for (link in removed) {
                    if (removed[link].kind == "PolicyBinding") {
                        update_rolebindings(removed[link].roleBindings, true);
                        expire[removed[link].metadata.namespace] = true;
                    }
                }
                for (link in present) {
                    if (present[link].kind == "PolicyBinding") {
                        update_rolebindings(present[link].roleBindings, false);
                        expire[present[link].metadata.namespace] = true;
                    } else if (present[link].kind == "RoleBinding") {
                        ensure_subjects(present[link].subjects || []);
                        expire[present[link].metadata.namespace] = true;
                    }
                }

                var namespace;
                for (namespace in expire)
                    expireWhoCan(namespace);
            });

            function update_rolebindings(bindings, removed) {
                angular.forEach(bindings || [], function(wrapper) {
                    loader.handle(wrapper.roleBinding, removed, "RoleBinding");
                });
            }

            function ensure_subjects(subjects) {
                angular.forEach(subjects, function(subject) {
                    var link = loader.resolve(subject.kind, subject.name, subject.namespace);
                    if (link in loader.objects)
                        return;

                    /* An interim object, until perhaps the real thing can be loaded */
                    var interim = { kind: subject.kind, apiVersion: "v1", metadata: { name: subject.name } };
                    if (subject.namespace)
                        interim.metadata.namespace = subject.namespace;
                    loader.handle(interim);
                });
            }

            /*
             * Cached localresourceaccessreviews responses, and expired data
             * Each one has a project key, containing an object with verb:resource keys.
             */
            var cached = { };
            var expired = { };

            function fillWhoCan(namespace, verb, resource, result) {
                var key = verb + ":" + resource;

                if (!(namespace in cached))
                    cached[namespace] = { };
                cached[namespace][key] = result;

                if (result) {
                    if (namespace in expired) {
                        delete expired[namespace][key];
                    }
                }

                $rootScope.$applyAsync();
            }

            function expireWhoCan(namespace) {
                if (namespace) {
                    expired[namespace] = angular.extend({ }, cached[namespace]);
                    delete cached[namespace];
                } else {
                    expired = cached;
                    cached = { };
                }

                $rootScope.$applyAsync();
            }

            function lookupWhoCan(namespace, verb, resource) {
                var key = verb + ":" + resource;

                var ask = true;
                var result = null;

                var data = cached[namespace];
                if (data) {
                    if (key in data) {
                        result = data[key];
                        ask = false;
                    }
                }

                if (!result) {
                    data = expired[namespace];
                    if (data) {
                        if (key in data)
                            result = data[key];
                    }
                }

                if (!ask)
                    return result;

                /* Perform a request */
                var request = {
                    kind: "LocalResourceAccessReview",
                    apiVersion: "v1",
                    namespace: "",
                    verb: verb,
                    resource: resource,
                    resourceName: "",
                    content: null
                };

                /* Fill in null info while looking up */
                fillWhoCan(namespace, verb, resource, null);

                var path = loader.resolve("localresourceaccessreviews", null, namespace);
                methods.post(path, request)
                    .then(function(response) {
                        fillWhoCan(namespace, verb, resource, response);
                    }, function(response) {
                        console.warn("failed to lookup access:", namespace, verb, resource + ":",
                                response.message || JSON.stringify(response));
                    });

                return result;
            }

            /*
             * HACK: There's no way to PATCH subjects in or out
             * of a role, so we have to use this race prone mechanism.
             */
            function modifyRole(namespace, role, callback) {
                var path = loader.resolve("RoleBinding", role, namespace);
                return loader.load(path)
                    .then(function(resource) {
                        callback(resource);
                        return methods.put(path, resource);
                    });
            }

            function createRole(namespace, role, subjects) {
                var name = toName(role);
                var binding = {
                    kind: "RoleBinding",
                    apiVersion: "v1",
                    metadata: {
                        name: name,
                        namespace: namespace,
                        creationTimestamp: null,
                    },
                    userNames: [],
                    groupNames: [],
                    subjects: [],
                    roleRef: {
                        name: role
                    }
                };
                addToArray(roleArray(binding, "subjects"), subjects);
                addToArray(roleArrayKind(binding, subjects.kind), subjects.name);
                return methods.create(binding, namespace);
            }

            function removeFromRole(project, role, subject) {
                var namespace = toName(project);
                return modifyRole(namespace, role, function(data) {
                    removeFromArray(roleArray(data, "subjects"), subject);
                    removeFromArray(roleArrayKind(data, subject.kind), subject.name);
                }).then(function() {
                    expireWhoCan(namespace);
                }, function(resp) {
                    /* If the role doesn't exist consider removed to work */
                    if (resp.code !== 404)
                        return $q.reject(resp);
                });
            }

            function removeMemberFromPolicyBinding(policyBinding, project, subjectRoleBindings, subject) {
                var registryRoles = ["registry-admin", "registry-edit", "registry-view"];
                var chain = $q.when();
                var defaultPolicybinding;
                var roleBindings = [];

                if(policyBinding && policyBinding.one()){
                    defaultPolicybinding = policyBinding.one();
                    roleBindings = defaultPolicybinding.roleBindings;
                }
                angular.forEach(subjectRoleBindings, function(o) {
                    angular.forEach(roleBindings, function(role) {
                        //Since we only added registry roles
                        //remove ONLY registry roles
                        if (( indexOf(registryRoles, role.name) !== -1) && role.name === o.metadata.name) {
                            chain = chain.then(function() {
                                return removeFromRole(project, role.name, subject);
                            });
                        }
                    });
                });
                return chain;
            }
            function indexOf(array, value) {
                var i, len;
                for (i = 0, len = array.length; i < len; i++) {
                    if (angular.equals(array[i], value))
                        return i;
                }
                return -1;
            }

            function addToArray(array, value) {
                var index = indexOf(array, value);
                if (index < 0)
                    array.push(value);
            }

            function removeFromArray(array, value) {
                var index = indexOf(array, value);
                if (index >= 0)
                    array.splice(index, 1);
            }

            function roleArray(data, field) {
                var array = data[field] || [];
                data[field] = array;
                return array;
            }

            function roleArrayKind(data, kind) {
                if (kind == "Group" || kind == "SystemGroup")
                    return roleArray(data, "groupNames");
                else
                    return roleArray(data, "userNames");
            }

            function toName(object) {
                if (typeof object == "object")
                    return object.metadata.name;
                else
                    return object;
            }

            return {
                watch: function watch(until) {
                    loader.watch("policybindings", until).then(function() {
                        expireWhoCan(null);
                    });
                },
                whoCan: function whoCan(project, verb, resource) {
                    return lookupWhoCan(toName(project), verb, resource);
                },
                addToRole: function addToRole(project, role, subject) {
                    var namespace = toName(project);
                    return modifyRole(namespace, role, function(data) {
                        addToArray(roleArray(data, "subjects"), subject);
                        addToArray(roleArrayKind(data, subject.kind), subject.name);
                    }).then(function() {
                        expireWhoCan(namespace);
                    }, function(resp) {
                        /* If the role doesn't exist create it */
                        if (resp.code === 404)
                            return createRole(namespace, role, subject);
                        return $q.reject(resp);
                    });
                },
                removeFromRole: removeFromRole,
                removeMemberFromPolicyBinding: removeMemberFromPolicyBinding,
            };
        }
    ]);

}());
