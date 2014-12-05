/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2012 Joel Martin
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

/*jslint browser: true, white: false */
/*global Util, Base64, changeCursor */

var Display;

(function () {
    "use strict";

    Display = function (defaults) {
        this._drawCtx = null;
        this._c_forceCanvas = false;

        this._renderQ = [];  // queue drawing actions for in-oder rendering

        // the full frame buffer (logical canvas) size
        this._fb_width = 0;
        this._fb_height = 0;

        // the visible "physical canvas" viewport
        this._viewportLoc = { 'x': 0, 'y': 0, 'w': 0, 'h': 0 };
        this._cleanRect = { 'x1': 0, 'y1': 0, 'x2': -1, 'y2': -1 };

        this._prevDrawStyle = "";
        this._tile = null;
        this._tile16x16 = null;
        this._tile_x = 0;
        this._tile_y = 0;

        Util.set_defaults(this, defaults, {
            'true_color': true,
            'colourMap': [],
            'scale': 1.0,
            'viewport': false,
            'render_mode': ''
        });

        Util.Debug(">> Display.constructor");

        if (!this._target) {
            throw new Error("Target must be set");
        }

        if (typeof this._target === 'string') {
            throw new Error('target must be a DOM element');
        }

        if (!this._target.getContext) {
            throw new Error("no getContext method");
        }

        if (!this._drawCtx) {
            this._drawCtx = this._target.getContext('2d');
        }

        Util.Debug("User Agent: " + navigator.userAgent);
        if (Util.Engine.gecko) { Util.Debug("Browser: gecko " + Util.Engine.gecko); }
        if (Util.Engine.webkit) { Util.Debug("Browser: webkit " + Util.Engine.webkit); }
        if (Util.Engine.trident) { Util.Debug("Browser: trident " + Util.Engine.trident); }
        if (Util.Engine.presto) { Util.Debug("Browser: presto " + Util.Engine.presto); }

        this.clear();

        // Check canvas features
        if ('createImageData' in this._drawCtx) {
            this._render_mode = 'canvas rendering';
        } else {
            throw new Error("Canvas does not support createImageData");
        }

        if (this._prefer_js === null) {
            Util.Info("Prefering javascript operations");
            this._prefer_js = true;
        }

        // Determine browser support for setting the cursor via data URI scheme
        var curDat = [];
        for (var i = 0; i < 8 * 8 * 4; i++) {
            curDat.push(255);
        }
        try {
            var curSave = this._target.style.cursor;
            Display.changeCursor(this._target, curDat, curDat, 2, 2, 8, 8);
            if (this._target.style.cursor) {
                if (this._cursor_uri === null || this._cursor_uri === undefined) {
                    this._cursor_uri = true;
                }
                Util.Info("Data URI scheme cursor supported");
            } else {
                if (this._cursor_uri === null || this._cursor_uri === undefined) {
                    this._cursor_uri = false;
                }
                Util.Warn("Data URI scheme cursor not supported");
            }
            this._target.style.cursor = curSave;
        } catch (exc) {
            Util.Error("Data URI scheme cursor test exception: " + exc);
            this._cursor_uri = false;
        }

        Util.Debug("<< Display.constructor");
    };

    Display.prototype = {
        // Public methods
        viewportChange: function (deltaX, deltaY, width, height) {
            var vp = this._viewportLoc;
            var cr = this._cleanRect;
            var canvas = this._target;

            if (!this._viewport) {
                Util.Debug("Setting viewport to full display region");
                deltaX = -vp.w;  // clamped later of out of bounds
                deltaY = -vp.h;
                width = this._fb_width;
                height = this._fb_height;
            }

            if (typeof(deltaX) === "undefined") { deltaX = 0; }
            if (typeof(deltaY) === "undefined") { deltaY = 0; }
            if (typeof(width) === "undefined") { width = vp.w; }
            if (typeof(height) === "undefined") { height = vp.h; }

            // Size change
            if (width > this._fb_width) { width = this._fb_width; }
            if (height > this._fb_height) { height = this._fb_height; }

            if (vp.w !== width || vp.h !== height) {
                // Change width
                if (width < vp.w &&  cr.x2 > vp.x + width - 1) {
                    cr.x2 = vp.x + width - 1;
                }
                vp.w = width;

                // Change height
                if (height < vp.h &&  cr.y2 > vp.y + height - 1) {
                    cr.y2 = vp.y + height - 1;
                }
                vp.h = height;

                var saveImg = null;
                if (vp.w > 0 && vp.h > 0 && canvas.width > 0 && canvas.height > 0) {
                    var img_width = canvas.width < vp.w ? canvas.width : vp.w;
                    var img_height = canvas.height < vp.h ? canvas.height : vp.h;
                    saveImg = this._drawCtx.getImageData(0, 0, img_width, img_height);
                }

                canvas.width = vp.w;
                canvas.height = vp.h;

                if (saveImg) {
                    this._drawCtx.putImageData(saveImg, 0, 0);
                }
            }

            var vx2 = vp.x + vp.w - 1;
            var vy2 = vp.y + vp.h - 1;

            // Position change

            if (deltaX < 0 && vp.x + deltaX < 0) {
                deltaX = -vp.x;
            }
            if (vx2 + deltaX >= this._fb_width) {
                deltaX -= vx2 + deltaX - this._fb_width + 1;
            }

            if (vp.y + deltaY < 0) {
                deltaY = -vp.y;
            }
            if (vy2 + deltaY >= this._fb_height) {
                deltaY -= (vy2 + deltaY - this._fb_height + 1);
            }

            if (deltaX === 0 && deltaY === 0) {
                return;
            }
            Util.Debug("viewportChange deltaX: " + deltaX + ", deltaY: " + deltaY);

            vp.x += deltaX;
            vx2 += deltaX;
            vp.y += deltaY;
            vy2 += deltaY;

            // Update the clean rectangle
            if (vp.x > cr.x1) {
                cr.x1 = vp.x;
            }
            if (vx2 < cr.x2) {
                cr.x2 = vx2;
            }
            if (vp.y > cr.y1) {
                cr.y1 = vp.y;
            }
            if (vy2 < cr.y2) {
                cr.y2 = vy2;
            }

            var x1, w;
            if (deltaX < 0) {
                // Shift viewport left, redraw left section
                x1 = 0;
                w = -deltaX;
            } else {
                // Shift viewport right, redraw right section
                x1 = vp.w - deltaX;
                w = deltaX;
            }

            var y1, h;
            if (deltaY < 0) {
                // Shift viewport up, redraw top section
                y1 = 0;
                h = -deltaY;
            } else {
                // Shift viewport down, redraw bottom section
                y1 = vp.h - deltaY;
                h = deltaY;
            }

            // Copy the valid part of the viewport to the shifted location
            var saveStyle = this._drawCtx.fillStyle;
            this._drawCtx.fillStyle = "rgb(255,255,255)";
            if (deltaX !== 0) {
                this._drawCtx.drawImage(canvas, 0, 0, vp.w, vp.h, -deltaX, 0, vp.w, vp.h);
                this._drawCtx.fillRect(x1, 0, w, vp.h);
            }
            if (deltaY !== 0) {
                this._drawCtx.drawImage(canvas, 0, 0, vp.w, vp.h, 0, -deltaY, vp.w, vp.h);
                this._drawCtx.fillRect(0, y1, vp.w, h);
            }
            this._drawCtx.fillStyle = saveStyle;
        },

        // Return a map of clean and dirty areas of the viewport and reset the
        // tracking of clean and dirty areas
        //
        // Returns: { 'cleanBox': { 'x': x, 'y': y, 'w': w, 'h': h},
        //            'dirtyBoxes': [{ 'x': x, 'y': y, 'w': w, 'h': h }, ...] }
        getCleanDirtyReset: function () {
            var vp = this._viewportLoc;
            var cr = this._cleanRect;

            var cleanBox = { 'x': cr.x1, 'y': cr.y1,
                             'w': cr.x2 - cr.x1 + 1, 'h': cr.y2 - cr.y1 + 1 };

            var dirtyBoxes = [];
            if (cr.x1 >= cr.x2 || cr.y1 >= cr.y2) {
                // Whole viewport is dirty
                dirtyBoxes.push({ 'x': vp.x, 'y': vp.y, 'w': vp.w, 'h': vp.h });
            } else {
                // Redraw dirty regions
                var vx2 = vp.x + vp.w - 1;
                var vy2 = vp.y + vp.h - 1;

                if (vp.x < cr.x1) {
                    // left side dirty region
                    dirtyBoxes.push({'x': vp.x, 'y': vp.y,
                                     'w': cr.x1 - vp.x + 1, 'h': vp.h});
                }
                if (vx2 > cr.x2) {
                    // right side dirty region
                    dirtyBoxes.push({'x': cr.x2 + 1, 'y': vp.y,
                                     'w': vx2 - cr.x2, 'h': vp.h});
                }
                if(vp.y < cr.y1) {
                    // top/middle dirty region
                    dirtyBoxes.push({'x': cr.x1, 'y': vp.y,
                                     'w': cr.x2 - cr.x1 + 1, 'h': cr.y1 - vp.y});
                }
                if (vy2 > cr.y2) {
                    // bottom/middle dirty region
                    dirtyBoxes.push({'x': cr.x1, 'y': cr.y2 + 1,
                                     'w': cr.x2 - cr.x1 + 1, 'h': vy2 - cr.y2});
                }
            }

            this._cleanRect = {'x1': vp.x, 'y1': vp.y,
                               'x2': vp.x + vp.w - 1, 'y2': vp.y + vp.h - 1};

            return {'cleanBox': cleanBox, 'dirtyBoxes': dirtyBoxes};
        },

        absX: function (x) {
            return x + this._viewportLoc.x;
        },

        absY: function (y) {
            return y + this._viewportLoc.y;
        },

        resize: function (width, height) {
            this._prevDrawStyle = "";

            this._fb_width = width;
            this._fb_height = height;

            this._rescale(this._scale);

            this.viewportChange();
        },

        clear: function () {
            if (this._logo) {
                this.resize(this._logo.width, this._logo.height);
                this.blitStringImage(this._logo.data, 0, 0);
            } else {
                if (Util.Engine.trident === 6) {
                    // NB(directxman12): there's a bug in IE10 where we can fail to actually
                    //                   clear the canvas here because of the resize.
                    //                   Clearing the current viewport first fixes the issue
                    this._drawCtx.clearRect(0, 0, this._viewportLoc.w, this._viewportLoc.h);
                }
                this.resize(240, 20);
                this._drawCtx.clearRect(0, 0, this._viewportLoc.w, this._viewportLoc.h);
            }

            this._renderQ = [];
        },

        fillRect: function (x, y, width, height, color) {
            this._setFillColor(color);
            this._drawCtx.fillRect(x - this._viewportLoc.x, y - this._viewportLoc.y, width, height);
        },

        copyImage: function (old_x, old_y, new_x, new_y, w, h) {
            var x1 = old_x - this._viewportLoc.x;
            var y1 = old_y - this._viewportLoc.y;
            var x2 = new_x - this._viewportLoc.x;
            var y2 = new_y - this._viewportLoc.y;

            this._drawCtx.drawImage(this._target, x1, y1, w, h, x2, y2, w, h);
        },

        // start updating a tile
        startTile: function (x, y, width, height, color) {
            this._tile_x = x;
            this._tile_y = y;
            if (width === 16 && height === 16) {
                this._tile = this._tile16x16;
            } else {
                this._tile = this._drawCtx.createImageData(width, height);
            }

            if (this._prefer_js) {
                var bgr;
                if (this._true_color) {
                    bgr = color;
                } else {
                    bgr = this._colourMap[color[0]];
                }
                var red = bgr[2];
                var green = bgr[1];
                var blue = bgr[0];

                var data = this._tile.data;
                for (var i = 0; i < width * height * 4; i += 4) {
                    data[i] = red;
                    data[i + 1] = green;
                    data[i + 2] = blue;
                    data[i + 3] = 255;
                }
            } else {
                this.fillRect(x, y, width, height, color);
            }
        },

        // update sub-rectangle of the current tile
        subTile: function (x, y, w, h, color) {
            if (this._prefer_js) {
                var bgr;
                if (this._true_color) {
                    bgr = color;
                } else {
                    bgr = this._colourMap[color[0]];
                }
                var red = bgr[2];
                var green = bgr[1];
                var blue = bgr[0];
                var xend = x + w;
                var yend = y + h;

                var data = this._tile.data;
                var width = this._tile.width;
                for (var j = y; j < yend; j++) {
                    for (var i = x; i < xend; i++) {
                        var p = (i + (j * width)) * 4;
                        data[p] = red;
                        data[p + 1] = green;
                        data[p + 2] = blue;
                        data[p + 3] = 255;
                    }
                }
            } else {
                this.fillRect(this._tile_x + x, this._tile_y + y, w, h, color);
            }
        },

        // draw the current tile to the screen
        finishTile: function () {
            if (this._prefer_js) {
                this._drawCtx.putImageData(this._tile, this._tile_x - this._viewportLoc.x,
                                           this._tile_y - this._viewportLoc.y);
            }
            // else: No-op -- already done by setSubTile
        },

        blitImage: function (x, y, width, height, arr, offset) {
            if (this._true_color) {
                this._bgrxImageData(x, y, this._viewportLoc.x, this._viewportLoc.y, width, height, arr, offset);
            } else {
                this._cmapImageData(x, y, this._viewportLoc.x, this._viewportLoc.y, width, height, arr, offset);
            }
        },

        blitRgbImage: function (x, y , width, height, arr, offset) {
            if (this._true_color) {
                this._rgbImageData(x, y, this._viewportLoc.x, this._viewportLoc.y, width, height, arr, offset);
            } else {
                // probably wrong?
                this._cmapImageData(x, y, this._viewportLoc.x, this._viewportLoc.y, width, height, arr, offset);
            }
        },

        blitStringImage: function (str, x, y) {
            var img = new Image();
            img.onload = function () {
                this._drawCtx.drawImage(img, x - this._viewportLoc.x, y - this._viewportLoc.y);
            }.bind(this);
            img.src = str;
            return img; // for debugging purposes
        },

        // wrap ctx.drawImage but relative to viewport
        drawImage: function (img, x, y) {
            this._drawCtx.drawImage(img, x - this._viewportLoc.x, y - this._viewportLoc.y);
        },

        renderQ_push: function (action) {
            this._renderQ.push(action);
            if (this._renderQ.length === 1) {
                // If this can be rendered immediately it will be, otherwise
                // the scanner will start polling the queue (every
                // requestAnimationFrame interval)
                this._scan_renderQ();
            }
        },

        changeCursor: function (pixels, mask, hotx, hoty, w, h) {
            if (this._cursor_uri === false) {
                Util.Warn("changeCursor called but no cursor data URI support");
                return;
            }

            if (this._true_color) {
                Display.changeCursor(this._target, pixels, mask, hotx, hoty, w, h);
            } else {
                Display.changeCursor(this._target, pixels, mask, hotx, hoty, w, h, this._colourMap);
            }
        },

        defaultCursor: function () {
            this._target.style.cursor = "default";
        },

        // Overridden getters/setters
        get_context: function () {
            return this._drawCtx;
        },

        set_scale: function (scale) {
            this._rescale(scale);
        },

        set_width: function (w) {
            this.resize(w, this._fb_height);
        },
        get_width: function () {
            return this._fb_width;
        },

        set_height: function (h) {
            this.resize(this._fb_width, h);
        },
        get_height: function () {
            return this._fb_height;
        },

        // Private Methods
        _rescale: function (factor) {
            var canvas = this._target;
            var properties = ['transform', 'WebkitTransform', 'MozTransform'];
            var transform_prop;
            while ((transform_prop = properties.shift())) {
                if (typeof canvas.style[transform_prop] !== 'undefined') {
                    break;
                }
            }

            if (transform_prop === null) {
                Util.Debug("No scaling support");
                return;
            }

            if (typeof(factor) === "undefined") {
                factor = this._scale;
            } else if (factor > 1.0) {
                factor = 1.0;
            } else if (factor < 0.1) {
                factor = 0.1;
            }

            if (this._scale === factor) {
                return;
            }

            this._scale = factor;
            var x = canvas.width - (canvas.width * factor);
            var y = canvas.height - (canvas.height * factor);
            canvas.style[transform_prop] = 'scale(' + this._scale + ') translate(-' + x + 'px, -' + y + 'px)';
        },

        _setFillColor: function (color) {
            var bgr;
            if (this._true_color) {
                bgr = color;
            } else {
                bgr = this._colourMap[color[0]];
            }

            var newStyle = 'rgb(' + bgr[2] + ',' + bgr[1] + ',' + bgr[0] + ')';
            if (newStyle !== this._prevDrawStyle) {
                this._drawCtx.fillStyle = newStyle;
                this._prevDrawStyle = newStyle;
            }
        },

        _rgbImageData: function (x, y, vx, vy, width, height, arr, offset) {
            var img = this._drawCtx.createImageData(width, height);
            var data = img.data;
            for (var i = 0, j = offset; i < width * height * 4; i += 4, j += 3) {
                data[i]     = arr[j];
                data[i + 1] = arr[j + 1];
                data[i + 2] = arr[j + 2];
                data[i + 3] = 255;  // Alpha
            }
            this._drawCtx.putImageData(img, x - vx, y - vy);
        },

        _bgrxImageData: function (x, y, vx, vy, width, height, arr, offset) {
            var img = this._drawCtx.createImageData(width, height);
            var data = img.data;
            for (var i = 0, j = offset; i < width * height * 4; i += 4, j += 4) {
                data[i]     = arr[j + 2];
                data[i + 1] = arr[j + 1];
                data[i + 2] = arr[j];
                data[i + 3] = 255;  // Alpha
            }
            this._drawCtx.putImageData(img, x - vx, y - vy);
        },

        _cmapImageData: function (x, y, vx, vy, width, height, arr, offset) {
            var img = this._drawCtx.createImageData(width, height);
            var data = img.data;
            var cmap = this._colourMap;
            for (var i = 0, j = offset; i < width * height * 4; i += 4, j++) {
                var bgr = cmap[arr[j]];
                data[i]     = bgr[2];
                data[i + 1] = bgr[1];
                data[i + 2] = bgr[0];
                data[i + 3] = 255;  // Alpha
            }
            this._drawCtx.putImageData(img, x - vx, y - vy);
        },

        _scan_renderQ: function () {
            var ready = true;
            while (ready && this._renderQ.length > 0) {
                var a = this._renderQ[0];
                switch (a.type) {
                    case 'copy':
                        this.copyImage(a.old_x, a.old_y, a.x, a.y, a.width, a.height);
                        break;
                    case 'fill':
                        this.fillRect(a.x, a.y, a.width, a.height, a.color);
                        break;
                    case 'blit':
                        this.blitImage(a.x, a.y, a.width, a.height, a.data, 0);
                        break;
                    case 'blitRgb':
                        this.blitRgbImage(a.x, a.y, a.width, a.height, a.data, 0);
                        break;
                    case 'img':
                        if (a.img.complete) {
                            this.drawImage(a.img, a.x, a.y);
                        } else {
                            // We need to wait for this image to 'load'
                            // to keep things in-order
                            ready = false;
                        }
                        break;
                }

                if (ready) {
                    this._renderQ.shift();
                }
            }

            if (this._renderQ.length > 0) {
                requestAnimFrame(this._scan_renderQ.bind(this));
            }
        },
    };

    Util.make_properties(Display, [
        ['target', 'wo', 'dom'],       // Canvas element for rendering
        ['context', 'ro', 'raw'],      // Canvas 2D context for rendering (read-only)
        ['logo', 'rw', 'raw'],         // Logo to display when cleared: {"width": w, "height": h, "data": data}
        ['true_color', 'rw', 'bool'],  // Use true-color pixel data
        ['colourMap', 'rw', 'arr'],    // Colour map array (when not true-color)
        ['scale', 'rw', 'float'],      // Display area scale factor 0.0 - 1.0
        ['viewport', 'rw', 'bool'],    // Use a viewport set with viewportChange()
        ['width', 'rw', 'int'],        // Display area width
        ['height', 'rw', 'int'],       // Display area height

        ['render_mode', 'ro', 'str'],  // Canvas rendering mode (read-only)

        ['prefer_js', 'rw', 'str'],    // Prefer Javascript over canvas methods
        ['cursor_uri', 'rw', 'raw']    // Can we render cursor using data URI
    ]);

    // Class Methods
    Display.changeCursor = function (target, pixels, mask, hotx, hoty, w0, h0, cmap) {
        var w = w0;
        var h = h0;
        if (h < w) {
            h = w;  // increase h to make it square
        } else {
            w = h;  // increase w to make it square
        }

        var cur = [];

        // Push multi-byte little-endian values
        cur.push16le = function (num) {
            this.push(num & 0xFF, (num >> 8) & 0xFF);
        };
        cur.push32le = function (num) {
            this.push(num & 0xFF,
                      (num >> 8) & 0xFF,
                      (num >> 16) & 0xFF,
                      (num >> 24) & 0xFF);
        };

        var IHDRsz = 40;
        var RGBsz = w * h * 4;
        var XORsz = Math.ceil((w * h) / 8.0);
        var ANDsz = Math.ceil((w * h) / 8.0);

        cur.push16le(0);        // 0: Reserved
        cur.push16le(2);        // 2: .CUR type
        cur.push16le(1);        // 4: Number of images, 1 for non-animated ico

        // Cursor #1 header (ICONDIRENTRY)
        cur.push(w);            // 6: width
        cur.push(h);            // 7: height
        cur.push(0);            // 8: colors, 0 -> true-color
        cur.push(0);            // 9: reserved
        cur.push16le(hotx);     // 10: hotspot x coordinate
        cur.push16le(hoty);     // 12: hotspot y coordinate
        cur.push32le(IHDRsz + RGBsz + XORsz + ANDsz);
                                // 14: cursor data byte size
        cur.push32le(22);       // 18: offset of cursor data in the file

        // Cursor #1 InfoHeader (ICONIMAGE/BITMAPINFO)
        cur.push32le(IHDRsz);   // 22: InfoHeader size
        cur.push32le(w);        // 26: Cursor width
        cur.push32le(h * 2);    // 30: XOR+AND height
        cur.push16le(1);        // 34: number of planes
        cur.push16le(32);       // 36: bits per pixel
        cur.push32le(0);        // 38: Type of compression

        cur.push32le(XORsz + ANDsz);
                                // 42: Size of Image
        cur.push32le(0);        // 46: reserved
        cur.push32le(0);        // 50: reserved
        cur.push32le(0);        // 54: reserved
        cur.push32le(0);        // 58: reserved

        // 62: color data (RGBQUAD icColors[])
        var y, x;
        for (y = h - 1; y >= 0; y--) {
            for (x = 0; x < w; x++) {
                if (x >= w0 || y >= h0) {
                    cur.push(0);  // blue
                    cur.push(0);  // green
                    cur.push(0);  // red
                    cur.push(0);  // alpha
                } else {
                    var idx = y * Math.ceil(w0 / 8) + Math.floor(x / 8);
                    var alpha = (mask[idx] << (x % 8)) & 0x80 ? 255 : 0;
                    if (cmap) {
                        idx = (w0 * y) + x;
                        var rgb = cmap[pixels[idx]];
                        cur.push(rgb[2]);  // blue
                        cur.push(rgb[1]);  // green
                        cur.push(rgb[0]);  // red
                        cur.push(alpha);   // alpha
                    } else {
                        idx = ((w0 * y) + x) * 4;
                        cur.push(pixels[idx + 2]); // blue
                        cur.push(pixels[idx + 1]); // green
                        cur.push(pixels[idx]);     // red
                        cur.push(alpha);           // alpha
                    }
                }
            }
        }

        // XOR/bitmask data (BYTE icXOR[])
        // (ignored, just needs to be the right size)
        for (y = 0; y < h; y++) {
            for (x = 0; x < Math.ceil(w / 8); x++) {
                cur.push(0);
            }
        }

        // AND/bitmask data (BYTE icAND[])
        // (ignored, just needs to be the right size)
        for (y = 0; y < h; y++) {
            for (x = 0; x < Math.ceil(w / 8); x++) {
                cur.push(0);
            }
        }

        var url = 'data:image/x-icon;base64,' + Base64.encode(cur);
        target.style.cursor = 'url(' + url + ')' + hotx + ' ' + hoty + ', default';
    };
})();
