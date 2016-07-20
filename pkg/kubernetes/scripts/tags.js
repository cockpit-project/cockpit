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

    var REGTAG = /[\u200B\s,]+/;
    function parseNodes(parent) {
        var child, text, names = [];
        function pushName(name) {
            if (name)
                names.push(name);
        }
        for (child = parent.firstChild; child; child = child.nextSibling) {
            text = "";
            if (child.nodeType == 3)
                text = child.nodeValue.trim();
            else if (child.nodeType == 1 && child.hasAttribute("value"))
                text = child.getAttribute("value");
            text.split(REGTAG).forEach(pushName);
        }
        return names;
    }

    function buildNodes(names) {
        var elements = [ document.createTextNode("\u200B") ];
        angular.forEach(names, function(name) {
            var span = document.createElement("span");
            span.setAttribute("contenteditable", "false");
            span.setAttribute("class", "image-tag");
            span.setAttribute("value", name);
            span.appendChild(document.createTextNode(name));
            var close = document.createElement("a");
            close.setAttribute("class", "pficon pficon-close");
            span.appendChild(close);
            elements.push(span);
            elements.push(document.createTextNode("\u00A0"));
        });
        return elements;
    }

    function parseSpec(spec) {
        var names = [];
        angular.forEach(spec.tags || [ ], function(tag) {
            names.push(tag.name);
        });
        return names;
    }

    function buildSpec(names, spec, insecure) {
        var already = { };
        if (!spec)
            spec = { };
        angular.forEach(spec.tags || [], function(tag) {
            already[tag.name] = tag;
        });
        var tags = [ ];
        angular.forEach(names, function(name) {
            if (name in already) {
                already[name].importPolicy = { "insecure": insecure };
                tags.push(already[name]);
            } else {
                tags.push({ name: name, "importPolicy": { "insecure": insecure } });
            }
        });
        spec.tags = tags;
        return spec;
    }

    angular.module('registry.tags', [ ])

    .directive('imageTagEditor', [
        function() {
            return {
                restrict: 'A',
                transclude: true,
                scope: {
                    tags: "=",
                },
                link: function(scope, element, attrs) {
                    element.addClass("image-tag-editor");
                    element.attr("tabindex", "0");
                    element.attr("contenteditable", "true");

                    var spans = buildNodes(scope.tags);
                    element.append(spans);

                    /* Select the last item when we get focus */
                    var range = document.createRange();
                    range.selectNodeContents(spans[spans.length - 1]);
                    range.collapse(false);
                    var sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);

                    element.on("click", function(ev) {
                        var target = ev.target;
                        var span = target.parentNode;
                        if (target.nodeName.toLowerCase() == "a" && span.nodeName.toLowerCase() == "span")
                            span.parentNode.removeChild(span);
                    });

                    /* When things change retag */
                    element.on("blur keyup paste copy cut mouseup", function() {
                        var tags = parseNodes(element[0]);
                        while (scope.tags.length > 0)
                            scope.tags.pop();
                        tags.forEach(function(tag) {
                            scope.tags.push(tag);
                        });
                    });
                }
            };
        }
    ])

    .factory('imageTagData', [
        function() {
            return {
                parseSpec: parseSpec,
                buildSpec: buildSpec,
                buildNodes: buildNodes,
                parseNodes: parseNodes,
            };
        }
    ]);

}());
