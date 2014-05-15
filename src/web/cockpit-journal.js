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

function cockpit_watch_journal (client,
                                match, fields,
                                seek, skip,
                                callback)
{
    var journal = client.get ("/com/redhat/Cockpit/Journal",
                              "com.redhat.Cockpit.Journal");

    var running = true;

    function stop () {
        running = false;
    }

    function get_entries (seek, skip) {
        journal.call('Query',
                     match, "",
                     seek, skip, 100,
                     fields,
                     512,
                     true,
                     function (error, result, first, last, eof) {
                         if (running) {
                             if (error) {
                                 callback (null, error);
                             } else {
                                 callback (result, null);
                                 if (last)
                                     get_entries (last, 1);
                                 else
                                     get_entries (seek, skip);
                             }
                         }
                     });
    }

    get_entries (seek, skip);

    return { stop: stop };
}

function cockpit_output_funcs_for_box (box)
{
    function render_line (ident, prio, message, count, time, cursor)
    {
        var html = ('<span class="cockpit-logident">' +
                    cockpit_esc(ident) + ': ' +
                    '</span>' +
                    '<span class="cockpit-logmsg">' +
                    '<span class="cockpit-logprio-' + prio + '">' + cockpit_esc(message) + '</span>' +
                    '<span class="cockpit-logtime">' +
                    ((count > 1)?
                     '<span class="badge">' + count + '</span>' :
                     '') +
                    cockpit_esc(time) +
                    '</span>' +
                    '</span>');
        var elt = $('<div class="cockpit-logline">' + html + '</div>');
        elt.data('cockpit-cursor', cursor);
        return elt;
    }

    function render_reboot_separator ()
    {
        return ('<div class="cockpit-logline"><span class="cockpit-logdiv">' +
                _('<span class="cockpit-logmsg-reboot">Reboot</span>') +
                '</span></div>');
    }

    function render_day_header (day)
    {
        return '<div class="cockpit-loghead">' + day + '</div>';
    }

    return {
        render_line: render_line,
        render_day_header: render_day_header,
        render_reboot_separator: render_reboot_separator,

        append: function (elt) { box.append(elt); },
        prepend: function (elt) { box.prepend(elt); },
        remove_last: function (elt) { $(box[0].lastChild).remove(); },
        remove_first: function (elt) { $(box[0].firstChild).remove(); }
    };
}

function cockpit_simple_logbox (client, box, match, max_entries)
{
    var entries = [ ];

    function render() {
        var renderer = cockpit_journal_renderer (cockpit_output_funcs_for_box (box));
        box.empty();
        for (var i = 0; i < entries.length; i++) {
            renderer.prepend (entries[i]);
        }
        renderer.prepend_flush ();
        box.toggle(entries.length > 0);
    }

    function callback (tail, error) {
        if (error) {
            if (error.name == "org.freedesktop.DBus.Error.AccessDenied")
                box.append(cockpit_esc(_("You are not authorized.")));
            else
                box.append(cockpit_esc(error.message));
            box.show();
            return;
        }

        if (tail.length === 0)
            return;

        entries = entries.concat(tail);
        if (entries.length > max_entries)
            entries = entries.slice(-max_entries);

        render ();
    }

    render();
    return cockpit_watch_journal (client,
                                  match,
                                  cockpit_journal_fields,
                                  'tail', -max_entries, callback);
}

