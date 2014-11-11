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

var shell = shell || { };
(function($, cockpit, shell) {

/*
 * Note that we don't go ahead and load all the po files in order
 * to produce this list. Perhaps we would include it somewhere in a
 * separate automatically generated file. Need to see.
 */
var names = {
    "da": "Dansk",
    "de": "Deutsch",
    "en": "English"
};

PageDisplayLanguageDialog.prototype = {
    _init: function() {
        this.id = "display-language-dialog";
    },

    enter: function() {
        $("#display-language-list").empty();
        cockpit.packages.lookup("shell").
            done(function(pkg) {
                $.each(pkg.manifest.linguas, function(i, code) {
                    var name = names[code] || code;
                    var $el = $("<option>").text(name).val(code);
                    if (code == shell.language_code)
                        $el.attr("selected", "true");
                    $("#display-language-list").append($el);
                });
            }).
            fail(function(ex) {
                console.warn("Couldn't load languages: " + ex);
            });

        $("#display-language-select-button").on("click", function(event) {
            var code_to_select = $("#display-language-list").val();
            document.cookie = "cockpitlang=" + code_to_select;
            window.location.reload(true);
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

shell.dialogs.push(new PageDisplayLanguageDialog());

})(jQuery, cockpit, shell);
