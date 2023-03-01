/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
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

import cockpit from 'cockpit';
import React, { useState } from 'react';

import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Text } from "@patternfly/react-core/dist/esm/components/Text/index.js";
import { ListingTable } from 'cockpit-components-table.jsx';

import * as timeformat from "timeformat.js";
import { useInit } from "hooks";

const _ = cockpit.gettext;

export function AccountLogs({ name }) {
    const [logins, setLogins] = useState([]);
    useInit(() => {
        cockpit.spawn(["last", "--time-format", "iso", "-n", 25, name], { environ: ["LC_ALL=C"] })
                .then(data => {
                    let logins = [];
                    data.split('\n').forEach(line => {
                        // Exclude still logged in and non user lines
                        if (!line.includes(name) || line.includes('still')) {
                            return;
                        }
                        // Exclude tmux/screen lines
                        if (line.includes('tmux') || line.includes('screen')) {
                            return;
                        }

                        // format:
                        // admin    web console  ::ffff:172.27.0. 2021-09-24T09:02:13+00:00 - 2021-09-24T09:04:20+00:00  (00:02)
                        const lines = line.split(/ +/);
                        const ended = new Date(lines[lines.length - 2]);
                        const started = new Date(lines[lines.length - 4]);
                        const from = lines[lines.length - 5];
                        if (isNaN(started.getTime()) || isNaN(ended.getTime())) {
                            return;
                        }

                        logins.push({
                            started,
                            ended,
                            from
                        });
                    });

                    // Only show 15 login lines
                    logins = logins.slice(0, 15);
                    setLogins(logins);
                })
                .catch((ex) => {
                    console.error(ex);
                });
    }, [name]);

    return (
        <Card id="account-logs">
            <CardTitle>
                <Text component="h2">{_("Login history")}</Text>
            </CardTitle>
            <CardBody className="contains-list">
                <ListingTable variant="compact" aria-label={ _("Login history list") }
                    columns={ [
                        { title: _("Started") },
                        { title: _("Ended") },
                        { title: _("From") },
                    ] }
                    rows={ logins.map((line, index) => ({
                        props: { key: index },
                        columns: [timeformat.dateTime(line.started), timeformat.dateTime(line.ended), line.from]
                    }))} />
            </CardBody>
        </Card>
    );
}