function cockpit_journal_filler (journal, box, start, match, match_text, header, day_box, start_box, end_box)
{
    var query_count = 5000;
    var query_more = 1000;
    var query_increment = 100;
    var query_fields = cockpit_journal_fields;
    var query_max_length = 512;

    var bottom_scroll;
    var running = true;

    var renderer = cockpit_journal_renderer (cockpit_output_funcs_for_box (box));

    function stop () {
        running = false;
    }

    function query (seek, skip, count, wait, callback)
    {
        // console.log("Q %s %s %s %s", seek, skip, count, wait);
        journal.call('Query',
                     match, match_text,
                     seek, skip, count,
                     query_fields, query_max_length,
                     wait,
                     function (error, result, first, last, eof) {
                         if (running) {
                             if (error) {
                                 query_error (error);
                             } else {
                                 // console.log("R %s", result.length);
                                 callback (result, first, last, eof);
                             }
                         }
                     });
    }

    function query_error (error) {
        if (error.name == "org.freedesktop.DBus.Error.AccessDenied")
            end_box.text(_("You are not authorized."));
        else
            end_box.text(error.message);
        start_box.text("");
    }

    /* Going forwards.
     */

    function prepend_entries (entries)
    {
        for (var i = 0; i < entries.length; i++)
            renderer.prepend (entries[i]);
        renderer.prepend_flush ();
        update_day_box ();
    }

    function get_entries_fwd (seek, skip, count)
    {
        if (count === 0)
            return;

        var increment = Math.min(count, query_increment);
        query (seek, skip, increment, false,
               function (result, first, last, eof)
               {
                   prepend_entries (result);

                   if (eof) {
                       if (last)
                           reached_end (last, 1);
                       else
                           reached_end (seek, skip);
                   } else if (count == increment) {
                       didnt_reach_end (last);
                   } else {
                       /* 'last' is always valid here since 'eof ==
                        * FALSE' implies valid cursors.
                        */
                       get_entries_fwd (last, 1, count - result.length);
                   }
               });
    }

    function reached_end (seek, skip) {
        end_box.text(_("-- End of Journal, waiting for more --"));

        var $document = $(document);
        var $window = $(window);

        function follow (seek, skip) {
            query (seek, skip, query_increment, true,
                   function (result, first, last, eof)
                   {
                       if (result.length > 0) {
                           var dh = $document.height();
                           var at_bottom = $window.height() + $window.scrollTop() > dh - 10;
                           prepend_entries (result);
                           if (at_bottom)
                               $window.scrollTop($window.scrollTop() + ($document.height() - dh));
                       }

                       if (last)
                           follow (last, 1);
                       else
                           follow (seek, skip);
                   });
        }

        follow (seek, skip);
    }

    function didnt_reach_end (last) {
        var button = $('<button data-inline="true" data-mini="true">' +
                       _("Load more entries") +
                       '</button><div/>');
        end_box.html(button);
        button.click (function () {
            end_box.text(_("Loading..."));
            get_entries_fwd (last, 1, query_more);
        });
    }

    /* Going backwards.
     */

    function append_entries (entries)
    {
        for (var i = entries.length-1; i >= 0; i--)
            renderer.append (entries[i]);
        renderer.append_flush ();
        update_day_box ();
    }

    function get_entries_bwd (seek, skip, count)
    {
        if (count === 0)
            return;

        var increment = Math.min(count, query_increment);
        query (seek, -skip-increment, increment, false,
               function (result, first, last, eof)
               {
                   append_entries (result);

                   if (seek == 'tail') {
                       /* If we got a valid cursor for the last entry,
                        * follow from there.  Otherwise, the journal
                        * is empty and in order not to miss any
                        * entries that have been added since this
                        * query returned, we start following from the
                        * top.
                        */
                       if (last)
                           reached_end (last, 1);
                       else
                           reached_end ('head', 0);
                   }

                   if (eof)
                       reached_start ();
                   else if (count == increment) {
                       /* 'first' is always valid here since 'eof == FALSE' implies valid cursors.
                        */
                       didnt_reach_start (first);
                   }

                   if (!eof)
                       get_entries_bwd (first, 1 , count - result.length);
               });
    }

    function reached_start () {
        start_box.text(_("-- Start of Journal --"));
    }

    function didnt_reach_start (first) {
        var button = $('<button id="journal-load-earlier" data-inline="true" data-mini="true">' +
                       _("Load earlier entries") +
                       '</button>');
        start_box.html(button);
        button.click(function () {
            start_box.text(_("Loading..."));
            get_entries_bwd (first, 0, query_more);
        });
    }

    function update_day_box ()
    {
        /* We work with document coordinates here and from that
         * viewpoint, the header slides down the document during
         * scrolling.
         */
        var border = $(header).offset().top + $(header).outerHeight();
        var closest = null;
        for (var d = box[0].firstChild; d; d = d.nextSibling) {
            if ($(d).hasClass('cockpit-loghead')) {
                if ($(d).offset().top > border)
                    break;
                closest = d;
            }
        }
        if (!closest)
            closest = d;
        if (closest)
            $(day_box).text($(closest).text());
        else
            $(day_box).text(_("Goto ..."));
    }

    box.empty();
    start_box.text(_("Loading..."));
    end_box.text(_("Loading..."));

    if (day_box) {
        $(window).on('scroll', update_day_box);
    }

    if (start == 'recent')
        get_entries_bwd ('tail', 0, query_count);
    else if (start == 'boot') {
        didnt_reach_start ('boot_id=current');
        get_entries_fwd ('boot_id=current', 0, query_count);
    } else if (start == 'last-24h') {
        didnt_reach_start ('rel_usecs=' + (-24*60*60*1000*1000).toFixed());
        get_entries_fwd ('rel_usecs=' + (-24*60*60*1000*1000).toFixed(), 0, query_count);
    } else if (start == 'last-week') {
        didnt_reach_start ('rel_usecs=' + (-7*24*60*60*1000*1000).toFixed());
        get_entries_fwd ('rel_usecs=' + (-7*24*60*60*1000*1000).toFixed(), 0, query_count);
    } else {
        reached_start ();
        get_entries_fwd ('head', 0, query_count);
    }

    return { stop: stop };
}

