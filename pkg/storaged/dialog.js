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

    var mustache = require("mustache");
    require("patterns");

    var _ = cockpit.gettext;

    /* GENERIC STORAGE DIALOG SUPPORT
     */

    var storage_dialog_tmpl;

    function init_dialogs() {
        storage_dialog_tmpl = $("#storage-dialog-tmpl").html();
        mustache.parse(storage_dialog_tmpl);
    }

    var cur_dialog;

    function dialog_open(def) {

        def.Fields.forEach(function (f) {
            // Convert initial values for SizeInput fields to MB.
            if (f.SizeInput && f.Value)
                f.ValueMB = (f.Value / (1024*1024)).toFixed(0);

            // Put in the Units for SizeSliders
            if (f.SizeSlider && !f.Units)
                f.Units = cockpit.get_byte_units(f.Value || f.Max);
        });


        function toggle_arrow(event) {
            /* jshint validthis:true */
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
            /* jshint validthis:true */
            var tbody = $(this);
            var row = $(event.target).parent('tr');
            tbody.find('tr').removeClass('highlight-ct');
            row.addClass('highlight-ct');
        }

        if (cur_dialog)
            cur_dialog.modal('hide');

        var $dialog = $(mustache.render(storage_dialog_tmpl, def));
        $('body').append($dialog);
        cur_dialog = $dialog;

        $dialog.on('hidden.bs.modal', function () {
            $dialog.remove();
        });

        $dialog.find('.dialog-arrow').on('click', toggle_arrow);
        $dialog.find('.dialog-select-row-table tbody').on('click', select_row);
        $dialog.find('.dialog-select-row-table tbody tr:first-child').addClass('highlight-ct');

        /* Dropdowns
         */

        function dropdown_option_clicked(target) {
            if (target.hasClass("disabled"))
                return false;
            var parent = target.parents(".dropdown");
            parent.find("button span").first().text(target.text());
            parent.val(target.attr("value"));
            parent.find("li.selected").removeClass("selected");
            target.addClass("selected");
            parent.trigger("change", [ ]);
        }

        $dialog.on("click", ".dropdown li[value]", function(ev) {
            return dropdown_option_clicked($(this));
        });

        $dialog.find(".dropdown").each(function (i, parent) {
            var selected;
            $(parent).find("li[value]").each(function (i, target) {
                if (!selected || $(target).attr("selected"))
                    selected = $(target);
            });
            dropdown_option_clicked(selected);
        });

        /* Size sliders
         */

        function setup_size_slider(field) {
            var value = field.Value || field.Max;
            var parent = $dialog.find('[data-field="' + field.SizeSlider + '"]');
            var slider = $("<div class='slider'>").
                append($("<div class='slider-bar'>").
                    append($("<div class='slider-thumb'>")));
            $(slider).slider();

            parent.data('max', field.Max);
            parent.data('round', field.Round);
            parent.find('.slider').replaceWith(slider);

            $(slider).on('change', size_slider_changed);
            parent.find('.size-text').on('change', size_text_changed);
            parent.find('.size-unit').on('change', size_unit_changed);

            slider.prop("value", value / field.Max);
            slider.trigger("change", [value / field.Max]);
        }

        function size_slider_changed(event, value) {
            /* jshint validthis:true */
            var parent = $(this).parents('.size-slider');
            var input = parent.find('.size-text');
            var unit = parent.find('.size-unit');
            var max = parent.data('max');
            var round = parent.data('round');

            value *= max;
            if (round)
                value = Math.round(value / round) * round;

            if (value < 0)
                value = 0;
            if (value > max)
                value = max;

            parent.val(value);
            input.val(cockpit.format_number(value / +unit.val()));
        }

        function size_text_changed(event) {
            /* jshint validthis:true */
            var input = $(this);
            var parent = input.parents('.size-slider');
            var unit = parent.find('.size-unit');
            var unit_val = +unit.val();
            var slider = parent.find('.slider');
            var max = parent.data('max');
            var value = +input.val() * unit_val;

            // As a special case, if the user types something that
            // looks like the maximum when formatted, always use
            // exactly the maximum.  Otherwise we have the confusing
            // possibility that with the exact same string in the text
            // input, the size is sometimes too large and sometimes
            // not.

            var max_fmt = cockpit.format_number(max / unit_val);
            var max_parse = +max_fmt * unit_val;

            if (value == max_parse)
                value = max;

            slider.prop("value", value / max);
            parent.val(value);
        }

        function size_unit_changed(event) {
            /* jshint validthis:true */
            var unit = $(this);
            var parent = unit.parents('.size-slider');
            var input = parent.find('.size-text');

            input.val(cockpit.format_number(+parent.val() / +unit.val()));
        }

        def.Fields.forEach(function (f) {
            if (f.SizeSlider) {
                setup_size_slider(f);
            }
        });

        var invisible = { };

        function get_name(f) {
            return (f.TextInput || f.PassInput || f.SelectOne || f.SelectMany || f.SizeInput ||
                    f.SizeSlider || f.CheckBox || f.Arrow || f.SelectRow);
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
                    vals[n] = parseInt($f.val(), 10)*1024*1024;
                else if (f.SizeSlider)
                    vals[n] = parseInt($f.val(), 10);
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
                        if ($(e).hasClass('highlight-ct'))
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

        function validate_field(field, val, vals) {
            var msg = null;

            if (field.SizeSlider) {
                if (isNaN(val))
                    msg = _("Size must be a number");
                if (val === 0)
                    msg = _("Size cannot be zero");
                if (val < 0)
                    msg = _("Size cannot be negative");
                if (!field.AllowInfinite && val > field.Max)
                    msg = _("Size is too large");
            }

            if (field.validate)
                msg = field.validate(val, vals);

            return msg;
        }

        function get_validated_field_values() {
            var vals = get_field_values();

            var errors = [ ];
            def.Fields.forEach(function (f) {
                var n = get_name(f);
                if (invisible[n])
                    vals[n] = undefined;
                else {
                    var msg = validate_field(f, vals[n], vals);
                    if (msg) {
                        var err = new Error(msg);
                        err.target = '[data-field="' + n + '"]';
                        errors.push(err);
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

    module.exports = { open: dialog_open };
}());
