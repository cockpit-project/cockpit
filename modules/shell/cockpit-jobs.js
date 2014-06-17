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

var cockpit_active_targets = [ ];

function cockpit_job_target_class (target)
{
    return 'spinner-' + target.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function cockpit_prepare_as_target (elt)
{
    $(elt).hide();
}

function cockpit_mark_as_target (elt, target)
{
    var i;
    var cl = cockpit_job_target_class (target);

    elt = $(elt);
    elt.addClass(cl);
    for (i = 0; i < cockpit_active_targets.length; i++) {
        if (cockpit_active_targets[i] == cl)
            elt.show();
    }
}

function cockpit_watch_jobs (client)
{
    function update ()
    {
        var objs = client.getObjectsFrom("/com/redhat/Cockpit/Jobs/");
        var job;
        var i, j;

        for (i = 0; i < cockpit_active_targets.length; i++) {
            $('.' + cockpit_active_targets[i]).hide();
        }
        cockpit_active_targets = [ ];

        for (i = 0; i < objs.length; i++) {
            job = objs[i].lookup("com.redhat.Cockpit.Job");
            if (job) {
                for (j = 0; j < job.Targets.length; j++) {
                    var t = cockpit_job_target_class (job.Targets[j]);
                    cockpit_active_targets.push(t);
                    $('.' + t).show();
                }
            }
        }
    }

    if (!client._job_watchers) {
        client._job_watchers = 1;
        $(client).on("objectAdded.watch-jobs", update);
        $(client).on("objectRemoved.watch-jobs", update);
        update ();
    }
}

function cockpit_unwatch_jobs (client)
{
    client._job_watchers = client._job_watchers - 1;

    if (!client._job_watchers) {
        $(client).off(".watch-jobs");
    }
}

function cockpit_job_box (client, box, domain, role, descriptions, target_describer)
{
    function update ()
    {
        var objs = client.getObjectsFrom("/com/redhat/Cockpit/Jobs/");
        var i, j, t, tdesc;
        var tbody, target_desc, desc, progress, remaining, cancel;
        var some_added = false;

        tbody = $('<tbody>');
        for (i = 0; i < objs.length; i++) {
            j = objs[i].lookup("com.redhat.Cockpit.Job");
            if (j && j.Domain == domain) {
                target_desc = "";
                for (t = 0; t < j.Targets.length; t++) {
                    tdesc = target_describer (j.Targets[t]);
                    if (tdesc) {
                        if (target_desc)
                            target_desc += ", ";
                        target_desc += tdesc;
                    }
                }
                desc = F(descriptions[j.Operation] || _("Unknown operation on %{target}"),
                         { target: target_desc });
                if (j.ProgressValid)
                    progress = (j.Progress*100).toFixed() + "%";
                else
                    progress = '';
                if (j.RemainingUSecs)
                    remaining = cockpit_format_delay (j.RemainingUSecs / 1000);
                else
                    remaining = '';
                if (j.Cancellable) {
                    cancel = $('<button data-mini="true" data-inline="true">Cancel</button>');
                    cancel.on('click', function (event) {
                        if (!cockpit_check_role (role))
                            return;
                        j.call('Cancel', function (error) {
                        if (error)
                            cockpit_show_unexpected_error (error);
                        });
                    });
                } else
                    cancel = "";
                tbody.append(
                    $('<tr>').append(
                        $('<td style="width:50%"/>').text(
                            desc),
                        $('<td style="width:15%text-align:right"/>').text(
                            progress),
                        $('<td style="width:15%text-align:right"/>').text(
                            remaining),
                        $('<td style="text-align:right"/>').append(
                            cancel)));
                some_added = true;
            }
        }
        box.empty();
        if (!some_added)
            box.text(_("(No current jobs)"));
        else
            box.append($('<table>', { 'class': 'table' }).append(tbody));
    }

    function update_props (event, obj, iface)
    {
        if (iface._iface_name == "com.redhat.Cockpit.Job")
            update();
    }

    function stop ()
    {
        $(client).off("objectAdded", update);
        $(client).off("objectRemoved", update);
        $(client).off("propertiesChanged", update_props);
    }

    function start ()
    {
        $(client).on("objectAdded", update);
        $(client).on("objectRemoved", update);
        $(client).on("propertiesChanged", update_props);
        update ();
    }

    start ();
    return { stop: stop };
}
