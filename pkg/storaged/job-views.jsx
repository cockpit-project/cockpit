/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

import cockpit from "cockpit";
import React from "react";
import { StorageButton } from "./storage-controls.jsx";

const _ = cockpit.gettext;

export class Jobs extends React.Component {
    render() {
        var jobs = this.props.jobs.query();

        if (jobs.length === 0)
            return null;

        function job_row(job) {
            function cancel() {
                return job.dbus.Cancel({});
            }
            return (
                <tr>
                    <td className="job-description">{job.Description}</td>
                    <td>{job.Progress}</td>
                    <td>{job.RemainingTime}</td>
                    <td className="job-action">
                        { job.Cancelable? <StorageButton onClick={cancel}>{_("Cancel")}</StorageButton> : null }
                    </td>
                </tr>
            );
        }

        return (
            <div className="detail-jobs panel panel-default">
                <div className="panel-heading">{_("Jobs")}</div>
                <table className="table">
                    <tbody>
                        { jobs.map(job_row) }
                    </tbody>
                </table>
            </div>
        );
    }
}
