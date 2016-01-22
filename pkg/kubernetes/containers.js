define([
    "jquery",
    "base1/cockpit",
    "base1/angular",
    "base1/term",
    "kubernetes/app",
    "kubernetes/container-terminal",
], function($, cockpit, angular, Terminal) {
    'use strict';

    var phantom_checkpoint = phantom_checkpoint || function () { };

    return angular.module('kubernetes.containers', [ 'ngRoute', 'kubernetesUI' ])
        .config([
            '$routeProvider',
            'kubernetesContainerSocketProvider',
            function($routeProvider, kubernetesContainerSocketProvider) {
                $routeProvider.when('/pods/:namespace?', {
                    templateUrl: 'views/containers-page.html',
                    controller: 'ContainersCtrl'
                });

                /* Tell the container-terminal that we want to be involved in WebSocket creation */
                kubernetesContainerSocketProvider.WebSocketFactory = 'kubeContainerWebSocket';
            }
        ])

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
         * <kube-console namespace="ns" container="name"></kube-console>
         */
        .directive('kubeConsole', [
            'kubeContainerWebSocket',
            function(socket) {
                return {
                    restrict: 'E',
                    scope: {
                        pod: '&',
                        container: '&',
                        command: '@',
                        prevent: '='
                    },
                    link: function(scope, element, attrs) {
                        var limit = 64 * 1024;

                        var outer = $("<div>").addClass("console");
                        element.append(outer);
                        var pre = $("<pre>").addClass("logs");
                        outer.append(pre);
                        var wait = null;
                        var ws = null;

                        function connect() {
                            pre.empty();

                            var url = "", pod = scope.pod();
                            if (pod.metadata)
                                url += pod.metadata.selfLink;
                            else
                                url += pod;
                            url += "/log";
                            if (url.indexOf('?') === -1)
                                url += '?';
                            url += "follow=1";

                            var container = scope.container ? scope.container() : null;
                            if (container)
                                url += "&container=" + encodeURIComponent(container);

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

                            ws = socket(url);
                            ws.onclose = function(ev) {
                                writing.push(ev.reason);
                                drain();
                                disconnect();
                                ws = null;
                            };
                            ws.onmessage = function(ev) {
                                writing.push(ev.data);
                                if (wait === null)
                                    wait = window.setTimeout(drain, 50);
                            };
                        }

                        function disconnect() {
                            if (ws) {
                                ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
                                if (ws.readyState < 2) // CLOSING
                                    ws.close();
                                ws = null;
                            }
                            window.clearTimeout(wait);
                            wait = null;
                        }

                        scope.$watch("prevent", function(prevent) {
                            if (!prevent && !ws)
                                connect();
                        });

                        scope.$on("$destroy", disconnect);
                    }
                };
            }
        ])

        /*
         * A WebSocket factory for the kubernetes-container-terminal
         *
         * Because we don't yet know that the kubernetes we're talking
         * to supports WebSockets, we just use kubectl instead and
         * make a fake WebSocket out of it.
         */
        .factory("kubeFakeWebSocket", [
            function() {
                function parser(url) {
                    var options = { };
                    var path = cockpit.location.decode(url, options);

                    var command = [ ];
                    var args = [ ];
                    var namespace = "default";
                    var container = null;
                    var cmd = "log";
                    var pod = "";

                    var i, len;
                    for (i = 0, len = path.length; i < len; i++) {
                        if (path[i] === "namespaces") {
                            namespace = path[++i];
                        } else if (path[i] === "pods") {
                            pod = path[++i];
                            if (path[i + 1] == "exec")
                                cmd = "exec";
                            else if (path[i + 1] == "log")
                                cmd = "logs";
                        }
                    }

                    for (i in options) {
                        if (i == "container") {
                            container = options[i];
                        } else if (i == "command") {
                            if (angular.isArray(options[i]))
                                command = options[i];
                            else
                                command.push(options[i]);
                        } else if (i == "stdin" || i == "tty" || i == "follow") {
                            args.push("--" + i);
                        }
                    }

                    var ret = [ "kubectl", cmd, "--namespace=" + namespace ];
                    if (container)
                        ret.push("--container=" + container);
                    ret.push.apply(ret, args);
                    ret.push(pod, "--");
                    ret.push.apply(ret, command);
                    return ret;
                }

                return function KubeFakeWebSocket(url, protocols) {
                    var cmd = parser(url);
                    var base64 = false;

                    /* A fake WebSocket */
                    var channel;
                    var state = 0; /* CONNECTING */
                    var ws = { };
                    cockpit.event_target(ws);

                    function open() {
                        channel = cockpit.channel({
                            payload: "stream",
                            spawn: cmd,
                            pty: true
                        });

                        $(channel)
                            .on("close", function(ev, options) {
                                var problem = options.problem || "";
                                $(channel).off();
                                channel = null;

                                state = 3;
                                var cev = document.createEvent('Event');
                                cev.initEvent('close', false, false, !!problem, 1000, problem);
                                ws.dispatchEvent(cev);
                            })
                            .on("message", function(ev, data) {
                                if (base64)
                                    data = "1" + window.btoa(data);
                                /* It's because of phantomjs */
                                var mev = document.createEvent('MessageEvent');
                                if (!mev.initMessageEvent)
                                    mev = new window.MessageEvent('message', { 'data': data });
                                else
                                    mev.initMessageEvent('message', false, false, data, "");
                                ws.dispatchEvent(mev);
                            });

                        state = 1;
                        var oev = document.createEvent('Event');
                        oev.initEvent('open', false, false);
                        ws.dispatchEvent(oev);
                    }

                    function fail() {
                        var ev = document.createEvent('Event');
                        ev.initEvent('close', false, false, false, 1002, "protocol-error");
                        ws.dispatchEvent(ev);
                    }

                    function close(code, reason) {
                        if (channel)
                            channel.close(reason);
                    }

                    function send(data) {
                        if (base64)
                            data = window.atob(data.slice(1));
                        if (channel)
                            channel.send(data);
                    }

                    /* A fake WebSocket */
                    Object.defineProperties(ws, {
                        binaryType: { value: "arraybuffer" },
                        bufferedAmount: { value: 0 },
                        extensions: { value: "" },
                        protocol: { value: base64 ? "base64.channel.k8s.io" : "" },
                        readyState: { get: function() { return state; } },
                        url: { value: url },
                        close: { value: close },
                        send: { value: send },
                    });

                    var valid = true;
                    if (protocols) {
                        if (angular.isArray(protocols))
                            valid = base64 = protocols.indexOf("base64.channel.k8s.io") !== -1;
                        else
                            valid = base64 = "base64.channel.k8s.io";
                    }

                    if (valid) {
                        window.setTimeout(open);
                    } else {
                        console.warn("Unsupported kubernetes container WebSocket subprotocol: " + protocols);
                        window.setTimeout(fail);
                    }

                    return ws;
                };
            }
        ])

        .factory("kubeContainerWebSocket", [
            'kubernetesClient',
            'kubeFakeWebSocket',
            function(client, kubeFakeWebSocket) {
                /*
                 * So for compatibility we have to decide whether to open
                 * a kubectl based WebSocket or one that talks to kubernetes
                 * with a real WebSocket. We prefer the former for now, because
                 * the condition is easy to detect. If kubectl is available,
                 * we use it.
                 */
                return function(url, protocols) {
                    /* config is retrieved from kubectl */
                    if (client.used_kubectl)
                        return kubeFakeWebSocket(url, protocols);
                    else
                        return client.socket(url, protocols);
                };
            }
        ])

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
