define([
    "jquery",
    "base1/cockpit",
    "base1/angular",
    "kubernetes/app"
], function($, cockpit, angular) {
    'use strict';

    var phantom_checkpoint = phantom_checkpoint || function () { };
    var _ = cockpit.gettext;

    return angular.module('kubernetes.images', ['ngRoute'])
        .config([
            '$routeProvider',
            function($routeProvider) {
                $routeProvider.when('/images', {
                    templateUrl: 'views/images-page.html',
                    controller: 'ImagesCtrl'
                });
            }
        ])

        .provider('ImageRegistry',
            function() {
                var unique = 0;
                var client = null;
                var scopes = { };
                var timeout = null;

                /* The actual singleton object we return */
                var repositories = { };

                function ImageRepository(repo) {
                    var self = this;
                    self.repo = repo;
                    self.images = { };
                    self.imagestreams = { };

                    /* Split out repository name and source */
                    var parts = repo.split("/");
                    if (parts.length == 3) {
                        self.name = parts.slice(1).join("/");
                        self.source = parts[0];
                    } else {
                        self.name = repo;
                        self.source = "registry.hub.docker.com";
                    }

                    /*
                     * ImageRepository.tags:
                     * @image: an optional image
                     *
                     * Returns a map of image -> tag. Tag value will be null
                     * for any image that is not tagged.
                     */
                    self.tags = function tags(image) {
                        var result = { };

                        /* Account for any untagged images */
                        if (image) {
                            result[image.metadata.name] = null;
                        } else {
                            angular.forEach(self.images, function(image) {
                                result[image.metadata.name] = null;
                            });
                        }

                        /* The only source of tags we have is currently from ImageStream items */
                        angular.forEach(self.imagestreams, function(imagestream) {
                            if (imagestream.status && imagestream.status.tags) {
                                imagestream.status.tags.forEach(function(tag) {
                                    if (tag.items) {
                                        tag.items.forEach(function(item) {
                                            if (item.image in result)
                                                result[item.image] = tag.tag;
                                        });
                                    }
                                });
                            }
                        });

                        return result;
                    };

                    self.latest = function latest() {
                        var result = null;
                        angular.forEach(self.images, function(image) {
                            var meta = image.dockerImageMetadata || { };
                            var created = meta.Created || null;
                            if (created && (!result || created > result))
                                result = created;
                        });
                        return result;
                    };
                }

                /*
                 * I'm not completely happy with this. We could be
                 * firing way too many $digests for the entire scope
                 * because other things from other code, could be triggering
                 * while waiting for the timeout.
                 */

                function digest() {
                    timeout = null;
                    for (var id in scopes)
                        scopes[id].$digest();
                }

                function trigger() {
                    if (timeout === null)
                        timeout = window.setTimeout(digest, 100);
                }

                function repo_qualify(repo) {
                    if (repo && repo.indexOf('/') === -1)
                        return "library/" + repo;
                    return repo;
                }

                function image_repo(image) {
                    var ref = image.dockerImageReference || "";
                    return repo_qualify(ref.split(':')[0].split('@')[0]);
                }

                function image_added(unused, image, key) {
                    var repo = image_repo(image);
                    if (repo) {
                        var repository = repositories[repo];
                        if (!repository)
                            repository = repositories[repo] = new ImageRepository(repo);
                        repository.images[key] = image;
                    }
                    trigger();
                }

                function image_removed(unused, image, key) {
                    var repo = image_repo(image);
                    if (repo) {
                        var repository = repositories[repo];
                        if (repository) {
                            delete repository.images[key];
                            if (repository_empty(repository))
                                delete repositories[repo];
                        }
                    }
                    trigger();
                }

                function image_updated(ev, image, key, last) {
                    image_removed(ev, last, key);
                    image_added(ev, image, key);
                }

                function imagestream_repo(imagestream) {
                    var spec = imagestream.spec || { };
                    return repo_qualify(spec.dockerImageRepository || "");
                }

                function imagestream_added(unused, imagestream, key) {
                    var repo = imagestream_repo(imagestream);
                    if (repo) {
                        var repository = repositories[repo];
                        if (!repository)
                            repository = repositories[repo] = new ImageRepository(repo);
                        repository.imagestreams[key] = imagestream;
                    }
                    trigger();
                }

                function imagestream_removed(unused, imagestream, key) {
                    var repo = imagestream_repo(imagestream);
                    if (repo) {
                        var repository = repositories[repo];
                        if (repository) {
                            delete repository.imagestreams[key];
                            if (repository_empty(repository))
                                delete repositories[repo];
                        }
                    }
                    trigger();
                }

                function imagestream_updated(ev, imagestream, key, last) {
                    imagestream_removed(ev, last, key);
                    imagestream_added(ev, imagestream, key);
                }

                function repository_empty(repository) {
                    var key;
                    for (key in repository.images)
                        return false;
                    for (key in repository.imagestreams)
                        return false;
                    return true;
                }

                var images, imagestreams;

                function start(scope) {
                    var key;

                    /*
                     * First time we start, ask the kubernetes client to
                     * load these types of objects. These are openshift specific.
                     */
                    if (unique === 0) {
                        client.include("images");
                        client.include("imagestreams");
                    }

                    if (angular.equals({}, scopes)) {
                        images = client.select("Image");
                        client.track(images);
                        $(images).on("added", image_added);
                        $(images).on("removed", image_removed);
                        $(images).on("updated", image_updated);
                        for (key in images)
                            image_added(null, images[key], key);

                        imagestreams = client.select("ImageStream");
                        client.track(imagestreams);
                        $(imagestreams).on("added", imagestream_added);
                        $(imagestreams).on("removed", imagestream_removed);
                        $(imagestreams).on("updated", imagestream_updated);
                        for (key in imagestreams)
                            imagestream_added(null, imagestreams[key], key);
                    }

                    var id = unique++;
                    scopes[id] = scope;
                    return id;
                }

                function stop(id) {
                    delete scopes[id];
                    for (id in scopes)
                        return;

                    /* No scopes listening, stop */
                    client.track(images, false);
                    $(images).off();
                    images = null;

                    client.track(imagestreams, false);
                    $(imagestreams).off();
                    imagestreams = null;

                    window.clearTimeout(timeout);
                    timeout = null;
                }

                /* Bind the scope to the singleton */
                function ImageRegistry(scope) {
                    var self = this;
                    self.repositories = repositories;
                    var id = start(scope);
                    scope.$on("$destroy", function() {
                        stop(id);
                    });
                }

                /* Invoked for each caller of this provider */
                return {
                    $get: [
                        'kubernetesClient',
                        function(kubernetesClient) {
                            if (!client)
                                client = kubernetesClient;
                            return ImageRegistry;
                        }
                    ]
                };
            }
        )

        .controller('ImagesCtrl', [
            '$scope',
            '$timeout',
            'kubernetesClient',
            'kubernetesFilter',
            'ImageRegistry',
            function($scope, $timeout, kubernetesClient, filter, ImageRegistry) {
                $scope.registry = new ImageRegistry($scope);
                $scope.items = $scope.registry.repositories;

                $scope.failure = null;
                $scope.state = null;

                $scope.is_visible = function(item) {
                    if (!filter.namespace)
                        return true;

                    for (var key in item.imagestreams)
                        return true;

                    return false;
                };

                $scope.client.watches.images.wait()
                    .fail(function(ex) {
                        $scope.failure = ex.message;
                        $scope.state = 'fail';
                    })
                    .done(function(ex) {
                        $scope.state = 'ready';
                    })
                    .always(digest);

                var timeout = null;
                function digest() {
                    if (timeout === null) {
                        timeout = window.setTimeout(function() {
                            timeout = null;
                            $scope.$digest();
                            phantom_checkpoint();
                        });
                    }
                }
            }
        ])

        /*
         * Display a tags dict as returned by
         * ImageRepository.tags()
         */
        .filter('imagesTags', function() {
            return function(tags, only) {
                var extra = 0;
                var names = [];
                var image, tag;
                for (image in tags) {
                    tag = tags[image];
                    if (tag)
                        names.push(tag);
                    else
                        extra += 1;
                }

                names.sort();
                if (names.length > 5) {
                    extra += (names.length - 5);
                    names = names.slice(0, 5);
                }

                var ret = names.join(", ");
                var format;

                if (!only && extra) {
                    if (ret)
                        format = cockpit.ngettext("more images", _(" + $0 more"), _(" + $0 more"), extra);
                    else
                        format = cockpit.ngettext(_("$0 image"), _("$0 images"), extra);
                    ret += cockpit.format(format, extra);
                }
                return ret;
            };
        })

        .filter("imagesNamespaces", function() {
            return function(val) {
                var result = [ ];
                angular.forEach(val, function(x) {
                    var meta = x.metadata || { };
                    if (meta.namespace)
                        result.push(meta.namespace);
                });
                return result.join(", ");
            };
        });
});
