define([
    "jquery",
    "base1/cockpit",
    "base1/angular",
    "base1/term",
    "kubernetes/app"
], function($, cockpit, angular, Terminal) {
    'use strict';

    return angular.module('kubernetes.details', ['ngRoute'])
        .config(['$routeProvider', function($routeProvider) {
            $routeProvider.when('/pods/:namespace?', {
                templateUrl: 'views/details.html',
                controller: 'DetailsCtrl'
            });
        }])

        /*
         * The controller for the details view.
         */
        .controller('DetailsCtrl', [
            '$scope',
            '$routeParams',
            '$location',
            'kubernetesClient',
            function($scope, $routeParams, $location, client) {

            var selector = $location.search();
            if ($.isEmptyObject(selector))
                selector = null;

            /* Setup a persistent search for this object */
            var list = client.select("Pod", $routeParams.namespace, selector);
            client.track(list);

            angular.extend($scope, {
                client: client,
                selection: list,
                should_mask: function(name) {
                    return name.toLowerCase().indexOf("password") !== -1;
                }
            });

            /*
             * TODO: The selection will be a dynamic object dependent on what
             * sorta selection is made, not just pods. We'll list:
             */

            $(list).on("changed", function() {
                $scope.$digest();
            });

            $scope.$on("$destroy", function() {
                client.track(list, false);
            });
        }])

        /*
         * Displays a kubernetes pod.
         *
         * <kube-pod> ... </kube-pod>
         *
         * Expected in scope:
         * pod: raw pod JSON
         */
        .directive('kubePod', function() {
            return {
                restrict: 'E',
                transclude: true,
                templateUrl: 'views/pod-panel.html'
            };
        })

        /*
         * Displays an interactive container.
         *
         * <kube-container></kube-container>
         *
         * Expected in scope:
         * container: raw pod JSON
         *
         * Exported into scope:
         * connect(): causes interactive elements to connect.
         *
         * Events in scope:
         * connect: causes interactive elements to connect.
         */
        .directive('kubeContainer', function() {
            return {
                restrict: 'E',
                scope: true,
                templateUrl: 'views/container-panel.html',
                link: function(scope, element, attrs) {
                    scope.connect = function connect(what) {
                        scope.$broadcast("connect", what);
                    };
                }
            };
        })

        /*
         * Displays a container console.
         *
         * <kube-console namespace="ns" pod="name" container="name"></kube-console>
         */
        .directive('kubeConsole', function() {
            return {
                restrict: 'E',
                link: function(scope, element, attrs) {
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

                        function drain() {
                            wait = null;
                            var at_bottom = pre[0].scrollHeight - pre.scrollTop() <= pre.outerHeight();
                            var span = $("<span>").text(writing.join(""));
                            writing.length = 0;
                            pre.append(span);
                            if (at_bottom)
                                pre.scrollTop(pre.prop("scrollHeight"));
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
