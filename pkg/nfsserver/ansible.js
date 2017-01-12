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

    var $ = require("jquery");
    var cockpit = require("cockpit");
    var apply_script = require("raw!./ansible-apply.sh");

    function role(name) {
        var init_waiter;
        var parameter_file;
        var run_file;
        var failed_file;

        var self = {
            parameters: false,
            running: false,
            failed: false,

            wait: wait,
            set: set
        };

        function set(parameters) {
            var new_params = $.extend({}, self.parameters, parameters);
            return cockpit.script(apply_script, [ name ], { "superuser": "require" }).
                input(JSON.stringify([ { "hosts": "all", "vars": new_params, "roles": [ name ] } ]) + "\n");
        }

        function wait() {
            return init_waiter.promise;
        }

        init_waiter = cockpit.defer();

        parameter_file = cockpit.file("/var/lib/playbooks/" + name + ".json", { "syntax": JSON });
        parameter_file.watch(function (content, tag, error) {
            init_waiter.resolve();
            if (content === null) {
                self.parameters = false;
            } else if (content.length != 1 || content[0].vars === undefined) {
                console.warn("not a valid role playbook:", content);
                self.parameters = false;
            } else {
                self.parameters = content[0].vars;
            }
            $(self).triggerHandler("changed");
        });

        run_file = cockpit.file("/var/lib/playbooks/" + name + ".run");
        run_file.watch(function (content) {
            var running = (content !== null);
            if (running != self.running) {
                self.running = running;
                $(self).triggerHandler("changed");
            }
        });

        failed_file = cockpit.file("/var/lib/playbooks/" + name + ".failed");
        failed_file.watch(function (content) {
            if (content != self.failed) {
                self.failed = content;
                $(self).triggerHandler("changed");
            }
        });

        return self;
    }

    module.exports = {
        role: role
    };
}());
