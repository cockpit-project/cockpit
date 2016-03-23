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

    angular.module('registry.policy', [ ])

    .factory("projectPolicy", [
        '$rootScope',
        'kubeLoader',
        'kubeMethods',
        function($rootScope, loader, methods) {

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
            }

            function expireWhoCan(namespace) {
                expired[namespace] = angular.extend({ }, cached[namespace]);
                delete cached[namespace];
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
                        $rootScope.$applyAsync();
                    }, function(response) {
                        console.warn("failed to lookup access:", namespace, verb, resource + ":",
                                response.message || JSON.stringify(response));
                    });

                return result;
            }

            return {
                watch: function watch() {
                    loader.watch("policybindings");
                },
                whoCan: function whoCan(project, verb, resource) {
                    var namespace;
                    if (typeof project == "object")
                        namespace = project.metadata.name;
                    else
                        namespace = project;
                    return lookupWhoCan(namespace, verb, resource);
                }
            };
        }
    ]);

}());
