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

import $ from "jquery";
import cockpit from "cockpit";

import lister from "raw-loader!credentials-ssh-private-keys.sh";
import remove_key from "raw-loader!credentials-ssh-remove-key.sh";

const _ = cockpit.gettext;

function Keys() {
    var self = this;

    self.path = null;
    self.items = { };

    var watch = null;
    var proc = null;
    var timeout = null;

    cockpit.user().done(function (user) {
        self.path = user.home + '/.ssh';
        refresh();
    });

    function refresh() {
        if (watch === null) {
            watch = cockpit.channel({ payload: "fslist1", path: self.path });
            $(watch)
                    .on("close", function(ev, data) {
                        $(watch).off();
                        if (!data.problem || data.problem == "not-found") {
                            watch = null; /* Watch again */
                        } else {
                            console.warn("couldn't watch " + self.path + ": " + (data.message || data.problem));
                            watch = false; /* Don't watch again */
                        }
                    })
                    .on("message", function(ev, payload) {
                        var item = JSON.parse(payload);
                        var name = item.path;
                        if (name && name.indexOf("/") === -1 && name.slice(-4) === ".pub") {
                            if (item.event === "present" || item.event === "created" ||
                            item.event === "changed" || item.event === "deleted") {
                                window.clearInterval(timeout);
                                timeout = window.setTimeout(refresh, 100);
                            }
                        }
                    });
        }

        if (proc)
            return;

        window.clearTimeout(timeout);
        timeout = null;

        proc = cockpit.script(lister, [ self.path ], { err: "message" })
                .always(function() {
                    proc = null;

                    if (!timeout)
                        timeout = window.setTimeout(refresh, 5000);
                })
                .done(function(data) {
                    process(data);
                })
                .fail(function(ex) {
                    console.warn("failed to list keys in home directory: " + ex.message);
                });
    }

    function process(data) {
        var blocks = data.split('\v');
        var key;
        var items = { };

        /* First block is the data from ssh agent */
        blocks[0].trim().split("\n")
                .forEach(function(line) {
                    key = parse_key(line, items);
                    if (key)
                        key.loaded = true;
                });

        /* Next come individual triples of blocks */
        blocks.slice(1).forEach(function(block, i) {
            switch (i % 3) {
            case 0:
                key = parse_key(block, items);
                break;
            case 1:
                if (key) {
                    block = block.trim();
                    if (block.slice(-4) === ".pub")
                        key.name = block.slice(0, -4);
                    else if (block)
                        key.name = block;
                    else
                        key.agent_only = true;
                }
                break;
            case 2:
                if (key)
                    parse_info(block, key);
                break;
            }
        });

        self.items = items;
        $(self).triggerHandler("changed");
    }

    function parse_key(line, items) {
        var parts = line.trim().split(" ");
        var id, type, comment;

        /* SSHv1 keys */
        if (!isNaN(parseInt(parts[0], 10))) {
            id = parts[2];
            type = "RSA1";
            comment = parts.slice(3).join(" ");
        } else if (parts[0].indexOf("ssh-") === 0) {
            id = parts[1];
            type = parts[0].substring(4).toUpperCase();
            comment = parts.slice(2).join(" ");
        } else if (parts[0].indexOf("ecdsa-") === 0) {
            id = parts[1];
            type = "ECDSA";
            comment = parts.slice(2).join(" ");
        } else {
            return;
        }

        var key = items[id];
        if (!key)
            key = items[id] = { };

        key.type = type;
        key.comment = comment;
        key.data = line;
        return key;
    }

    function parse_info(line, key) {
        var parts = line.trim().split(" ");
        parts = parts.filter(function(n) {
            return !!n;
        });

        key.size = parseInt(parts[0], 10);
        if (isNaN(key.size))
            key.size = null;

        key.fingerprint = parts[1];

        if (parts[2] && !key.name && parts[2].indexOf("/") !== -1)
            key.name = parts[2];
    }

    self.change = function change(name, old_pass, new_pass, two_pass) {
        var old_exps = [ /.*Enter old passphrase: $/ ];
        var new_exps = [ /.*Enter new passphrase.*/, /.*Enter same passphrase again: $/ ];
        var bad_exps = [ /.*failed: passphrase is too short.*/ ];

        var dfd = $.Deferred();
        var buffer = "";
        var sent_new = false;
        var failure = _("No such file or directory");
        var i;

        if (new_pass !== two_pass) {
            dfd.reject(new Error(_("The passwords do not match.")));
            return dfd.promise();
        }

        var proc;
        var timeout = window.setTimeout(function() {
            failure = _("Prompting via ssh-keygen timed out");
            proc.close("terminated");
        }, 10 * 1000);

        proc = cockpit.spawn(["ssh-keygen", "-p", "-f", name],
                             { pty: true, environ: [ "LC_ALL=C" ], err: "out", directory: self.path })
                .always(function() {
                    window.clearInterval(timeout);
                })
                .done(function() {
                    dfd.resolve();
                })
                .fail(function(ex) {
                    if (ex.exit_status)
                        ex = new Error(failure);
                    dfd.reject(ex);
                })
                .stream(function(data) {
                    buffer += data;
                    for (i = 0; i < old_exps.length; i++) {
                        if (old_exps[i].test(buffer)) {
                            buffer = "";
                            failure = _("Old password not accepted");
                            this.input(old_pass + "\n", true);
                            return;
                        }
                    }

                    for (i = 0; i < new_exps.length; i++) {
                        if (new_exps[i].test(buffer)) {
                            buffer = "";
                            this.input(new_pass + "\n", true);
                            failure = _("Failed to change password");
                            sent_new = true;
                            return;
                        }
                    }

                    if (sent_new) {
                        for (i = 0; i < bad_exps.length; i++) {
                            if (bad_exps[i].test(buffer)) {
                                failure = _("New password was not accepted");
                                return;
                            }
                        }
                    }
                });

        return dfd.promise();
    };

    self.load = function(name, password) {
        var ask_exp = /.*Enter passphrase for .*/;
        var perm_exp = /.*UNPROTECTED PRIVATE KEY FILE.*/;
        var bad_exp = /.*Bad passphrase.*/;

        var dfd = $.Deferred();
        var buffer = "";
        var output = "";
        var failure = _("Not a valid private key");
        var sent_password = false;

        var proc;
        var timeout = window.setTimeout(function() {
            failure = _("Prompting via ssh-add timed out");
            proc.close("terminated");
        }, 10 * 1000);

        proc = cockpit.spawn(["ssh-add", name],
                             { pty: true, environ: [ "LC_ALL=C" ], err: "out", directory: self.path })
                .always(function() {
                    window.clearInterval(timeout);
                })
                .done(function() {
                    refresh();
                    dfd.resolve();
                })
                .fail(function(ex) {
                    console.log(output);
                    if (ex.exit_status)
                        ex = new Error(failure);

                    ex.sent_password = sent_password;
                    dfd.reject(ex);
                })
                .stream(function(data) {
                    buffer += data;
                    output += data;
                    if (perm_exp.test(buffer)) {
                        failure = _("Invalid file permissions");
                        buffer = "";
                    } else if (ask_exp.test(buffer)) {
                        buffer = "";
                        failure = _("Password not accepted");
                        this.input(password + "\n", true);
                        sent_password = true;
                    } else if (bad_exp.test(buffer)) {
                        buffer = "";
                        this.input("\n", true);
                    }
                });

        return dfd.promise();
    };

    self.unload = function unload(key) {
        var proc;
        var options = { pty: true, err: "message", directory: self.path };

        if (key.name && !key.agent_only)
            proc = cockpit.spawn(["ssh-add", "-d", key.name], options);
        else
            proc = cockpit.script(remove_key, [key.data], options);

        return proc.done(refresh);
    };

    self.close = function close() {
        if (watch)
            watch.close();
        if (proc)
            proc.close();
        window.clearTimeout(timeout);
        timeout = null;
    };
}

export function keys_instance() {
    return new Keys();
}
