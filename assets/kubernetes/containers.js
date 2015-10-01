define([
    "jquery",
    "base1/cockpit",
    "base1/angular",
    "base1/term",
    "kubernetes/app"
], function($, cockpit, angular, Terminal) {
    'use strict';

    var phantom_checkpoint = phantom_checkpoint || function () { };

    return angular.module('kubernetes.containers', ['ngRoute'])
        .config(['$routeProvider', function($routeProvider) {
            $routeProvider.when('/pods/:namespace?', {
                templateUrl: 'views/containers-page.html',
                controller: 'ContainersCtrl'
            });
        }])

        /*
         * The controller for the containers view.
         */
        .controller('ContainersCtrl', [
            '$scope',
            '$routeParams',
            '$location',
            function($scope, $routeParams, $location) {
                var client = $scope.client;

                var selector = {};
                var qs = $location.search();
                for (var key in qs) {
                    if (key !== "namespace")
                        selector[key] = qs[key];
                }

                if ($.isEmptyObject(selector))
                    selector = null;

                /* Setup a persistent search for this object */
                var list = client.select("Pod", $routeParams.namespace, selector);
                client.track(list);

                $scope.pods = list;

                $(list).on("changed", function() {
                    $scope.$digest();
                });

                $scope.$on("$destroy", function() {
                    client.track(list, false);
                    $(list).off();
                });

                $scope.should_mask = function(name) {
                    return name.toLowerCase().indexOf("password") !== -1;
                };

                $scope.containers = function containers(pod) {
                    var items = client.containers(pod);
                    var id, container, result = { };
                    for (var key in items) {
                        container = items[key];
                        id = pod.metadata.namespace + "/pod/" + pod.metadata.name + "/" + container.spec.name;
                        result[id] = container;
                        container.key = id;
                    }
                    return result;
                };
            }
        ])

        .directive('kubeContainerBody',
            function() {
                return {
                    restrict: 'E',
                    templateUrl: 'views/container-body.html'
                };
            }
        )

        .directive('kubePodBody',
            function() {
                return {
                    restrict: 'E',
                    templateUrl: 'views/pod-body.html'
                };
            }
        )

        /*
         * Displays a container console.
         *
         * <kube-console namespace="ns" pod="name" container="name"></kube-console>
         */
        .directive('kubeConsole', function() {
            return {
                restrict: 'E',
                link: function(scope, element, attrs) {
                    var limit = 64 * 1024;
                    var cmd = [
                        "kubectl",
                        "logs",
                        "--namespace=" + attrs.namespace,
                        "--container=" + attrs.container,
                        "--follow",
                        attrs.pod
                    ];

                    var outer = $("<div>").addClass("console");
                    element.append(outer);
                    var pre = $("<pre>").addClass("logs");
                    outer.append(pre);
                    var channel = null;
                    var wait = null;

                    function connect() {
                        pre.empty();

                        channel = cockpit.channel({
                            payload: "stream",
                            spawn: cmd,
                            err: "out",
                        });

                        var writing = [];
                        var count = 0;

                        function drain() {
                            wait = null;
                            var at_bottom = pre[0].scrollHeight - pre.scrollTop() <= pre.outerHeight();
                            var text = writing.join("");

                            /*
                             * Stay under the limit. I wish we could use some other mechanism
                             * for limiting the log output, such as:
                             *
                             * https://github.com/kubernetes/kubernetes/issues/12447
                             */
                            count += text.length;
                            var first;
                            while (count > limit) {
                                first = pre.children().first();
                                if (!first[0])
                                    break;
                                count -= first.remove().text().length;
                            }

                            /* And add our text */
                            var span = $("<span>").text(text);
                            writing.length = 0;
                            pre.append(span);
                            if (at_bottom)
                                pre.scrollTop(pre.prop("scrollHeight"));

                            phantom_checkpoint();
                        }

                        $(channel)
                            .on("close", function(ev, options) {
                                if (options.problem)
                                    writing.push(options.problem);
                                drain();
                                disconnect();
                            })
                            .on("message", function(ev, data) {
                                writing.push(data);
                                if (wait === null)
                                    wait = window.setTimeout(drain, 50);
                            });
                    }

                    function disconnect() {
                        if (channel) {
                            channel.close("terminated");
                            $(channel).off();
                        }
                        channel = null;
                        window.clearTimeout(wait);
                        wait = null;
                    }

                    scope.$on("connect", function(ev, what) {
                        if (what == "console") {
                            if (!channel)
                                connect();
                        }
                    });

                    scope.$on("$destroy", disconnect);
                }
            };
        })

        /*
         * Displays a container shell
         *
         * <kube-console namespace="ns" pod="name" container="name"></kube-console>
         */
        .directive('kubeShell', function() {
            return {
                restrict: 'E',
                link: function(scope, element, attrs) {
                    var cmd = [
                        "kubectl",
                        "exec",
                        "--namespace=" + attrs.namespace,
                        "--container=" + attrs.container,
                        "--tty",
                        "--stdin",
                        attrs.pod,
                        "--",
                        "/bin/sh",
                        "-i"
                    ];

                    /* term.js wants the parent element to build its terminal inside of */
                    var outer = $("<div>").addClass("console");
                    element.append(outer);

                    var term = null;
                    var channel = null;

                    function connect() {
                        outer.empty();
                        if (term)
                            term.destroy();

                        term = new Terminal({
                            cols: 80,
                            rows: 24,
                            screenKeys: true
                        });

                        term.open(outer[0]);

                        channel = cockpit.channel({
                            payload: "stream",
                            spawn: cmd,
                            pty: true
                        });

                        $(channel)
                            .on("close", function(ev, options) {
                                var problem = options.problem || "disconnected";
                                term.write('\x1b[31m' + problem + '\x1b[m\r\n');
                                disconnect();
                            })
                            .on("message", function(ev, payload) {
                                /* Output from pty to terminal */
                                term.write(payload);
                            });

                        term.on('data', function(data) {
                            if (channel && channel.valid)
                                channel.send(data);
                        });
                    }

                    function disconnect() {
                        /* There's no term.hideCursor() function */
                        if (term) {
                            term.cursorHidden = true;
                            term.refresh(term.y, term.y);
                        }
                        if (channel) {
                            $(channel).off();
                            channel.close("terminated");
                        }
                        channel = null;
                    }

                    scope.$on("connect", function(ev, what) {
                        if (what == "shell") {
                            if (!channel)
                                connect();
                        }
                    });

                    scope.$on("$destroy", function() {
                        if (term)
                            term.destroy();
                        disconnect();
                    });
                }
            };
        })

        /*
         * Filter to display short docker ids
         *
         * {{ myid | kube-identifier }}
         *
         * Removes docker:// prefix and shortens.
         */
        .filter('kubeIdentifier', function() {
            var regex = /docker:\/\/([\w]{12})\w+/;
            return function(item) {
                var match = regex.exec(item);
                if (match)
                    return match[1];
                return item;
            };
        });
});
