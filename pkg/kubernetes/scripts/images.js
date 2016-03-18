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

    angular.module('registry.images', [
        'ngRoute',
        'ui.cockpit',
        'kubeClient',
        'kubernetes.date',
        'kubernetes.listing',
        'registry.layers',
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

    .controller('ImagesCtrl', [
        '$scope',
        '$location',
        'imageData',
        'imageActions',
        'ListingState',
        'filterService',
        function($scope, $location, data, actions, ListingState) {
            $scope.imagestreams = data.allStreams;
            angular.extend($scope, data);

            $scope.listing = new ListingState($scope);

            /* Watch all the images in current namespace */
            data.watchImages();

            $scope.$on("activate", function(ev, id) {
                if (!$scope.listing.expandable) {
                    ev.preventDefault();
                    $location.path('/images/' + id);
                }
            });

            /* All the actions available on the $scope */
            angular.extend($scope, actions);
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
        'imageData',
        'imageActions',
        'ListingState',
        function($scope, $location, $routeParams, select, loader, data, actions, ListingState) {
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

            /* There's no way to watch a single item ... so watch them all :( */
            data.watchImages();


            var c = loader.listen(function() {
                $scope.stream = select().kind("ImageStream").namespace(namespace).name(name).one();
                $scope.image = $scope.config = $scope.layers = $scope.labels = $scope.tag = null;

                imagestreamEachTagItem($scope.stream || {}, function(tag, item) {
                    if (tag.tag === tagname)
                        $scope.tag = tag;
                });


                if ($scope.tag)
                    $scope.image = select().kind("Image").taggedBy($scope.tag).one();
                if ($scope.image) {
                    $scope.names = data.imageTagNames($scope.image);
                    $scope.config = data.imageConfig($scope.image);
                    $scope.layers = data.imageLayers($scope.image);
                    $scope.labels = data.imageLabels($scope.image);
                }
            });

            $scope.listing = new ListingState($scope);
            $scope.listing.inline = true;

            /* So we can use the same imageListing directive */
            $scope.imagestreams = function() {
                if ($scope.stream)
                    return { "/": $scope.stream };
                return { };
            };

            $scope.$on("$destroy", function() {
                c.cancel();
            });

            /* All the data actions available on the $scope */
            angular.extend($scope, data);
            angular.extend($scope, actions);

            /* But special case a few */
            $scope.deleteImageStream = function(stream) {
                var promise = actions.deleteImageStream(stream);

                /* If the promise is successful, redirect to another page */
                promise.then(function() {
                    $location.path($scope.viewUrl('images'));
                });

                return promise;
            };

            $scope.deleteTag = function(stream, tag) {
                var promise = actions.deleteTag(stream, tag);

                /* If the promise is successful, redirect to another page */
                promise.then(function() {
                    var parts = [ "images", stream.metadata.namespace, stream.metadata.name ];
                    $location.path("/" + parts.map(encodeURIComponent).join("/"));
                });

                return promise;
            };
        }
    ])

    .directive('imagePanel', [
        'kubeLoader',
        'imageData',
        function(loader, data) {
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

                    var c = loader.listen(function() {
                        scope.names = scope.config = scope.layers = scope.labels = null;
                        if (scope.image) {
                            scope.names = data.imageTagNames(scope.image);
                            scope.config = data.imageConfig(scope.image);
                            scope.layers = data.imageLayers(scope.image);
                            scope.labels = data.imageLabels(scope.image);
                        }
                    });

                    scope.$on("$destroy", function() {
                        c.cancel();
                    });
                },
                templateUrl: "views/image-panel.html"
            };
        }
    ])

    .directive('imageBody',
        function() {
            return {
                restrict: 'A',
                templateUrl: 'views/image-body.html'
            };
        }
    )

    .directive('imageConfig',
        function() {
            return {
                restrict: 'A',
                templateUrl: 'views/image-config.html'
            };
        }
    )

    .directive('imageMeta',
        function() {
            return {
                restrict: 'A',
                templateUrl: 'views/image-meta.html'
            };
        }
    )

    .directive('imagestreamBody',
        function() {
            return {
                restrict: 'A',
                templateUrl: 'views/imagestream-body.html'
            };
        }
    )

    .directive('imagestreamMeta',
        function() {
            return {
                restrict: 'A',
                templateUrl: 'views/imagestream-meta.html'
            };
        }
    )

    .directive('imageListing',
        function() {
            return {
                restrict: 'A',
                templateUrl: 'views/image-listing.html'
            };
        }
    )

    .factory("imageData", [
        'kubeSelect',
        'kubeLoader',
        function(select, loader) {

            /* Called when we have to load images via imagestreams */
            function handle_imagestreams(objects) {
                for (var link in objects) {
                    if (objects[link].kind === "ImageStream")
                        handle_imagestream(objects[link]);
                }
            }

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

                        var name = meta.name + "@" + item.image;
                        loader.load("ImageStreamImage", name, meta.namespace).then(function(resource) {
                            var image = resource.image;
                            if (image) {
                                image.kind = "Image";
                                loader.handle(image);
                            }
                        }, function(response) {
                            console.warn("couldn't load image: " + response.statusText);
                            interim.metadata.resourceVersion = "invalid";
                        });
                    });
                });
            }

            /* Load images, but fallback to loading individually */
            var watching = null;
            function watchImages() {
                loader.watch("images");
                if (!watching)
                    watching = loader.watch("imagestreams");
                return watching;
            }

            loader.listen(handle_imagestreams);

            /*
             * Filters selection to those with names that are
             * in the given TagEvent.
             */
            select.register("taggedBy", function(tag) {
                var i, len, results = { };
                for (i = 0, len = tag.items.length; i < len; i++)
                    this.name(tag.items[i].image).extend(results);
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
             * Filter that gets docker image manifests for each of the
             * images selected. Objects without a manifest will be
             * dropped from the results.
             */
            select.register("dockerImageManifest", function() {
                var results = { };
                angular.forEach(this, function(image, key) {
                    var history, manifest = image.dockerImageManifest;
                    if (manifest) {
                        manifest = JSON.parse(manifest);
                        angular.forEach(manifest.history || [], function(item) {
                            if (typeof item.v1Compatibility == "string")
                                item.v1Compatibility = JSON.parse(item.v1Compatibility);
                        });
                        results[key] = manifest;
                    }
                });
                return select(results);
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
                var manifest = select(image).dockerImageManifest().one();
                if (!manifest || manifest.schemaVersion !== 1)
                    return null;
                return manifest.history;
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
                imagesByTag: function imagesByTag(tag) {
                    return select().kind("Image").taggedBy(tag);
                },
                imageLayers: imageLayers,
                imageConfig: function imageConfig(image) {
                    return select(image).dockerImageConfig().one() || { };
                },
                imageTagNames: function imageTagNames(image) {
                    return select().kind("ImageStream").listTagNames(image.metadata.name);
                },
                imageLabels: function imageLabels(image) {
                    return select(image).dockerImageConfig().dockerConfigLabels().one();
                },
                configCommand: configCommand,
            };
        }
    ])

    .factory('imageActions', [
        '$modal',
        function($modal) {
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

            return {
                createImageStream: createImageStream,
                modifyImageStream: modifyImageStream,
                deleteImageStream: deleteImageStream,
                deleteTag: deleteTag,
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
        "kubeMethods",
        "filterService",
        function($scope, $instance, dialogData, methods, filter) {
            var stream = dialogData.stream || { };
            var meta = stream.metadata || { };
            var spec = stream.spec || { };

            var fields = {
                name: meta.name || "",
                project: meta.namespace || filter.namespace() || "",
                populate: spec.dockerImageRepository ? "pull" : "none",
                pull: spec.dockerImageRepository || "",
            };

            $scope.fields = fields;
            $scope.labels = {
                populate: {
                    none: "Don't pull images automatically",
                    pull: "Pull all tags from another image repository",
                }
            };

            function performModify() {
                var data = { spec: { dockerImageRepository: null, tags: null } };

                if (fields.populate != "none")
                    data.spec.dockerImageRepository = fields.pull.trim();

                return methods.patch(stream, data);
            }

            function performCreate() {
                var data = {
                    kind: "ImageStream",
                    metadata: {
                        name: fields.name.trim(),
                        namespace: fields.project.trim(),
                    }
                };

                if (fields.populate != "none") {
                    data.spec = {
                        dockerImageRepository: fields.pull.trim(),
                    };
                }

                return methods.check(data, {
                    "metadata.name": "#imagestream-modify-name",
                    "metadata.namespace": "#imagestream-modify-project",
                }).then(function() {
                    return methods.create(data, fields.project);
                });
            }

            $scope.performCreate = performCreate;
            $scope.performModify = performModify;

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
