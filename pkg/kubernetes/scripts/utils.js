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

    angular.module("kubeUtils", [])

    .provider('KubeFormat', [
        function() {
            var self = this;

            /* Until we come up with a good default implementation, must be provided */
            self.KubeFormatFactory = "MissingFormat";

            function load(injector, name) {
                if (angular.isString(name))
                    return injector.get(name, "KubeFormat");
                else
                    return injector.invoke(name);
            }

            self.$get = [
                "$injector",
                function($injector) {
                    return load($injector, self.KubeFormatFactory);
                }
            ];
        }
    ])

    .factory("MissingFormat", [
        function() {
            return function MissingFormatCapacity(value) {
                throw "no KubeFormatFactory set";
            };
        }
    ])

    .provider('KubeTranslate', [
        function() {
            var self = this;

            /* Until we come up with a good default implementation, must be provided */
            self.KubeTranslateFactory = "KubeTranslate";

            function load(injector, name) {
                if (angular.isString(name))
                    return injector.get(name, "MissingKubeTranslate");
                else
                    return injector.invoke(name);
            }

            self.$get = [
                "$injector",
                function($injector) {
                    return load($injector, self.KubeTranslateFactory);
                }
            ];
        }
    ])

    .factory("MissingKubeTranslate", [
        function() {
            function error_func() {
                throw "no KubeTranslateFactory set";
            }

            return {
                gettext: error_func,
                ngettext: error_func
            };
        }
    ]);

}());
