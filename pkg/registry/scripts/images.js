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
        'kubeClient',
    ])

    .config([
        '$routeProvider',
        function($routeProvider) {
            $routeProvider.when('/images', {
                templateUrl: 'views/images-page.html',
                controller: 'ImagesCtrl',
                reloadOnSearch: false,
            });
        }
    ])

    .controller('ImagesCtrl', [
        '$scope',
        'imageLoader',
        'imageSelect',
        function($scope, loader, select) {
            loader.watch();

            $scope.images = function(tag) {
                var result = select().kind("Image").taggedBy(tag);
                return result;
            };

            $scope.imagestreams = function() {
                return select().kind("ImageStream");
            };
        }
    ])

    .factory("imageSelect", [
        'kubeSelect',
        function(select) {

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

            return select;
        }
    ])

    .factory("imageLoader", [
        "kubeLoader",
        function(loader) {
            var watching;

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

            return {
                watch: function() {
                    if (watching)
                        return;

                    /* Load images, but fallback to loading individually */
                    watching = loader.watch("imagestreams");
                    loader.watch("images").catch(function(response) {
                        loader.listen(handle_imagestreams);
                    });
                },
                load: function(imagestream) {
                    handle_imagestream(imagestream);
                },
            };
        }
    ]);

}());
