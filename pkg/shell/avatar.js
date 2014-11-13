/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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
(function($, shell) {

var crop_handle_width = 20;

var canvas;
var canvas2d;

function fill_canvas(canvas, overlay, data, width, callback)
{
    var img = new window.Image();
    img.onerror = function () {
        shell.show_error_dialog(_("Can't use this file"), _("Can't read it."));
    };
    img.onload = function () {
        canvas.width = width;
        canvas.height = canvas.width * (img.height/img.width);
        overlay.width = canvas.width;
        overlay.height = canvas.height;
        var ctxt = canvas.getContext("2d");
        ctxt.clearRect(0, 0, canvas.width, canvas.height);
        ctxt.drawImage(img, 0, 0, canvas.width, canvas.height);
        callback ();
    };
    img.src = data;
}

function canvas_data(canvas, x1, y1, x2, y2, width, height, format)
{
    var dest = $('<canvas/>')[0];
    dest.width = width;
    dest.height = height;
    var dest_w, dest_h;
    var img_w = x2 - x1, img_h = y2 - y1;
    if (img_w > img_h) {
        dest_w = width;
        dest_h = dest_w * (img_h/img_w);
    } else {
        dest_h = height;
        dest_w = dest_h * (img_w/img_h);
    }
    var ctxt = dest.getContext("2d");
    ctxt.drawImage (canvas,
                    x1, y1, img_w, img_h,
                    (width - dest_w)/2, (height - dest_h)/2, dest_w, dest_h);
    return dest.toDataURL(format);
}

var output_size;
var data_callback;

function setup() {
    $('#change-avatar-file-input').on('change', show_crop_dialog);

    $('#change-avatar-cancel').click(function () {
        $('#change-avatar-dialog').modal('hide');
    });
    $('#change-avatar-apply').click(function () {
        $('#change-avatar-dialog').modal('hide');
        if (data_callback)
            data_callback(canvas_data(canvas,
                                      crop_x, crop_y,
                                      crop_x+crop_s, crop_y+crop_s,
                                      output_size, output_size, "image/png"));
    });

    var $canvas = $('#change-avatar-overlay');
    canvas = $canvas[0];
    canvas2d = canvas.getContext("2d");

    $canvas.on('mousedown', function (ev) {
        var offset = $canvas.offset();
        var xoff = ev.pageX - offset.left - crop_x;
        var yoff = ev.pageY - offset.top - crop_y;

        var orig_x = crop_x;
        var orig_y = crop_y;
        var orig_s = crop_s;

        var proj_sign, dx_sign, dy_sign, ds_sign;

        var h_w = crop_handle_width;

        if (xoff > 0 && yoff > 0 && xoff < crop_s && yoff < crop_s) {
            if (xoff < h_w && yoff < h_w) {
                // top left
                proj_sign = 1;
                dx_sign = 1;
                dy_sign = 1;
                ds_sign = -1;
            } else if (xoff > crop_s - h_w && yoff < h_w) {
                // top right
                proj_sign = -1;
                dx_sign = 0;
                dy_sign = -1;
                ds_sign = 1;
            } else if (xoff < h_w && yoff > crop_s - h_w) {
                // bottom left
                proj_sign = -1;
                dx_sign = 1;
                dy_sign = 0;
                ds_sign = -1;
            } else if (xoff > crop_s - h_w && yoff > crop_s - h_w) {
                // bottom right
                proj_sign = 1;
                dx_sign = 0;
                dy_sign = 0;
                ds_sign = 1;
            } else {
                // center
                proj_sign = 0;
            }

            $('body').on('mousemove.avatar', function (ev) {
                var x = ev.pageX - offset.left - xoff;
                var y = ev.pageY - offset.top - yoff;
                if (proj_sign === 0)
                    set_crop (x, y, orig_s, true);
                else {
                    var d = Math.floor((x - orig_x + proj_sign * (y - orig_y)) / 2);
                    set_crop (orig_x + dx_sign*d, orig_y + dy_sign*d, orig_s + ds_sign*d, false);
                }
            });
            $('body').on('mouseup.avatar', function (ev) {
                $('body').off('.avatar');
            });
        }
    });
}

function enter() {
    var size = Math.min (canvas.width, canvas.height);
    set_crop ((canvas.width - size) / 2, (canvas.height - size) / 2, size, true);
}

var crop_x, crop_y, crop_s;

function set_crop(x, y, s, fix) {
    function clamp (low, val, high) {
        if (val < low)
            return low;
        if (val > high)
            return high;
        return val;
    }

    x = Math.floor(x);
    y = Math.floor(y);
    s = Math.floor(s);

    var min_s = 2 * crop_handle_width;

    if (fix) {
        // move it until it fits
        s = clamp (min_s, s, Math.min (canvas.width, canvas.height));
        x = clamp (0, x, canvas.width - s);
        y = clamp (0, y, canvas.height - s);
    } else if (x < 0 || y < 0 || x + s > canvas.width || y + s > canvas.height || s < min_s)
        return;

    crop_x = x;
    crop_y = y;
    crop_s = s;

    draw_crop (x, y, x+s, y+s);
}

function draw_crop(x1,y1,x2,y2) {
    var ctxt;

    function draw_box (x1, y1, x2, y2) {
        ctxt.strokeStyle = 'black';
        ctxt.strokeRect(x1+0.5, y1+0.5, x2-x1-1, y2-y1-1);
        ctxt.strokeStyle = 'white';
        ctxt.strokeRect(x1+1.5, y1+1.5, x2-x1-3, y2-y1-3);
    }

    ctxt = canvas2d;
    ctxt.clearRect(0, 0, canvas.width, canvas.height);
    ctxt.fillStyle = 'rgba(0,0,0,0.8)';
    ctxt.fillRect(0, 0, canvas.width, canvas.height);
    ctxt.clearRect(x1, y1, x2 - x1, y2 - y1);

    var h_w = crop_handle_width;
    draw_box (x1, y1, x1+h_w, y1+h_w);
    draw_box (x2-h_w, y1, x2, y1+h_w);
    draw_box (x1, y2-h_w, x1+h_w, y2);
    draw_box (x2-h_w, y2-h_w, x2, y2);
    draw_box (x1, y1, x2, y2);
}

function show_crop_dialog()
{
    var files, file, reader;
    files = $('#change-avatar-file-input')[0].files;
    if (files.length != 1)
        return;
    file = files[0];
    if (!file.type.match("image.*")) {
        shell.show_error_dialog(_("Can't upload this file"), _("It's not an image."));
        return;
    }
    reader = new window.FileReader();
    reader.onerror = function () {
        shell.show_error_dialog(_("Can't upload this file"), _("Can't read it."));
    };
    reader.onload = function () {
        var canvas = $('#change-avatar-canvas')[0];
        var overlay = $('#change-avatar-overlay')[0];
        fill_canvas(canvas, overlay, reader.result, 256,
                    function () {
                        $('#change-avatar-dialog').modal('show');
                        enter();
                    });
    };
    reader.readAsDataURL(file);
}

shell.change_avatar = function change_avatar(size, callback) {
    output_size = size;
    data_callback = callback;
    if (window.File && window.FileReader)
        $('#change-avatar-file-input').click();
};

$(setup);

})(jQuery, shell);
