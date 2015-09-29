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

    var cur_dialog;

    function dialog_open(def) {
        // Convert initial values for SizeInput fields to MB.
        def.Fields.forEach(function (f) {
            if (f.SizeInput && f.Value)
                f.ValueMB = (f.Value / (1024*1024)).toFixed(0);
        });

        function toggle_arrow(event) {
            var collapsed = $(this).hasClass('collapsed');
            if (collapsed) {
                $(this).removeClass('collapsed');
                $(this).find('.fa').removeClass('fa-angle-right').addClass('fa-angle-down');
            } else {
                $(this).addClass('collapsed');
                $(this).find('.fa').removeClass('fa-angle-down').addClass('fa-angle-right');
            }
            update_visibility();
        }

        function select_row(event) {
            var tbody = $(this);
            var row = $(event.target).parent('tr');
            tbody.find('tr').removeClass('highlight');
            row.addClass('highlight');
        }

        if (cur_dialog)
            cur_dialog.modal('hide');

        var $dialog = $(mustache.render(storage_dialog_tmpl, def));
        $('body').append($dialog);
        cur_dialog = $dialog;

        $dialog.on('hidden.bs.modal', function () {
            $dialog.remove();
        });

        $dialog.find('.selectpicker').selectpicker();
        $dialog.find('.dialog-arrow').on('click', toggle_arrow);
        $dialog.find('.dialog-select-row-table tbody').on('click', select_row);
        $dialog.find('.dialog-select-row-table tbody tr:first-child').addClass('highlight');

        var invisible = { };

        function get_name(f) {
            return (f.TextInput || f.PassInput || f.SelectOne || f.SelectMany || f.SizeInput ||
                    f.CheckBox || f.Arrow || f.SelectRow);
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
                } else if (f.SelectRow) {
                    $f.find('tbody tr').each(function (i, e) {
                        if ($(e).hasClass('highlight'))
                            vals[n] = f.Rows[i].value;
                    });
                } else if (f.Arrow) {
                    vals[n] = !$f.hasClass('collapsed');
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
            update_visibility();
        });

        function error_field_to_target(err) {
            if (err.field)
                return { message: err.message,
                         target: '[data-field="' + err.field + '"]'
                       };
            else
                return err;
        }

        $dialog.find('button[data-action="apply"]').on('click', function () {
            var vals = get_validated_field_values();
            if (vals !== null) {
                var promise = def.Action.action(vals);
                if (promise) {
                    $dialog.dialog('wait', promise);
                    promise
                        .done(function (result) {
                            $dialog.modal('hide');
                        })
                        .fail(function (err) {
                            if (def.Action.failure_filter)
                                err = def.Action.failure_filter(vals, err);
                            if (err) {
                                if (err.length)
                                    err = err.map(error_field_to_target);
                                else
                                    err = error_field_to_target(err);
                                $dialog.dialog('failure', err);
                            }
                        });
                } else {
                    $dialog.modal('hide');
                }
            }
        });

        update_visibility();
        $dialog.modal('show');
    }

    $(init_dialogs);

    return { open: dialog_open };
});
