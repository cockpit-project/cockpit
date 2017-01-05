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
    var React = require("react");

    var util = require("./util");
    var view = require("./containers-view.jsx");

    require("./run");

    var _ = cockpit.gettext;
    var C_ = cockpit.gettext;

    PageImageDetails.prototype = {
        _init: function(client) {
            this.client = client;
            this.danger_enabled = false;
        },

        getTitle: function() {
            return C_("page-title", "Images");
        },

        toggle_danger: function(val) {
            var self = this;
            self.danger_enabled = val;
            $('#image-details-containers button.enable-danger').toggleClass('active', self.danger_enabled);
            $("#image-details-containers td.container-column-actions").toggle(!self.danger_enabled);
            $("#image-details-containers td.container-column-danger").toggle(self.danger_enabled);

        },

        setup: function() {
            var self = this;

            $('#image-details .content-filter a').on("click", function() {
                cockpit.location.go('/');
            });

            util.setup_danger_button('#image-details-containers', "#image-details",
                                     function() {
                                         self.toggle_danger(!self.danger_enabled);
                                     });

            $('#image-details-delete').on('click', $.proxy(this, "delete_image"));
        },

        enter: function(image_id) {
            var self = this;

            /* Tells the image run dialog which image we're working with */
            $('#image-details-run').attr("data-image", image_id);

            this.image_id = image_id;
            this.name = cockpit.format(_("Image $0"), this.image_id.slice(0,12));

            $('#image-details-containers table tbody tr').remove();
            $('#image-details-containers button.enable-danger').toggle(false);
            $(this.client).on('image.image-details', function (event, id, image) {
                if (id == self.image_id)
                    self.update();
            });

            $('#image-details .image-details-used').toggle(false);

            $(this.client).on('container.image-details', function(event, id, container) {
                self.maybe_render_container(id, container);
            });

            for (var cid in this.client.containers) {
                var c = this.client.containers[cid];
                self.maybe_render_container(c.Id, c);
            }

            this.update();
        },

        update: function() {
            var info = this.client.images[this.image_id];
            util.docker_debug("image-details", this.image_id, info);

            React.render(React.createElement(view.ImageInline, {
                image: info
            }), document.querySelector('#image-details .content'));

            var waiting = !!(this.client.waiting[this.image_id]);
            $('#image-details-buttons div.spinner').toggle(info && waiting);
            $('#image-details-buttons button').toggle(info && !waiting);

            if (info) {
                if (info.RepoTags && info.RepoTags.length > 0)
                    this.name = info.RepoTags[0];
            }

            $('#image-details .content-filter h3 span').text(this.name || this.image_id);
        },

        maybe_render_container: function(id, container) {

            /* Does this container match? */
            if (container &&
                container.Image != this.image_id &&
                (container.Config && container.Config.Image != this.image_id)) {
                container = null;
            }

            var panel = $('#image-details-containers');
            util.render_container(this.client, panel, "I", id, container, this.danger_enabled);

            /* Hide the entire block if no containers listed */
            $('#image-details .image-details-used').toggle(panel.find('table > tbody > tr > td').length > 0);
        },

        delete_image: function () {
            var self = this;
            var location = cockpit.location;
            util.confirm(cockpit.format(_("Please confirm deletion of $0"), self.name),
                          _("Deleting an image will delete it, but you can probably download it again if you need it later.  Unless this image has never been pushed to a repository, that is, in which case you probably can't download it again."),
                          _("Delete")).
                done(function () {
                    self.client.rmi(self.image_id).
                        fail(function(ex) {
                            util.show_unexpected_error(ex);
                        }).
                        done(function() {
                            location.go("/");
                        });
                });
        }

    };

    function PageImageDetails(client) {
        this._init(client);
    }

    function init_image_details(client) {
        var page = new PageImageDetails(client);
        page.setup();

        function hide() {
            $('#image-details').hide();
        }

        function show(id) {
            page.enter(id);
            $('#image-details').show();
        }

        return {
            show: show,
            hide: hide
        };
    }

    module.exports = {
        init: init_image_details
    };
}());
