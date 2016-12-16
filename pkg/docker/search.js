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

    var util = require("./util");

    var _ = cockpit.gettext;

    /* SEARCH DIALOG */

    PageSearchImage.prototype = {
        _init: function() {
            this.id = "containers-search-image-dialog";
        },

        show: function() {
            $('#containers-search-image-search').focus();
        },

        leave: function() {
            this.cancel_search();

            $(this.client).off('.containers-search-image-dialog');
            this.client = null;

            this.dfd.reject();
            this.dfd = null;
        },

        setup: function() {
            $("#containers-search-image-search").on('keypress', $.proxy(this, "input"));
            $("#containers-search-image-search").attr( "placeholder", _("search by name, namespace or description"));
            $("#containers-search-download").on('click', $.proxy(this, 'start_download'));
            $('#containers-search-tag').prop('disabled', true);
            $('#containers-search-download').prop('disabled', true);
            this.search_timeout = null;
            this.search_request = null;
        },

        enter: function() {
            this.client = PageSearchImage.client;
            this.dfd = PageSearchImage.dfd;

            // Clear the previous results and search string from previous time
            $('#containers-search-image-results tbody tr').remove();
            $('#containers-search-image-results').hide();
            $('#containers-search-image-no-results').hide();
            $('#containers-search-image-search')[0].value = '';
        },

        input: function(event) {
            this.cancel_search();

            // Only handle if the new value is at least 3 characters long or return was pressed
            if(event.target.value.length < 3 && event.which != 13)
                return;

            var self = this;

            this.search_timeout = window.setTimeout(function() {
                self.perform_search(self.client);
            }, event.which == 13 ? 0 : 2000);
        },

        start_download: function(event) {
            var repo = $('#containers-search-download').data('repo');
            var registry = $('#containers-search-download').data('registry') || undefined;
            var tag = $('#containers-search-tag').val();

            this.dfd.resolve(repo, tag, registry);

            $("#containers-search-image-dialog").modal('hide');
        },

        perform_search: function(client) {
            var term = $('#containers-search-image-search')[0].value;

            $('#containers-search-image-waiting').addClass('spinner');
            $('#containers-search-image-no-results').hide();
            $('#containers-search-image-results').hide();
            $('#containers-search-image-results tbody tr').remove();
            this.search_request = client.search(term).
                done(function(data) {
                    var resp = data && JSON.parse(data);
                    $('#containers-search-image-waiting').removeClass('spinner');

                    if(resp && resp.length > 0) {
                        $('#containers-search-image-results').show();
                        resp.forEach(function(entry) {
                            var row = $('<tr>').append(
                                $('<td>').text(entry.name),
                                $('<td>').text(entry.description));
                            row.on('click', function(event) {
                                // Remove the active class from all other rows
                                $('#containers-search-image-results tr').each(function(){
                                    $(this).removeClass('active');
                                });

                                row.addClass('active');
                                $('#containers-search-tag').val('latest');
                                $('#containers-search-tag').prop('disabled', false);
                                $('#containers-search-download').data('repo', entry.name);
                                $('#containers-search-download').data('registry', entry.registry_name);
                                $('#containers-search-download').prop('disabled', false);
                            });
                            row.data('entry', entry);

                            util.insert_table_sorted_generic($('#containers-search-image-results'), row, function(row1, row2) {
                                //Bigger than 0 means row1 after row2
                                //Smaller than 0 means row1 before row2
                                if (row1.data('entry').is_official && !row2.data('entry').is_official)
                                    return -1;
                                if (!row1.data('entry').is_official && row2.data('entry').is_official)
                                    return 1;
                                if (row1.data('entry').is_automated && !row2.data('entry').is_automated)
                                    return -1;
                                if (!row1.data('entry').is_automated && row2.data('entry').is_automated)
                                    return 1;
                                if (row1.data('entry').star_count != row2.data('entry').star_count)
                                    return row2.data('entry').star_count - row1.data('entry').star_count;
                                return row1.data('entry').name.localeCompare(row2.data('entry').name);
                            });
                        });
                    } else {
                        // No results
                        $('#containers-search-image-no-results').empty().append(
                              $("<span>").text(cockpit.format(_("No results for $0"), term)),
                              $("<br />"),
                              $("span>").text(_("Please try another term"))
                        );
                        $('#containers-search-image-no-results').show();
                    }
                });
        },

        cancel_search: function() {
            window.clearTimeout(this.search_timeout);
            $('#containers-search-image-no-results').hide();
            $('#containers-search-image-results').hide();
            $('#containers-search-image-results tbody tr').remove();
            if (this.search_request !== null) {
                this.search_request.close();
                this.search_request = null;
            }
            $('#containers-search-image-waiting').removeClass('waiting');

            $('#containers-search-tag').prop('disabled', true);
            $('#containers-search-download').prop('disabled', true);
        }
    };

    function PageSearchImage() {
        this._init();
    }

    var dialog = new PageSearchImage();

    $(function() {
        dialog.setup();
        $("#containers-search-image-dialog").
            on('show.bs.modal', function () { dialog.enter(); }).
            on('shown.bs.modal', function () { dialog.show(); }).
            on('hidden.bs.modal', function () { dialog.leave(); });
    });

    function search(client) {
        PageSearchImage.client = client;
        PageSearchImage.dfd = cockpit.defer();

        $("#containers-search-image-dialog").modal('show');

        return PageSearchImage.dfd.promise;
    }

    module.exports = search;
}());
