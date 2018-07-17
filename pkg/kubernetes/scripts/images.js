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
    require("angular-route");
    require('angular-dialog.js');

    require('./kube-client');
    require('./date');
    require('./tags');
    require('./policy');

    require('registry-image-widgets/dist/image-widgets.js');

    require('../views/images-page.html');
    require('../views/imagestream-page.html');
    require('../views/image-page.html');
    require('../views/imagestream-delete.html');
    require('../views/imagestream-modify.html');
    require('../views/imagestream-modify.html');
    require('../views/image-delete.html');

    /*
     * Executes callback for each stream.status.tag[x].item[y]
     * in a stream. Similar behavior to angular.forEach()
     */
    function imagestreamEachTagItem(stream, callback, context) {
        var i, il, items;
        var t, tl, tags = (stream.status || {}).tags || [];
        for (t = 0, tl = tags.length; t < tl; t++) {
            items = (tags[t].items) || [];
            for (i = 0, il = items.length; i < il; i++)
                callback.call(context || null, tags[t], items[i]);
        }
    }

    function identifier(imagestream, tag) {
        var id = imagestream.metadata.namespace + "/" + imagestream.metadata.name;
        if (tag)
            id += ":" + tag.name;
        return id;
    }

    angular.module('registry.images', [
        'ngRoute',
        'ui.cockpit',
        'kubeClient',
        'kubernetes.date',
        'registry.tags',
        'registryUI.images',
    ])

    .config([
        '$routeProvider',
        function($routeProvider) {
            $routeProvider
                .when('/images/:namespace?', {
                    templateUrl: 'views/images-page.html',
                    controller: 'ImagesCtrl'
                })
                .when('/images/:namespace/:target', {
                    controller: 'ImageCtrl',
                    templateUrl: function(params) {
                        var target = params['target'] || '';
                        if (target.indexOf(':') === -1)
                            return 'views/imagestream-page.html';
                        else
                            return 'views/image-page.html';
                    }
                });
        }
    ])

    .factory('registryListingScopeSetup', [
        'imageData',
        'imageActions',
        'projectData',
        'kubeSelect',
        '$location',
        function (data, actions, projectData, select, $location) {
            return function($scope, inPage) {
                function imageByTag (tag) {
                    if (tag && tag.items && tag.items.length)
                        return select().kind("Image").name(tag.items[0].image).one();
                }

                function deleteImageStream(stream) {
                    var promise = actions.deleteImageStream(stream);

                    /* If the promise is successful, redirect to another page */
                    promise.then(function() {
                        $location.path($scope.viewUrl('images'));
                    });

                    return promise;
                }

                function deleteTag(stream, tag) {
                    var promise = actions.deleteTag(stream, tag);

                    /* If the promise is successful, redirect to another page */
                    promise.then(function() {
                        var parts = [ "images", stream.metadata.namespace, stream.metadata.name ];
                        $location.path("/" + parts.map(encodeURIComponent).join("/"));
                    });

                    return promise;
                }

                /* All the actions available on the $scope */
                angular.extend($scope, actions);
                angular.extend($scope, data);

                $scope.sharedImages = projectData.sharedImages;
                $scope.imageTagNames = data.imageTagNames;
                $scope.imageByTag = imageByTag;

                if (inPage) {
                    $scope.deleteTag = deleteTag;
                    $scope.deleteImageStream = deleteImageStream;
                }

                $scope.actions = {
                    modifyImageStream: $scope.modifyImageStream,
                    deleteImageStream: $scope.deleteImageStream,
                    deleteTag: $scope.deleteTag,
                    modifyProject: $scope.modifyProject,
                };
            };
        }
    ])

    .controller('ImagesCtrl', [
        '$scope',
        '$location',
        'imageData',
        'imageActions',
        'projectData',
        'kubeLoader',
        'registryListingScopeSetup',
        'filterService',
        function($scope, $location, data, actions, projectData, loader, registryListingScopeSetup) {
            $scope.sharedImages = projectData.sharedImages;

            /* Watch all the images in current namespace */
            data.watchImages($scope);

            $scope.imagestreams = data.allStreams();
            loader.listen(function() {
                $scope.imagestreams = data.allStreams();
            }, $scope);

            $scope.$on("activate", function(ev, imagestream, tag) {
                ev.preventDefault();
                $location.path('/images/' + identifier(imagestream, tag));
            });

            registryListingScopeSetup($scope, false);
        }
    ])

    /*
     * Note that we use the same controller for both the ImageStream
     * and the Image view. This is because ngRoute can't special case
     * routes based on the colon we use to differentiate the two in
     * the path.
     *
     * ie: cockpit/ws vs. cockpit/ws:latest
     *
     * The |kind| on the scope tells us which is which.
     */
    .controller('ImageCtrl', [
        '$scope',
        '$location',
        '$routeParams',
        'kubeSelect',
        'kubeLoader',
        'KubeDiscoverSettings',
        'imageData',
        'imageActions',
        'projectData',
        'projectPolicy',
        'registryListingScopeSetup',
        function($scope, $location, $routeParams, select, loader, discoverSettings, data, actions, projectData, projectPolicy, registryListingScopeSetup) {
            var target = $routeParams["target"] || "";
            var pos = target.indexOf(":");

            /* colon contains a tag name, only set if we're looking at an image */
            var namespace = $routeParams["namespace"] || "";
            var name, tagname;
            if (pos === -1) {
                $scope.kind = "ImageStream";
                name = target;
                tagname = null;
            } else {
                $scope.kind = "Image";
                name = target.substr(0, pos);
                tagname = target.substr(pos + 1);
            }

            registryListingScopeSetup($scope, true);

            /* There's no way to watch a single item ... so watch them all :( */
            data.watchImages($scope);

            loader.listen(function() {
                $scope.stream = select().kind("ImageStream").namespace(namespace).name(name).one();
                $scope.image = $scope.config = $scope.layers = $scope.labels = $scope.tag = null;

                imagestreamEachTagItem($scope.stream || {}, function(tag, item) {
                    if (tag.tag === tagname)
                        $scope.tag = tag;
                });

                if ($scope.tag)
                    $scope.image = $scope.imageByTag($scope.tag);
                if ($scope.image) {
                    $scope.names = data.imageTagNames($scope.image);
                    $scope.config = data.imageConfig($scope.image);
                    $scope.layers = data.imageLayers($scope.image);
                    $scope.labels = data.imageLabels($scope.image);
                }
            }, $scope);

            $scope.$on("activate", function(ev, imagestream, tag) {
                ev.preventDefault();
                $location.path('/images/' + identifier(imagestream, tag));
            });

            function updateShowDockerPushCommands() {
                discoverSettings().then(function(settings) {
                    projectPolicy.subjectAccessReview(namespace, settings.currentUser, 'update', 'imagestreamimages')
                       .then(function(allowed) {
                            if (allowed != $scope.showDockerPushCommands) {
                                $scope.showDockerPushCommands = allowed;
                                $scope.$applyAsync();
                            }
                       });
                });
            }

            // watch for project changes to update showDockerPushCommands, and initialize it
            $scope.$on("$routeUpdate", updateShowDockerPushCommands);
            updateShowDockerPushCommands();
        }
    ])

    .factory("imageData", [
        'kubeSelect',
        'kubeLoader',
        function(select, loader) {
            var watching = false;

            /* Called when we have to load images via imagestreams */
            loader.listen(function(objects) {
                for (var link in objects) {
                    if (objects[link].kind === "ImageStream")
                        handle_imagestream(objects[link]);
                    if (objects[link].kind === "Image")
                        handle_image(objects[link]);
                }
            });

            function handle_imagestream(imagestream) {
                var meta = imagestream.metadata || { };
                var status = imagestream.status || { };
                angular.forEach(status.tags || [ ], function(tag) {
                    angular.forEach(tag.items || [ ], function(item) {
                        var link = loader.resolve("Image", item.image);
                        if (link in loader.objects)
                            return;

                        /* An interim object while we're loading */
                        var interim = { kind: "Image", apiVersion: "v1", metadata: { name: item.image } };
                        loader.handle(interim);

                        if (!watching)
                            return;

                        var name = meta.name + "@" + item.image;
                        loader.load("ImageStreamImage", name, meta.namespace).then(function(resource) {
                            var image = resource.image;
                            if (image) {
                                image.kind = "Image";
                                loader.handle(image);
                                handle_image(image);
                            }
                        }, function(response) {
                            var message = response.statusText || response.message || String(response);
                            console.warn("couldn't load image: " + message);
                            interim.metadata.resourceVersion = "invalid";
                        });
                    });
                });
            }

            /*
             * Create a pseudo-item with kind DockerImageManifest for
             * each image with a dockerImageManifest that we see. Identical
             * name to the image itself.
             */
            function handle_image(image) {
                var item, manifest = image.dockerImageManifest;
                if (manifest) {
                    manifest = JSON.parse(manifest);
                    angular.forEach(manifest.history || [], function(item) {
                        if (typeof item.v1Compatibility == "string")
                            item.v1Compatibility = JSON.parse(item.v1Compatibility);
                    });
                    item = {
                        kind: "DockerImageManifest",
                        metadata: {
                            name: image.metadata.name,
                            selfLink: "/internal/manifests/" + image.metadata.name
                        },
                        manifest: manifest,
                    };
                    loader.handle(item);
                }
            }

            /* Load images, but fallback to loading individually */
            function watchImages(until) {
                watching = true;
                var a = loader.watch("images", until);
                var b = loader.watch("imagestreams", until);

                return {
                    cancel: function() {
                        a.cancel();
                        b.cancel();
                    }
                };
            }

            /*
             * Filters selection to those with names that is
             * in the given TagEvent.
             */
            select.register("taggedBy", function(tag) {
                var i, len, results = { };
                // catch condition when tag.items is null due to imagestream import error
                if (!tag.items)
                    return select(null);
                for (i = 0, len = tag.items.length; i < len; i++)
                    this.name(tag.items[i].image).extend(results);
                return select(results);
            });

            /*
             * Filters selection to those with names that is in the first
             * item in the given TagEvent.
             */
            select.register("taggedFirst", function(tag) {
                var results = { };
                if (!tag.items)
                    return select(null);
                if (tag.items.length)
                    this.name(tag.items[0].image).extend(results);
                return select(results);
            });

            /*
             * Filter that gets image streams for the given tag.
             */
            select.register({
                name: "containsTagImage",
                digests: function(arg) {
                    var ret = [];
                    if (typeof arg == "string") {
                        ret.push(arg);
                    } else {
                        imagestreamEachTagItem(arg, function(tag, item) {
                            ret.push(item.image + "");
                        });
                    }
                    return ret;
                }
            });

            select.register("listTagNames", function(image_name) {
                var names = [];
                angular.forEach(this.containsTagImage(image_name), function(stream) {
                    imagestreamEachTagItem(stream, function(tag, item) {
                        if (!image_name || item.image == image_name)
                            names.push(stream.metadata.namespace + "/" + stream.metadata.name + ":" + tag.tag);
                    });
                });
                return names;
            });

            /*
             * Filter that gets the config object for a docker based
             * image.
             */
            select.register("dockerImageConfig", function() {
                var results = { };
                angular.forEach(this, function(image, key) {
                    var compat, layers = imageLayers(image) || { };
                    if (layers[0]) {
                        compat = layers[0].v1Compatibility;
                        if (compat && compat.config) {
                            results[key] = compat.config;
                            return;
                        }
                    }

                    var meta = image.dockerImageMetadata || { };
                    if (meta.Config)
                        results[key] = meta.Config;
                });

                return select(results);
            });

            /*
             * Filter that gets a dict of labels for a config
             * image.
             */
            select.register("dockerConfigLabels", function() {
                var results = { };
                angular.forEach(this, function(config, key) {
                    var labels;
                    if (config)
                        labels = config.Labels;
                    if (labels)
                        results[key] = labels;
                });
                return select(results);
            });


            function imageLayers(image) {
                if (!image)
                    return null;
                var item = select().kind("DockerImageManifest").name(image.metadata.name).one();
                if (item && item.manifest && item.manifest.schemaVersion === 1)
                    return item.manifest.history;
                if (image.dockerImageLayers)
                    return image.dockerImageLayers;
                return null;
            }

            /* HACK: We really want a metadata index here */
            function configCommand(config) {
                var result = [ ];
                if (!config)
                    return "";
                if (config.Entrypoint)
                    result.push.apply(result, config.Entrypoint);
                if (config.Cmd)
                    result.push.apply(result, config.Cmd);
                var string = result.join(" ");
                if (config.User && config.User.split(":")[0] != "root")
                    return "$ " + string;
                else
                    return "# " + string;
            }

            return {
                watchImages: watchImages,
                allStreams: function allStreams() {
                    return select().kind("ImageStream");
                },
                imageLayers: imageLayers,
                imageConfig: function imageConfig(image) {
                    return select(image).dockerImageConfig().one() || { };
                },
                imageTagNames: function imageTagNames(image) {
                    return select().kind("ImageStream").listTagNames(image.metadata.name);
                },
                imageLabels: function imageLabels(image) {
                    var labels = select(image).dockerImageConfig().dockerConfigLabels().one();
                    if (labels && angular.equals({ }, labels))
                        labels = null;
                    return labels;
                },
                configCommand: configCommand,
            };
        }
    ])

    .factory('imageActions', [
        '$modal',
        '$location',
        function($modal, $location) {
            function deleteImageStream(stream) {
                return $modal.open({
                    animation: false,
                    controller: 'ImageStreamDeleteCtrl',
                    templateUrl: 'views/imagestream-delete.html',
                    resolve: {
                        dialogData: function() {
                            return { stream: stream };
                        }
                    },
                }).result;
            }

            function createImageStream() {
                return $modal.open({
                    animation: false,
                    controller: 'ImageStreamModifyCtrl',
                    templateUrl: 'views/imagestream-modify.html',
                    resolve: {
                        dialogData: function() {
                            return { };
                        }
                    },
                }).result;
            }

            function modifyImageStream(stream) {
                return $modal.open({
                    animation: false,
                    controller: 'ImageStreamModifyCtrl',
                    templateUrl: 'views/imagestream-modify.html',
                    resolve: {
                        dialogData: function() {
                            return { stream: stream };
                        }
                    },
                }).result;
            }

            function deleteTag(stream, tag) {
                var modal = $modal.open({
                    animation: false,
                    controller: 'ImageDeleteCtrl',
                    templateUrl: 'views/image-delete.html',
                    resolve: {
                        dialogData: function() {
                            return { stream: stream, tag: tag };
                        }
                    },
                });

                return modal.result;
            }

            function modifyProject(project) {
                $location.path("/projects/" + project);
                return false;
            }

            return {
                createImageStream: createImageStream,
                modifyImageStream: modifyImageStream,
                deleteImageStream: deleteImageStream,
                deleteTag: deleteTag,
                modifyProject: modifyProject,
            };
        }
    ])

    .controller("ImageStreamDeleteCtrl", [
        "$scope",
        "$modalInstance",
        "dialogData",
        "kubeMethods",
        function($scope, $instance, dialogData, methods) {
            angular.extend($scope, dialogData);

            $scope.performDelete = function performDelete() {
                return methods.delete($scope.stream);
            };
        }
    ])

    .controller("ImageStreamModifyCtrl", [
        "$scope",
        "$modalInstance",
        "dialogData",
        "imageTagData",
        "kubeMethods",
        "filterService",
        "gettextCatalog",
        function($scope, $instance, dialogData, tagData, methods, filter, gettextCatalog) {
            var stream = dialogData.stream || { };
            var meta = stream.metadata || { };
            var spec = stream.spec || { };
            var _ = gettextCatalog.getString.bind(gettextCatalog);

            var populate = "none";
            if (spec.dockerImageRepository)
                populate = "pull";
            if (spec.tags)
                populate = "tags";

            var fields = {
                name: meta.name || "",
                project: meta.namespace || filter.namespace() || "",
                populate: populate,
                pull: spec.dockerImageRepository || "",
                tags: tagData.parseSpec(spec),
                insecure: hasInsecureTag(spec),
            };

            $scope.fields = fields;
            $scope.labels = {
                populate: {
                    none: _("Don't pull images automatically"),
                    pull: _("Sync all tags from a remote image repository"),
                    tags: _("Pull specific tags from another image repository"),
                }
            };

            $scope.placeholder = _("eg: my-image-stream");

            /* During creation we have a different label */
            if (!dialogData.stream)
                $scope.labels.populate.none = _("Create empty image stream");

            function performModify() {
                var data = {
                    apiVersion: "v1",
                    kind: "ImageStream",
                    metadata: { annotations:  { "openshift.io/image.dockerRepositoryCheck" : null }}
                };

                if (fields.populate == "pull")
                    data.spec = { dockerImageRepository: fields.pull.trim(), };
                else if (fields.populate == "tags")
                    data.spec = tagData.buildSpec(fields.tags, data.spec, fields.insecure, fields.pull.trim());
                else
                    data.spec = { dockerImageRepository: null, tags: null };

                return methods.patch(stream, data);
            }

            function performCreate() {
                var data = {
                    apiVersion: "v1",
                    kind: "ImageStream",
                    metadata: {
                        name: fields.name.trim(),
                        namespace: fields.project.trim(),
                    }
                };

                if (fields.populate == "pull")
                    data.spec = { dockerImageRepository: fields.pull.trim(), };
                else if (fields.populate == "tags")
                    data.spec = tagData.buildSpec(fields.tags, data.spec, fields.insecure, fields.pull.trim());

                return methods.check(data, {
                    "metadata.name": "#imagestream-modify-name",
                    "metadata.namespace": "#imagestream-modify-project",
                }).then(function() {
                    return methods.create(data, fields.project);
                });
            }

            function hasInsecureTag(spec) {
                // loop through tags, check importPolicy.insecure boolean
                // if one tag is insecure the intent is the imagestream is insecure
                var insecure;
                if (spec) {
                    for (var tag in spec.tags) {
                        if (spec.tags[tag].importPolicy.insecure) {
                            insecure = spec.tags[tag].importPolicy.insecure;
                            break;
                        }
                    }
                }
                return insecure;
            }

            $scope.performCreate = performCreate;
            $scope.performModify = performModify;
            $scope.hasInsecureTag = hasInsecureTag;

            $scope.projects = filter.namespaces;
            angular.extend($scope, dialogData);
        }
    ])

    .controller("ImageDeleteCtrl", [
        "$scope",
        "$modalInstance",
        "dialogData",
        "kubeMethods",
        function($scope, $instance, dialogData, methods) {
            angular.extend($scope, dialogData);

            $scope.performDelete = function performDelete() {
                var name = $scope.stream.metadata.name + ":" + $scope.tag.tag;
                return methods.delete("ImageStreamTag", name, $scope.stream.metadata.namespace);
            };
        }
    ]);
}());