PageJournal.prototype = {
    _init: function() {
        this.id = "journal";
    },

    getTitle: function() {
        return C_("page-title", "Journal");
    },

    show: function() {
    },

    setup: function() {
        var self = this;

        $('#journal-box').on('click', '.cockpit-logline', function (event) {
            self.details($(this).data('cockpit-cursor'));
        });
    },

    enter: function() {
        var me = this;

        $('#content-header-extra').
            append('<div class="btn-group" id="journal-current-day-menu"> \
                      <button class="btn btn-default dropdown-toggle" id="journal-current-day" data-toggle="dropdown" style="width:200px">Goto ...</button> \
                      <ul class="dropdown-menu" role="menu"> \
                        <li><a data-op="recent">Recent</a></li> \
                        <li><a data-op="boot">Current boot</a></li> \
                        <li><a data-op="last-24h">24 hours ago</a></li> \
                        <li><a data-op="last-week">A week ago</a></li> \
                      </ul> \
                    </div>');

        $('#journal-current-day-menu a').on('click', function () {
            me.query_start = $(this).attr("data-op");
            me.reset_query ();
        });

        var priority_labels = [ _("Errors"), _("Warnings"), _("Notices"), _("All") ];
        var priority_buttons = priority_labels.map(function (l, i) {
            function click() {
                if (i != me.query_prio) {
                    me.query_prio = i;
                    update_priority_buttons(i);
                    me.reset_query();
                }
            }
            return $('<button>', { 'class': 'btn btn-default',
                                   'on': { 'click': click }
                                 }).text(l);
        });

        function update_priority_buttons(v) {
            priority_buttons.forEach(function (b, i) {
                b.toggleClass('active', i <= v);
            });
        }

        $('#content-header-extra').append($('<div>', { 'class': 'btn-group' }).append(priority_buttons));

        this.query_prio = parseInt(cockpit_get_page_param('prio') || "0", 10);
        this.query_service = cockpit_get_page_param('service') || "";
        this.query_search = cockpit_get_page_param('search') || "";
        this.query_start = cockpit_get_page_param('start') || "recent";

        // XXX - hmm.
        if (this.query_search)
            $('#content-search').val(this.query_search);
        else if (this.query_service)
            $('#content-search').val('service:' + this.query_service);

        update_priority_buttons (this.query_prio);

        this.address = cockpit_get_page_param('machine', 'server') || "localhost";

        /* TODO: This code needs to be migrated away from dbus-json1 */
        this.client = cockpit.dbus(this.address, { protocol: "dbus-json1" });

        this.journal = this.client.get ("/com/redhat/Cockpit/Journal",
                                        "com.redhat.Cockpit.Journal");

        this.reset_service_list ();
        this.reset_query ();
    },

    leave: function() {
        if (this.filler)
            this.filler.stop();

        this.client.release();
        this.client = null;
        this.journal = null;
    },

    reset_service_list: function () {
        this.journal.call('QueryUnique', "_SYSTEMD_UNIT", 50, function (error, result) {
            if (error)
                console.log(error.message);
            else {
                var list = $('#journal-service-list');
                list.empty();
                result.sort();
                for (var i = 0; i < result.length; i++)
                    list.append('<option value="' + cockpit_esc (result[i]) + '"/>');
            }
        });
    },

    reset_query: function () {
        if (this.filler)
            this.filler.stop();

        var prio_param = this.query_prio;
        var service_param = this.query_service;
        var search_param = this.query_search;
        var start_param = this.query_start;

        cockpit_set_page_param ('prio', prio_param.toString());
        cockpit_set_page_param ('service', service_param);
        cockpit_set_page_param ('search', search_param);
        cockpit_set_page_param ('start', start_param);

        var match = [ ];

        var prio_match = [ ];
        var prio_level = { "0": 3,
                           "1": 4,
                           "2": 5,
                           "3": null
                         }[prio_param];

        if (prio_level) {
            for (var i = 0; i <= prio_level; i++)
                prio_match.push ('PRIORITY=' + i.toString());
        }

        if (service_param) {
            match.push ([ '_SYSTEMD_UNIT=' + service_param ].concat(prio_match));
            match.push ([ 'COREDUMP_UNIT=' + service_param ].concat(prio_match));
            match.push ([ 'UNIT=' + service_param ].concat(prio_match));
        } else if (prio_match)
            match.push (prio_match);

        if (start_param == 'recent')
            $(window).scrollTop($(document).height());

        this.filler = cockpit_journal_filler (this.journal,
                                              $('#journal-box'), start_param, match, search_param,
                                              '#content nav', '#journal-current-day',
                                              $('#journal-start'), $('#journal-end'));
    },

    details: function (cursor) {
        if (cursor) {
            PageJournalDetails.journal = this.journal;
            PageJournalDetails.cursor = cursor;
            $('#journal-details').modal('show');
        }
    }
};

