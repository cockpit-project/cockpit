/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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

PageDisplayLanguageDialog.prototype = {
    _init: function() {
        this.id = "display-language-dialog";
    },

    getTitle: function() {
        return C_("page-title", "Choose Display Language");
    },

    enter: function(first_visit) {
        // Note: we may not have D-Bus connection available (could be invoked from
        // the login page) so we need to use the cockpitdyn.js mechanism to obtain
        // info to display

        var list = $("#display-language-list");
        var code;
        list.empty();
        for (code in cockpitdyn_supported_languages) {
            var info = cockpitdyn_supported_languages[code];
            var name = info.name;
            var display_name = cockpit_i18n(name, "display-language");
            if (code == cockpit_language_code)
                list.append("<option selected=\"true\" value=\"" + code + "\">" + display_name + "</option>");
            else
                list.append("<option value=\"" + code + "\">" + display_name + "</option>");
        }

        $("#display-language-select-button").on("click", function(event) {
            var code_to_select = list.val();

            // Load via AJAX
            if (code_to_select) {
                var jqxhr = $.getJSON("lang/" + code_to_select + ".json");
                jqxhr.error(function() {
                    cockpit_show_error_dialog("Error loading language \"" + code_to_select + "\"");
                });
                jqxhr.success(function(data) {
                    cockpit_language_code = code_to_select;
                    cockpit_language_po = data[code_to_select];
                    $('#display-language-dialog').modal('hide');
                    // Cool, that worked, update setting
                    cockpit_settings_set("lang-code", code_to_select);
                    cockpit_localize_pages();
                });
            } else {
                // English
                cockpit_language_code = "";
                cockpit_language_po = null;
                // update setting
                cockpit_settings_set("lang-code", null);
                $('#display-language-dialog').modal('hide');
                cockpit_localize_pages();
            }

            return false;
        });
    },

    show: function() {
        $("#display-language-list").focus();
    },

    leave: function() {
        $("#display-language-select-button").off("click");
    }
};

function PageDisplayLanguageDialog() {
    this._init();
}

cockpit_pages.push(new PageDisplayLanguageDialog());
