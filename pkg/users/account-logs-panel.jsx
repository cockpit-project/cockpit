/*
 * Copyright (C) 2021 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from 'cockpit';
import React, { useState } from 'react';

import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { ListingTable } from 'cockpit-components-table.jsx';

import * as timeformat from "timeformat";
import { useInit } from "hooks";

const _ = cockpit.gettext;

export function AccountLogs({ name }) {
    const [logins, setLogins] = useState([]);
    useInit(() => {
        cockpit.spawn(["last", "--time-format", "iso", "-n25", "--fullnames", name], { environ: ["LC_ALL=C"] })
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
                .catch(ex => console.error("Failed to call last:", ex)); // not-covered: OS error
    }, [name]);

    return (
        <Card isPlain id="account-logs">
            <CardTitle component="h2">{_("Login history")}</CardTitle>
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