function PageJournal() {
    this._init();
}

cockpit_pages.push(new PageJournal());


PageJournalDetails.prototype = {
    _init: function() {
        this.id = "journal-details";
    },

    getTitle: function() {
        return C_("page-title", "Journal Details");
    },

    show: function() {
    },

    enter: function() {
        var journal = PageJournalDetails.journal;

        var out = $('#journal-details-fields');

        journal.call ('Query',
                      [ ], "",
                      'exact_cursor=' + PageJournalDetails.cursor, 0, 1,
                      [ "*" ],
                      512,
                      false,
                      function (error, result, first, last, eof)
                      {
                          if (error) {
                              $('#journal-details').modal('hide');
                              cockpit_show_unexpected_error (error);
                          } else if (result.length != 1) {
                              $('#journal-details').modal('hide');
                              cockpit_show_unexpected_error ("No such entry");
                          } else {
                              out.empty();
                              if (result.length == 1) {
                                  var r = result[0];
                                  for (var i = 0; i < r.length; i++) {
                                      out.append('<li class="list-group-item">' + cockpit_esc(r[i]) + '</li>');
                                  }
                              }
                          }
                      });
    },

    leave: function() {
    }
};

function PageJournalDetails() {
    this._init();
}

cockpit_pages.push(new PageJournalDetails());
