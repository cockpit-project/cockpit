/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

import * as sshFile from "./ssh-file-autocomplete.jsx";
import * as credentials from "credentials";
import $ from "jquery";

import React from "react";
import ReactDOM from "react-dom";
import { OnOffSwitch } from "cockpit-components-onoff.jsx";

import "listing.less";
import "patterns";

export function setup() {
    var keys;

    function hide_add_key() {
        $("tbody.ssh-add-key-body").attr("data-name", "");
        $("tbody.ssh-add-key-body").toggleClass("unlock", false);
        $("#credentials-dialog tr.load-custom-key").toggleClass("hidden", true);
        $("#credentials-dialog tr.load-custom-key td").toggleClass("has-error", false);
        sshFile.remove(document.getElementById('ssh-file-container'));
    }

    function show_pending(val) {
        var body = $("tbody.ssh-add-key-body");
        body.attr("data-name", val);
        body.find("th.credential-label").text(val);
        body.addClass("unlock");
        body.find(".alert").hide();
    }

    function add_custom_key() {
        var tr = $("#credentials-dialog tr.load-custom-key");
        var val = tr.find("input").val();
        keys.load(val)
                .done(function () {
                    hide_add_key();
                })
                .fail(function(ex) {
                    if (!ex.sent_password) {
                        tr.find("td").toggleClass("has-error", true);
                        tr.find("td div.dialog-error").text(ex.message);
                    } else {
                        hide_add_key();
                        show_pending(val);
                    }
                });
    }

    function renderKeyOnOff(id, state, disabled, tbody) {
        ReactDOM.render(
            React.createElement(OnOffSwitch, {
                state: state,
                disabled: disabled,
                onChange: enable => onToggleKey(id, enable, tbody)
            }),
            document.querySelector('table.credential-listing tbody[data-id="' + id + '"] .listing-ct-actions'));
    }

    function onToggleKey(id, enable, tbody) {
        var key = keys.items[id];
        if (!key || !key.name)
            return;

        hide_add_key();
        tbody.find(".alert").hide();

        /* Key needs to be loaded, show load UI */
        if (enable && !key.loaded) {
            tbody.addClass("open").addClass("unlock");

            /* Key needs to be unloaded, do that directly */
        } else if (!enable && key.loaded) {
            keys.unload(key)
                    .done(function(ex) {
                        tbody.removeClass("open");
                    })
                    .fail(function(ex) {
                        console.log(ex);
                        tbody.addClass("open").removeClass("unlock");
                        tbody.find(".alert").show()
                                .find(".credential-alert")
                                .text(ex.message);
                    });
        }

        renderKeyOnOff(id, enable, false, tbody);
    }

    $("#credentials-dialog")

    /* Show and hide panels */
            .on("click", "#credential-keys a", function(ev) {
                hide_add_key();
                sshFile.render(document.getElementById('ssh-file-container'));
                $("#credentials-dialog tr.load-custom-key").toggleClass("hidden", false);
                $("#credentials-dialog tr.load-custom-key input").focus();
                ev.preventDefault();
                ev.stopPropagation();
            })

            .on("click", "tr.load-custom-key button", function(ev) {
                add_custom_key();
                ev.preventDefault();
                ev.stopPropagation();
            })

            .on("keypress", "tr.load-custom-key button", function(ev) {
                if (ev.which == 13)
                    add_custom_key();
            })

            .on("keypress", "tr.load-custom-key input", function(ev) {
                if (ev.which == 13) {
                    $("#credentials-dialog tr.load-custom-key button").focus();
                    add_custom_key();
                }
            })

    /* Show and hide panels */
            .on("click", "tr.listing-ct-item", function(ev) {
                var body;
                hide_add_key();
                if ($(ev.target).parents(".listing-ct-actions, ul").length === 0) {
                    body = $(ev.target).parents("tbody");
                    body.toggleClass("open").removeClass("unlock");
                    body.find(".alert").hide();
                    ev.preventDefault();
                    ev.stopPropagation();
                }
            })

    /* Highlighting */
            .on("mouseenter", ".listing-ct-item", function(ev) {
                $(ev.target).parents("tbody")
                        .find(".listing-ct-item")
                        .addClass("highlight-ct");
            })
            .on("mouseleave", ".listing-ct-item", function(ev) {
                $(ev.target).parents("tbody")
                        .find(".listing-ct-item")
                        .removeClass("highlight-ct");
            })

    /* Load key */
            .on("click", ".credential-unlock button", function(ev) {
                var body = $(this).parents("tbody");
                var id = body.attr("data-id");
                var key = keys.items[id];
                var name;

                if (key)
                    name = key.name;
                if (body.hasClass("ssh-add-key-body"))
                    name = body.attr("data-name");

                if (!name)
                    return;

                body.find("input button").prop("disabled", true);
                body.find(".alert").hide();

                var password = body.find(".credential-password").val();
                keys.load(name, password)
                        .always(function(ex) {
                            body.find("input button").prop("disabled", false);
                        })
                        .done(function(ex) {
                            body.find(".credential-password").val("");
                            body.removeClass("unlock");
                            hide_add_key();
                            body.find(".alert").hide();
                        })
                        .fail(function(ex) {
                            body.find(".alert").show()
                                    .find("span")
                                    .text(ex.message);
                            console.warn("loading key failed: ", ex.message);
                        });
                ev.preventDefault();
                ev.stopPropagation();
            })

    /* Change key */
            .on("click", ".credential-change", function(ev) {
                var body = $(this).parents("tbody");
                var id = body.attr("data-id");
                var key = keys.items[id];
                if (!key || !key.name)
                    return;

                hide_add_key();

                body.find("input button").prop("disabled", true);
                body.find(".alert").hide();

                var old_pass = body.find(".credential-old").val();
                var new_pass = body.find(".credential-new").val();
                var two_pass = body.find(".credential-two").val();
                if (old_pass === undefined || new_pass === undefined || two_pass === undefined)
                    throw Error("invalid password fields");

                keys.change(key.name, old_pass, new_pass, two_pass)
                        .always(function(ex) {
                            body.find("input button").prop("disabled", false);
                        })
                        .done(function() {
                            body.find(".credential-old").val("");
                            body.find(".credential-new").val("");
                            body.find(".credential-two").val("");
                            body.find("li a").first()
                                    .click();
                        })
                        .fail(function(ex) {
                            body.find(".alert").show()
                                    .find("span")
                                    .text(ex.message);
                        });
                ev.preventDefault();
                ev.stopPropagation();
            })

            .on("change keypress", "input", function(ev) {
                var body = $(this).parents("tbody");
                if (ev.type == "keypress" && ev.keyCode == 13)
                    $(this).parents("dl")
                            .find(".btn-primary")
                            .click();
                body.find(".alert").hide();
            })

    /* Change tabs */
            .on("click", "tr.credential-panel ul > li > a", function(ev) {
                var li = $(this).parent();
                var index = li.index();
                li.parent().children()
                        .removeClass("active");
                li.addClass("active");
                var body = $(this).parents("tbody");
                body.find(".credential-tab").hide()
                        .eq(index)
                        .show();
                body.find(".alert").hide();
                ev.preventDefault();
                ev.stopPropagation();
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
                hide_add_key();
            })

    /* Dialog is shown */
            .on("show.bs.modal", function() {
                keys = credentials.keys_instance();

                $(keys).on("changed", function() {
                    var key, id, row;
                    var rows = { };
                    var table = $("#credentials-dialog table.credential-listing");

                    table.find("tbody[data-id]").each(function(i, el) {
                        row = $(el);
                        rows[row.attr("data-id")] = row;
                    });

                    var body = table.find("tbody.ssh-key-body").first();
                    for (id in keys.items) {
                        if (!(id in rows)) {
                            row = rows[id] = body.clone();
                            row.attr("data-id", id)
                                    .removeAttr("hidden");
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
                                    .attr("data-loaded", key.loaded ? "1" : "0");

                            renderKeyOnOff(id, key.loaded || row.hasClass("unlock"), !key.name, row);
                        } else if (id !== "adding") {
                            row.remove();
                        }
                    }
                });
            });
}
