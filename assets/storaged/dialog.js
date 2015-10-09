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

define([
    "jquery",
    "base1/mustache",
    "base1/patterns"
], function($, mustache) {

    /* GENERIC STORAGE DIALOG SUPPORT
     */

    var storage_dialog_tmpl;

    function init_dialogs() {
        storage_dialog_tmpl = $("#storage-dialog-tmpl").html();
        mustache.parse(storage_dialog_tmpl);
    }

    function dialog_open(def) {

        // Convert initial values for SizeInput fields to MB.
        def.Fields.forEach(function (f) {
            if (f.SizeInput && f.Value)
                f.ValueMB = (f.Value / (1024*1024)).toFixed(0);
        });

        var $dialog = $(mustache.render(storage_dialog_tmpl, def));
        $('body').append($dialog);
        $dialog.find('.selectpicker').selectpicker();

        var invisible = { };

        function clear_errors() {
            // We leave the actual text in the help-block in order
            // to avoid a annoying relayout of the dialog.
            $dialog.dialog('failure', null);
        }

        function get_name(f) {
            return f.TextInput || f.PassInput || f.SelectOne || f.SelectMany || f.SizeInput || f.CheckBox;
        }

        function get_field_values() {
            var vals = { };

            def.Fields.forEach(function (f) {
                var n = get_name(f);
                var $f = $dialog.find('[data-field="' + n + '"]');
                if (f.TextInput)
                    vals[n] = $f.val();
                else if (f.PassInput)
                    vals[n] = $f.val();
                else if (f.SelectOne)
                    vals[n] = $f.val();
                else if (f.SizeInput)
                    vals[n] = parseInt($f.val())*1024*1024;
                else if (f.CheckBox)
                    vals[n] = $f.prop('checked');
                else if (f.SelectMany) {
                    vals[n] = [ ];
                    $f.find('input').each(function (i, e) {
                        if (e.checked)
                            vals[n].push(f.Options[i].value);
                    });
                }
            });

            return vals;
        }

        function update_visibility() {
            var vals = get_field_values();

            def.Fields.forEach(function (f) {
                if (f.visible) {
                    var n = get_name(f);
                    invisible[n] = !f.visible(vals);
                    $dialog.find('[data-field="' + n + '"]').parents('tr').toggle(!invisible[n]);
                }
            });
        }

        function get_validated_field_values() {
            var vals = get_field_values();

            var errors = [ ];
            def.Fields.forEach(function (f) {
                var n = get_name(f);
                if (invisible[n])
                    vals[n] = undefined;
                else {
                    if (f.validate) {
                        var msg = f.validate(vals[n], vals);
                        if (msg) {
                            var err = new Error(msg);
                            err.target = '[data-field="' + n + '"]';
                            errors.push(err);
                        }
                    }
                }
            });

            $dialog.dialog('failure', errors);
            return (errors.length === 0)? vals : null;
        }

        $dialog.on('change input', function () {
            clear_errors();
            update_visibility();
        });

        $dialog.on('hidden.bs.modal', function () {
            $dialog.remove();
        });

        $dialog.find('button[data-action="apply"]').on('click', function () {
            var vals = get_validated_field_values();
            if (vals !== null) {
                var promise = def.Action.action(vals);
                $dialog.dialog('promise', promise);
            }
        });

        update_visibility();
        $dialog.modal('show');
    }

    $(init_dialogs);

    return { open: dialog_open };
});
