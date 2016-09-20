/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2012 Joel Martin
 * Copyright (C) 2015 Samuel Mannehed for Cendio AB
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

/*jslint browser: true, white: false */
/*global Util, Base64, changeCursor */

/* [module]
 * import Util from "./util";
 * import Base64 from "./base64";
 */

/* [module] export default */ function Display(defaults) {
    this._drawCtx = null;
    this._c_forceCanvas = false;

    this._renderQ = [];  // queue drawing actions for in-oder rendering

    // the full frame buffer (logical canvas) size
    this._fb_width = 0;
    this._fb_height = 0;

    // the size limit of the viewport (start disabled)
    this._maxWidth = 0;
    this._maxHeight = 0;

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
    if (this._cursor_uri || this._cursor_uri === null ||
            this._cursor_uri === undefined) {
        this._cursor_uri = Util.browserSupportsCursorURIs();
    }

    Util.Debug("<< Display.constructor");
};

(function () {
    "use strict";

    var SUPPORTS_IMAGEDATA_CONSTRUCTOR = false;
    try {
        new ImageData(new Uint8ClampedArray(4), 1, 1);
        SUPPORTS_IMAGEDATA_CONSTRUCTOR = true;
    } catch (ex) {
        // ignore failure
    }


    Display.prototype = {
        // Public methods
        viewportChangePos: function (deltaX, deltaY) {
            var vp = this._viewportLoc;
            deltaX = Math.floor(deltaX);
            deltaY = Math.floor(deltaY);

            if (!this._viewport) {
                deltaX = -vp.w;  // clamped later of out of bounds
                deltaY = -vp.h;
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
            var cr = this._cleanRect;
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

            var saveStyle = this._drawCtx.fillStyle;
            var canvas = this._target;
            this._drawCtx.fillStyle = "rgb(255,255,255)";

            // Due to this bug among others [1] we need to disable the image-smoothing to
            // avoid getting a blur effect when panning.
            //
            // 1. https://bugzilla.mozilla.org/show_bug.cgi?id=1194719
            //
            // We need to set these every time since all properties are reset
            // when the the size is changed
            if (this._drawCtx.mozImageSmoothingEnabled) {
                this._drawCtx.mozImageSmoothingEnabled = false;
            } else if (this._drawCtx.webkitImageSmoothingEnabled) {
                this._drawCtx.webkitImageSmoothingEnabled = false;
            } else if (this._drawCtx.msImageSmoothingEnabled) {
                this._drawCtx.msImageSmoothingEnabled = false;
            } else if (this._drawCtx.imageSmoothingEnabled) {
                this._drawCtx.imageSmoothingEnabled = false;
            }

            // Copy the valid part of the viewport to the shifted location
            this._drawCtx.drawImage(canvas, 0, 0, vp.w, vp.h, -deltaX, -deltaY, vp.w, vp.h);

            if (deltaX !== 0) {
                this._drawCtx.fillRect(x1, 0, w, vp.h);
            }
            if (deltaY !== 0) {
                this._drawCtx.fillRect(0, y1, vp.w, h);
            }
            this._drawCtx.fillStyle = saveStyle;
        },

        viewportChangeSize: function(width, height) {

            if (typeof(width) === "undefined" || typeof(height) === "undefined") {

                Util.Debug("Setting viewport to full display region");
                width = this._fb_width;
                height = this._fb_height;
            }

            var vp = this._viewportLoc;
            if (vp.w !== width || vp.h !== height) {

                if (this._viewport) {
                    if (this._maxWidth !== 0 && width > this._maxWidth) {
                        width = this._maxWidth;
                    }
                    if (this._maxHeight !== 0 && height > this._maxHeight) {
                        height = this._maxHeight;
                    }
                }

                var cr = this._cleanRect;

                if (width < vp.w &&  cr.x2 > vp.x + width - 1) {
                    cr.x2 = vp.x + width - 1;
                }
                if (height < vp.h &&  cr.y2 > vp.y + height - 1) {
                    cr.y2 = vp.y + height - 1;
                }

                vp.w = width;
                vp.h = height;

                var canvas = this._target;
                if (canvas.width !== width || canvas.height !== height) {

                    // We have to save the canvas data since changing the size will clear it
                    var saveImg = null;
                    if (vp.w > 0 && vp.h > 0 && canvas.width > 0 && canvas.height > 0) {
                        var img_width = canvas.width < vp.w ? canvas.width : vp.w;
                        var img_height = canvas.height < vp.h ? canvas.height : vp.h;
                        saveImg = this._drawCtx.getImageData(0, 0, img_width, img_height);
                    }

                    if (canvas.width !== width) {
                        canvas.width = width;
                        canvas.style.width = width + 'px';
                    }
                    if (canvas.height !== height) {
                        canvas.height = height;
                        canvas.style.height = height + 'px';
                    }

                    if (saveImg) {
                        this._drawCtx.putImageData(saveImg, 0, 0);
                    }
                }
            }
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

            this.viewportChangeSize();
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

        fillRect: function (x, y, width, height, color, from_queue) {
            if (this._renderQ.length !== 0 && !from_queue) {
                this.renderQ_push({
                    'type': 'fill',
                    'x': x,
                    'y': y,
                    'width': width,
                    'height': height,
                    'color': color
                });
            } else {
                this._setFillColor(color);
                this._drawCtx.fillRect(x - this._viewportLoc.x, y - this._viewportLoc.y, width, height);
            }
        },

        copyImage: function (old_x, old_y, new_x, new_y, w, h, from_queue) {
            if (this._renderQ.length !== 0 && !from_queue) {
                this.renderQ_push({
                    'type': 'copy',
                    'old_x': old_x,
                    'old_y': old_y,
                    'x': new_x,
                    'y': new_y,
                    'width': w,
                    'height': h,
                });
            } else {
                var x1 = old_x - this._viewportLoc.x;
                var y1 = old_y - this._viewportLoc.y;
                var x2 = new_x - this._viewportLoc.x;
                var y2 = new_y - this._viewportLoc.y;

                this._drawCtx.drawImage(this._target, x1, y1, w, h, x2, y2, w, h);
            }
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
                this.fillRect(x, y, width, height, color, true);
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
                this.fillRect(this._tile_x + x, this._tile_y + y, w, h, color, true);
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

        blitImage: function (x, y, width, height, arr, offset, from_queue) {
            if (this._renderQ.length !== 0 && !from_queue) {
                // NB(directxman12): it's technically more performant here to use preallocated arrays,
                // but it's a lot of extra work for not a lot of payoff -- if we're using the render queue,
                // this probably isn't getting called *nearly* as much
                var new_arr = new Uint8Array(width * height * 4);
                new_arr.set(new Uint8Array(arr.buffer, 0, new_arr.length));
                this.renderQ_push({
                    'type': 'blit',
                    'data': new_arr,
                    'x': x,
                    'y': y,
                    'width': width,
                    'height': height,
                });
            } else if (this._true_color) {
                this._bgrxImageData(x, y, this._viewportLoc.x, this._viewportLoc.y, width, height, arr, offset);
            } else {
                this._cmapImageData(x, y, this._viewportLoc.x, this._viewportLoc.y, width, height, arr, offset);
            }
        },

        blitRgbImage: function (x, y , width, height, arr, offset, from_queue) {
            if (this._renderQ.length !== 0 && !from_queue) {
                // NB(directxman12): it's technically more performant here to use preallocated arrays,
                // but it's a lot of extra work for not a lot of payoff -- if we're using the render queue,
                // this probably isn't getting called *nearly* as much
                var new_arr = new Uint8Array(width * height * 3);
                new_arr.set(new Uint8Array(arr.buffer, 0, new_arr.length));
                this.renderQ_push({
                    'type': 'blitRgb',
                    'data': new_arr,
                    'x': x,
                    'y': y,
                    'width': width,
                    'height': height,
                });
            } else if (this._true_color) {
                this._rgbImageData(x, y, this._viewportLoc.x, this._viewportLoc.y, width, height, arr, offset);
            } else {
                // probably wrong?
                this._cmapImageData(x, y, this._viewportLoc.x, this._viewportLoc.y, width, height, arr, offset);
            }
        },

        blitRgbxImage: function (x, y, width, height, arr, offset, from_queue) {
            if (this._renderQ.length !== 0 && !from_queue) {
                // NB(directxman12): it's technically more performant here to use preallocated arrays,
                // but it's a lot of extra work for not a lot of payoff -- if we're using the render queue,
                // this probably isn't getting called *nearly* as much
                var new_arr = new Uint8Array(width * height * 4);
                new_arr.set(new Uint8Array(arr.buffer, 0, new_arr.length));
                this.renderQ_push({
                    'type': 'blitRgbx',
                    'data': new_arr,
                    'x': x,
                    'y': y,
                    'width': width,
                    'height': height,
                });
            } else {
                this._rgbxImageData(x, y, this._viewportLoc.x, this._viewportLoc.y, width, height, arr, offset);
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

        disableLocalCursor: function () {
            this._target.style.cursor = "none";
        },

        clippingDisplay: function () {
            var vp = this._viewportLoc;

            var fbClip = this._fb_width > vp.w || this._fb_height > vp.h;
            var limitedVp = this._maxWidth !== 0 && this._maxHeight !== 0;
            var clipping = false;

            if (limitedVp) {
                clipping = vp.w > this._maxWidth || vp.h > this._maxHeight;
            }

            return fbClip || (limitedVp && clipping);
        },

        // Overridden getters/setters
        get_context: function () {
            return this._drawCtx;
        },

        set_scale: function (scale) {
            this._rescale(scale);
        },

        set_width: function (w) {
            this._fb_width = w;
        },
        get_width: function () {
            return this._fb_width;
        },

        set_height: function (h) {
            this._fb_height =  h;
        },
        get_height: function () {
            return this._fb_height;
        },

        autoscale: function (containerWidth, containerHeight, downscaleOnly) {
            var targetAspectRatio = containerWidth / containerHeight;
            var fbAspectRatio = this._fb_width / this._fb_height;

            var scaleRatio;
            if (fbAspectRatio >= targetAspectRatio) {
                scaleRatio = containerWidth / this._fb_width;
            } else {
                scaleRatio = containerHeight / this._fb_height;
            }

            var targetW, targetH;
            if (scaleRatio > 1.0 && downscaleOnly) {
                targetW = this._fb_width;
                targetH = this._fb_height;
                scaleRatio = 1.0;
            } else if (fbAspectRatio >= targetAspectRatio) {
                targetW = containerWidth;
                targetH = Math.round(containerWidth / fbAspectRatio);
            } else {
                targetW = Math.round(containerHeight * fbAspectRatio);
                targetH = containerHeight;
            }

            // NB(directxman12): If you set the width directly, or set the
            //                   style width to a number, the canvas is cleared.
            //                   However, if you set the style width to a string
            //                   ('NNNpx'), the canvas is scaled without clearing.
            this._target.style.width = targetW + 'px';
            this._target.style.height = targetH + 'px';

            this._scale = scaleRatio;

            return scaleRatio;  // so that the mouse, etc scale can be set
        },

        // Private Methods
        _rescale: function (factor) {
            this._scale = factor;

            var w;
            var h;

            if (this._viewport &&
                this._maxWidth !== 0 && this._maxHeight !== 0) {
                w = Math.min(this._fb_width, this._maxWidth);
                h = Math.min(this._fb_height, this._maxHeight);
            } else {
                w = this._fb_width;
                h = this._fb_height;
            }

            this._target.style.width = Math.round(factor * w) + 'px';
            this._target.style.height = Math.round(factor * h) + 'px';
        },

        _setFillColor: function (color) {
            var bgr;
            if (this._true_color) {
                bgr = color;
            } else {
                bgr = this._colourMap[color];
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

        _rgbxImageData: function (x, y, vx, vy, width, height, arr, offset) {
            // NB(directxman12): arr must be an Type Array view
            var img;
            if (SUPPORTS_IMAGEDATA_CONSTRUCTOR) {
                img = new ImageData(new Uint8ClampedArray(arr.buffer, arr.byteOffset, width * height * 4), width, height);
            } else {
                img = this._drawCtx.createImageData(width, height);
                img.data.set(new Uint8ClampedArray(arr.buffer, arr.byteOffset, width * height * 4));
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
                        this.copyImage(a.old_x, a.old_y, a.x, a.y, a.width, a.height, true);
                        break;
                    case 'fill':
                        this.fillRect(a.x, a.y, a.width, a.height, a.color, true);
                        break;
                    case 'blit':
                        this.blitImage(a.x, a.y, a.width, a.height, a.data, 0, true);
                        break;
                    case 'blitRgb':
                        this.blitRgbImage(a.x, a.y, a.width, a.height, a.data, 0, true);
                        break;
                    case 'blitRgbx':
                        this.blitRgbxImage(a.x, a.y, a.width, a.height, a.data, 0, true);
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
                requestAnimationFrame(this._scan_renderQ.bind(this));
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
        ['viewport', 'rw', 'bool'],    // Use viewport clipping
        ['width', 'rw', 'int'],        // Display area width
        ['height', 'rw', 'int'],       // Display area height
        ['maxWidth', 'rw', 'int'],     // Viewport max width (0 if disabled)
        ['maxHeight', 'rw', 'int'],    // Viewport max height (0 if disabled)

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
