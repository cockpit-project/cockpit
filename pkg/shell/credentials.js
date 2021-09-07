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

import cockpit from "cockpit";
import * as sshFile from "./ssh-file-autocomplete.jsx";
import * as credentials from "credentials";
import $ from "jquery";

import React from "react";
import ReactDOM from "react-dom";
import { Switch } from "@patternfly/react-core";

import "./listing.scss";
import "patterns";

const _ = cockpit.gettext;

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
        const body = $("tbody.ssh-add-key-body");
        body.attr("data-name", val);
        body.find("th.credential-label").text(val);
        body.addClass("unlock");
        body.find(".pf-c-alert").hide();
    }

    function add_custom_key() {
        const tr = $("#credentials-dialog tr.load-custom-key");
        const val = tr.find("input").val();
        keys.load(val)
                .then(() => hide_add_key())
                .catch(ex => {
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
            React.createElement(Switch, {
                isChecked: state,
                isDisabled: disabled,
                'aria-label': _("Use key"),
                onChange: enable => onToggleKey(id, enable, tbody)
            }),
            document.querySelector('table.credential-listing tbody[data-id="' + id + '"] .listing-ct-actions'));
    }

    function onToggleKey(id, enable, tbody) {
        const key = keys.items[id];
        if (!key || !key.name)
            return;

        hide_add_key();
        tbody.find(".pf-c-alert").hide();

        /* Key needs to be loaded, show load UI */
        if (enable && !key.loaded) {
            tbody.addClass("open").addClass("unlock");

            /* Key needs to be unloaded, do that directly */
        } else if (!enable && key.loaded) {
            keys.unload(key)
                    .then(() => tbody.removeClass("open"))
                    .catch(ex => {
                        console.log(ex);
                        tbody.addClass("open").removeClass("unlock");
                        tbody.find(".pf-c-alert").show()
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
                hide_add_key();
                if ($(ev.target).parents(".listing-ct-actions, ul").length === 0) {
                    const body = $(ev.target).parents("tbody");
                    body.toggleClass("open").removeClass("unlock");
                    body.find(".pf-c-alert").hide();
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
                const body = $(this).parents("tbody");
                const id = body.attr("data-id");
                const key = keys.items[id];
                let name;

                if (key)
                    name = key.name;
                if (body.hasClass("ssh-add-key-body"))
                    name = body.attr("data-name");

                if (!name)
                    return;

                body.find("input button").prop("disabled", true);
                body.find(".pf-c-alert").hide();

                const password = body.find(".credential-password").val();
                keys.load(name, password)
                        .then(() => {
                            body.find(".credential-password").val("");
                            body.removeClass("unlock");
                            hide_add_key();
                            body.find(".pf-c-alert").hide();
                        })
                        .catch(ex => {
                            body.find(".pf-c-alert").show()
                                    .find("h4")
                                    .text(ex.message);
                            console.warn("loading key failed: ", ex.message);
                        })
                        .finally(() => body.find("input button").prop("disabled", false));
                ev.preventDefault();
                ev.stopPropagation();
            })

    /* Change key */
            .on("click", ".credential-change", function(ev) {
                const body = $(this).parents("tbody");
                const id = body.attr("data-id");
                const key = keys.items[id];
                if (!key || !key.name)
                    return;

                hide_add_key();

                body.find("input button").prop("disabled", true);
                body.find(".pf-c-alert").hide();

                const old_pass = body.find(".credential-old").val();
                const new_pass = body.find(".credential-new").val();
                const two_pass = body.find(".credential-two").val();
                if (old_pass === undefined || new_pass === undefined || two_pass === undefined)
                    throw Error("invalid password fields");

                keys.change(key.name, old_pass, new_pass, two_pass)
                        .finally(() => body.find("input button").prop("disabled", false))
                        .then(() => {
                            body.find(".credential-old").val("");
                            body.find(".credential-new").val("");
                            body.find(".credential-two").val("");
                            body.find("li a").first()
                                    .click();
                        })
                        .catch(ex => {
                            body.find(".pf-c-alert").show()
                                    .find("h4")
                                    .text(ex.message);
                        });
                ev.preventDefault();
                ev.stopPropagation();
            })

            .on("change keypress", "input", function(ev) {
                const body = $(this).parents("tbody");
                if (ev.type == "keypress" && ev.keyCode == 13)
                    $(this).parents("dl")
                            .find(".pf-m-primary")
                            .click();
                body.find(".pf-c-alert").hide();
            })

    /* Change tabs */
            .on("click", "tr.credential-panel ul > li > a", function(ev) {
                const li = $(this).parent();
                const index = li.index();
                li.parent().children()
                        .removeClass("active");
                li.addClass("active");
                const body = $(this).parents("tbody");
                body.find(".credential-tab").prop("hidden", true)
                        .eq(index)
                        .prop("hidden", false);
                body.find(".pf-c-alert").hide();
                ev.preventDefault();
                ev.stopPropagation();
            })

    /* Popover help */
            .on("click", "[data-toggle='popover']", function() {
                $(this).popover('toggle');
            });

    /* Dialog is hidden */
    $("#credentials-modal-close").on("click", function() {
        if (keys) {
            $(keys).off();
            keys.close();
            keys = null;
        }
        hide_add_key();
        $("#credentials-dialog").prop('hidden', true);
    });

    /* Dialog is shown */
    $("#credentials-item").on("click", function() {
        $("#credentials-dialog").prop('hidden', false);

        keys = credentials.keys_instance();

        keys.addEventListener("changed", () => {
            const rows = { };
            const table = $("#credentials-dialog table.credential-listing");

            table.find("tbody[data-id]").each(function(i, el) {
                const row = $(el);
                rows[row.attr("data-id")] = row;
            });

            const body = table.find("tbody.ssh-key-body").first();
            for (const id in keys.items) {
                if (!(id in rows)) {
                    const row = rows[id] = body.clone();
                    row.attr("data-id", id)
                            .removeAttr("hidden");
                    table.append(row);
                }
            }

            function text(row, field, string) {
                const sel = row.find(field);
                string = string || "";
                if (sel.text() !== string)
                    sel.text(string);
            }

            for (const id in rows) {
                const row = rows[id];
                const key = keys.items[id];
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
