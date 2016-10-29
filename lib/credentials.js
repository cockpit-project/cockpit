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

    require("listing.css");
    require("patterns");

    var lister = require("raw!credentials-ssh-private-keys.sh");

    var _ = cockpit.gettext;

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
                            if (item.event === "present" ||item.event === "created" ||
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
            var key, items = { };

            /* First block is the data from ssh agent */
            blocks[0].trim().split("\n").forEach(function(line) {
                key = parse_key(line, items);
                if (key)
                    key.loaded = true;
            });

            /* Next come individual triples of blocks */
            blocks.slice(1).forEach(function(block, i) {
                switch(i % 3) {
                case 0:
                    key = parse_key(block, items);
                    break;
                case 1:
                    if (key) {
                        block = block.trim();
                        if (block.slice(-4) === ".pub")
                            key.name = block.slice(0, -4);
                        else
                            key.name = block;
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

            key.size = parseInt(parts[0], 10);
            if (isNaN(key.size))
                key.size = null;

            key.fingerprint = parts[1];
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

            var timeout = window.setTimeout(function() {
                failure = _("Prompting via ssh-keygen timed out");
                proc.close("terminated");
            }, 10 * 1000);

            var proc = cockpit.spawn(["ssh-keygen", "-p", "-f", name],
                    { pty: true, environ: [ "LC_ALL=C" ], err: "out", directory: self.path })
                .always(function() {
                    window.clearInterval(timeout);
                })
                .done(function() {
                    dfd.resolve();
                })
                .fail(function(ex) {
                    if (ex.constructor.name == "ProcessError")
                        ex = new Error(failure);
                    dfd.reject(ex);
                })
                .stream(function(data) {
                    buffer += data;
                    for (i = 0; i < old_exps.length; i++) {
                        if (old_exps[i].test(buffer)) {
                            buffer = "";
                            failure = _("Old password not accepted");
                            proc.input(old_pass + "\n", true);
                            return;
                        }
                    }

                    for (i = 0; i < new_exps.length; i++) {
                        if (new_exps[i].test(buffer)) {
                            buffer = "";
                            proc.input(new_pass + "\n", true);
                            failure = _("Failed to change password");
                            sent_new = true;
                            return;
                        }
                    }

                    for (i = 0; sent_new && i < bad_exps.length; i++) {
                        if (bad_exps[i].test(buffer)) {
                            failure = _("New password was not accepted");
                            return;
                        }
                    }
                });

            return dfd.promise();
        };

        self.load = function(name, password) {
            var ask_exp =  /.*Enter passphrase for .*/;
            var perm_exp = /.*UNPROTECTED PRIVATE KEY FILE.*/;
            var bad_exp = /.*Bad passphrase.*/;

            var dfd = $.Deferred();
            var buffer = "";
            var output = "";
            var failure = _("Not a valid private key");

            var timeout = window.setTimeout(function() {
                failure = _("Prompting via ssh-add timed out");
                proc.close("terminated");
            }, 10 * 1000);

            var proc = cockpit.spawn(["ssh-add", name],
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
                    if (ex.constructor.name == "ProcessError")
                        ex = new Error(failure);
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
                        proc.input(password + "\n", true);
                    } else if (bad_exp.test(buffer)) {
                        buffer = "";
                        proc.input("\n", true);
                    }
                });

            return dfd.promise();
        };

        self.unload = function unload(name) {
            return cockpit.spawn(["ssh-add", "-d", name],
                    { pty: true, err: "message", directory: self.path })
                .done(refresh);
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

    function setup() {
        var keys;

        /* The button to deauthorize cockpit */
        $("#credential-authorize button").on("click", function(ev) {
            $("#credential-authorize").remove();
            cockpit.drop_privileges(false);
            ev.preventDefault();
        });

        $("#credentials-dialog")

            /* Show and hide panels */
            .on("click", "tr.listing-ct-item", function(ev) {
                var body, open;
                if ($(ev.target).parents(".listing-ct-actions, ul").length === 0) {
                    body = $(ev.target).parents("tbody");
                    body.toggleClass("open").removeClass("unlock");
                    body.find(".alert").hide();
                }
            })

            /* Highlighting */
            .on("mouseenter", ".listing-ct-item", function(ev) {
                $(ev.target).parents("tbody").find(".listing-ct-item").addClass("highlight-ct");
            })
            .on("mouseleave", ".listing-ct-item", function(ev) {
                $(ev.target).parents("tbody").find(".listing-ct-item").removeClass("highlight-ct");
            })

            /* Load and unload keys */
            .on("change", ".btn-group", function(ev) {
                var body = $(this).parents("tbody");
                var id = body.attr("data-id");
                var key = keys.items[id];
                if (!key || !key.name)
                    return;

                var value = $(this).onoff("value");

                /* Key needs to be loaded, show load UI */
                if (value && !key.loaded) {
                    body.addClass("open").addClass("unlock");

                /* Key needs to be unloaded, do that directly */
                } else if (!value && key.loaded) {
                    keys.unload(key.name)
                        .done(function(ex) {
                            body.removeClass("open");
                        })
                        .fail(function(ex) {
                            body.addClass("open").removeClass("unlock");
                            body.find(".alert").show().find(".credential-alert").text(ex.message);
                        });
                }
            })

            /* Load key */
            .on("click", ".credential-unlock button", function(ev) {
                var body = $(this).parents("tbody");
                var id = body.attr("data-id");
                var key = keys.items[id];
                if (!key || !key.name)
                    return;

                body.find("input button").prop("disabled", true);

                var password = body.find(".credential-password").val();
                keys.load(key.name, password)
                    .always(function(ex) {
                        body.find("input button").prop("disabled", false);
                    })
                    .done(function(ex) {
                        body.find(".credential-password").val("");
                        body.removeClass("unlock");
                        body.find(".alert").hide();
                    })
                    .fail(function(ex) {
                        body.find(".alert").show().find("span").text(ex.message);
                        console.warn("loading key failed: ", ex.message);
                    });
            })

            /* Change key */
            .on("click", ".credential-change", function(ev) {
                var body = $(this).parents("tbody");
                var id = body.attr("data-id");
                var key = keys.items[id];
                if (!key || !key.name)
                    return;

                body.find("input button").prop("disabled", true);

                var old_pass = body.find(".credential-old").val();
                var new_pass = body.find(".credential-new").val();
                var two_pass = body.find(".credential-two").val();
                if (old_pass === undefined || new_pass === undefined || two_pass === undefined)
                    throw "invalid password fields";

                keys.change(key.name, old_pass, new_pass, two_pass)
                    .always(function(ex) {
                        body.find("input button").prop("disabled", false);
                    })
                    .done(function() {
                        body.find(".credential-old").val("");
                        body.find(".credential-new").val("");
                        body.find(".credential-two").val("");
                        body.find("li a").first().click();
                    })
                    .fail(function(ex) {
                        body.find(".alert").show().find("span").text(ex.message);
                    });
            })

            .on("change keypress", "input", function(ev) {
                var dl, body = $(this).parents("tbody");
                if (ev.type == "keypress" && ev.keyCode == 13)
                    $(this).parents("dl").find(".btn-primary").click();
                body.find(".alert").hide();
            })

            /* Change tabs */
            .on("click", "tr.credential-panel ul > li > a", function() {
                var li = $(this).parent();
                var index = li.index();
                li.parent().children().removeClass("active");
                li.addClass("active");
                var body = $(this).parents("tbody");
                body.find(".credential-tab").hide().eq(index).show();
                body.find(".alert").hide();
            })

            /* Popover help */
            .on("click", "[data-toggle='popover']", function() {
                $(this).popover('toggle');
            })

            /* Dialog is hidden */
            .on("hide.bs.modal", function() {
                if (keys) {
                    $(keys).off();
                    keys.close();
                    keys = null;
                }
            })

            /* Dialog is shown */
            .on("show.bs.modal", function() {
                keys = new Keys();
                $("#credential-keys").toggleClass("hidden",
                                                  $.isEmptyObject(keys.items));

                $(keys).on("changed", function() {
                    var key, id, row, rows = { };
                    var table = $("#credentials-dialog table.credential-listing");

                    table.find("tbody[data-id]").each(function(i, el) {
                        row = $(el);
                        rows[row.attr("data-id")] = row;
                    });

                    var body = table.find("tbody").first();
                    for (id in keys.items) {
                        if (!(id in rows)) {
                            row = rows[id] = body.clone();
                            row.attr("data-id", id)
                                .show()
                                .onoff();
                            table.append(row);
                        }
                    }

                    function text(row, field, string) {
                        var sel = row.find(field);
                        string = string || "";
                        if (sel.text() !== string)
                            sel.text(string);
                    }

                    for (id in rows) {
                        row = rows[id];
                        key = keys.items[id];
                        if (key) {
                            text(row, ".credential-label", key.name || key.comment);
                            text(row, ".credential-type", key.type);
                            text(row, ".credential-fingerprint", key.fingerprint);
                            text(row, ".credential-comment", key.comment);
                            text(row, ".credential-data", key.data);
                            row.attr("data-name", key.name)
                                .attr("data-loaded", key.loaded ? "1" : "0")
                                .find(".btn-onoff-ct")
                                    .onoff("value", key.loaded || row.hasClass("unlock"))
                                    .onoff("disabled", !key.name);
                        } else {
                            row.remove();
                        }
                        $("#credential-keys").toggleClass("hidden",
                                                          $.isEmptyObject(keys.items));
                    }
                });
            });
        }

    module.exports = {
        keys_instance: function () {
            return new Keys();
        },
        setup: setup
    };
}());
