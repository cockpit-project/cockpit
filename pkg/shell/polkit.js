/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

var cockpit = require("cockpit");

var AUTHORITY_PATH = "/org/freedesktop/PolicyKit1/Authority";
var AUTHORITY_IFACE = "org.freedesktop.PolicyKit1.Authority";
var AUTHORITY_NAME = "org.freedesktop.PolicyKit1";

var AGENT_PATH = "/org/CockpitProject/PolkitAgent";
var AGENT_IFACE = "org.freedesktop.PolicyKit1.AuthenticationAgent";
var AGENT_INFO = { "methods": {
    "BeginAuthentication": { "in": [ "s", "s", "s", "a{ss}", "s", "a(sa{sv})" ] },
    "CancelAuthentication": { "in": [ "s" ] },
} };

function spawnHelper(path, cookie) {

    /*
     * Older versions of polkit-agent-helper-1 expect the cookie on
     * the command line. The version number was not changed in the binary
     * name. So we account for this by passing the cookie both ways.
     *
     * The commit logs for polkit indicate that cookie guessing should be
     * worthless via the command line due to other fixes.
     */

    var options = {
        "payload": "stream",
        "spawn": [ "/bin/sh", "-c", path + ' $USER ' + cookie ],
        "err": "message",
    };

    var channel = cockpit.channel(options);
    var defer = cockpit.defer();
    var completed = false;

    var buffer = "";
    channel.addEventListener("message", function(ev, data) {
        var lines = (buffer + data).split("\n");
        buffer = lines.pop();

        lines.forEach(function(line) {
            var command, content, pos = line.indexOf(" ");
            if (pos === -1) {
                command = line.trim();
                content = "";
            } else {
                command = line.substr(0, pos);
                content = line.substr(pos + 1).trim();
            }

            if (command == "PAM_PROMPT_ECHO_OFF") {
                channel.control({ "command": "authorize", "credential": "inject" });
                channel.send("\n");
            } else if (command == "PAM_PROMPT_ECHO_ON") {
                channel.send("\n");
            } else if (command == "PAM_ERROR_MSG") {
                console.warn(content);
            } else if (command == "PAM_ERROR_MSG") {
                console.log(content);
            } else if (command == "SUCCESS") {
                complete();
            } else if (command == "FAILURE") {
                complete();
            } else {
                console.warn("unrecognized line from polkit helper:", line);
            }
        });
    });

    channel.addEventListener("close", function(ev, options) {
        if (completed) {
            if (options.message)
                console.log(options.message);
        } else {
            if (options.problem != "not-found")
                console.warn(path + ": " + cockpit.message(options));
            complete(options);
        }
    });

    function complete(options) {
        if (!completed) {
            completed = true;
            channel.close("terminated");
            if (options && options.problem)
                defer.reject(options);
            else
                defer.resolve();
        }
    }

    return defer.promise;
}

function PolkitAgent(options) {
    var self = this;

    /* The information that polkit needs about us. Even though it can look it up itself. */
    var subject = [ "unix-session",
        { "session-id": { 'v': null, 't': 's', 'internal': 'session-id' } }
    ];

    var published = null;
    var authenticating = { };

    var bus = cockpit.dbus(null, {
        host: options.host,
        user: options.user,
        password: options.password,
    });

    /*
     * Because the palkit-agent-helper-1 is installed at different paths on
     * different operating systems we try these different locations.
     *
     * Further logic below when calling spawnHelper.
     */
    var helperPaths = [
        "/usr/lib/polkit-1/polkit-agent-helper-1",
        "/usr/lib/policykit-1/polkit-agent-helper-1"
    ];

    var pathIndex = 0;

    /* Exported AuthenticationAgent function */
    self.BeginAuthentication = function(action_id, message, icon_name, details, cookie, identities) {
        var path = helperPaths[pathIndex];
        var helper = spawnHelper(path, cookie)
            .catch(function(ex) {
                if (ex.problem != "not-found")
                    return; /* Just propagates the failure */

                /*
                 * Try to use the next helper. Note that BeginAuthentication can
                 * be called multiple times in parallel. This is expected. So double
                 * check that the shared state is exactly as we expect.
                 */
                if (path == helperPaths[pathIndex] && pathIndex + 1 < helperPaths.length)
                    pathIndex++;

                /* Now if we or another invocation chose to use a different helper, try that one */
                if (path != helperPaths[pathIndex]) {
                    path = helperPaths[pathIndex];
                    return spawnHelper(path, cookie);
                }

                /* And be pretty clear about how badly this all went */
                console.log("couldn't find polkit helper: " + helperPaths.join(" or "));
            });

        authenticating[cookie] = helper;
        helper.always(function() {
            delete authenticating[cookie];
        });

        return helper;
    };

    /* Exported AuthenticationAgent function */
    self.CancelAuthentication = function(cookie) {
        var helper = authenticating[cookie];
        if (helper)
            helper.cancel();
    };

    function publishAgent() {

        /* First tell the bridge about the introspection data */
        var meta = { };
        meta[AGENT_IFACE] = AGENT_INFO;
        bus.meta(meta);

        /* Now publish the object */
        published = bus.publish(AGENT_PATH, AGENT_IFACE, self);
        return published;
    }

    function registerAgent() {
        return bus.call(AUTHORITY_PATH, AUTHORITY_IFACE,
                        "RegisterAuthenticationAgent",
                        [ subject, "C", AGENT_PATH ],
                        { "type": "(sa{sv})ss", name: AUTHORITY_NAME });
    }

    publishAgent()
        .then(registerAgent)
        .catch(function(ex) {
            console.warn(cockpit.message(ex));
        });
}

module.exports = {
    agent: function(options) {
        return new PolkitAgent(options);
    }
};
