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
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Card, CardBody, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { Text, TextVariants } from "@patternfly/react-core/dist/esm/components/Text/index.js";
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { get_active_usage, teardown_active_usage, fmt_size, decode_filename, reload_systemd } from "./utils.js";
import {
    dialog_open, SizeSlider, BlockingMessage, TeardownMessage, init_active_usage_processes
} from "./dialog.jsx";
import { StdDetailsLayout } from "./details.jsx";
import { Block } from "./content-views.jsx";
import { StorageButton, StorageOnOff, StorageBlockNavLink } from "./storage-controls.jsx";

import inotify_py from "inotify.py";
import vdo_monitor_py from "./vdo-monitor.py";

const _ = cockpit.gettext;

export class VDODetails extends React.Component {
    constructor() {
        super();
        this.poll_path = null;
        this.state = { stats: null };
    }

    ensure_polling(enable) {
        const client = this.props.client;
        const vdo = this.props.vdo;
        const block = client.slashdevs_block[vdo.dev];
        const path = enable && block ? vdo.dev : null;

        let buf = "";

        if (this.poll_path === path)
            return;

        if (this.poll_path) {
            this.poll_process.close();
            this.setState({ stats: null });
        }

        if (path)
            this.poll_process = cockpit.spawn([client.legacy_vdo_overlay.python, "--", "-", path], { superuser: true })
                    .input(inotify_py + vdo_monitor_py)
                    .stream((data) => {
                        buf += data;
                        const lines = buf.split("\n");
                        buf = lines[lines.length - 1];
                        if (lines.length >= 2) {
                            this.setState({ stats: JSON.parse(lines[lines.length - 2]) });
                        }
                    });
        this.poll_path = path;
    }

    componentDidMount() {
        this.ensure_polling(true);
    }

    componentDidUpdate() {
        this.ensure_polling(true);
    }

    componentWillUnmount() {
        this.ensure_polling(false);
    }

    render() {
        const client = this.props.client;
        const vdo = this.props.vdo;
        const block = client.slashdevs_block[vdo.dev];
        const backing_block = client.slashdevs_block[vdo.backing_dev];

        function force_delete() {
            const location = cockpit.location;
            return vdo.force_remove().then(function () {
                location.go("/");
            });
        }

        if (vdo.broken) {
            const broken = (
                <Alert variant='danger' isInline title={
                    <>
                        <StorageButton onClick={force_delete}>{_("Remove device")}</StorageButton>
                        _("The creation of this VDO device did not finish and the device can't be used.")
                    </>} />
            );
            return <StdDetailsLayout client={this.props.client} alert={broken} />;
        }

        let alert = null;
        if (backing_block && backing_block.Size > vdo.physical_size)
            alert = (
                <Alert variant='warning' isInline
                    actionClose={<StorageButton onClick={vdo.grow_physical}>{_("Grow to take all space")}</StorageButton>}
                    title={_("This VDO device does not use all of its backing device.")}>
                    { cockpit.format(_("Only $0 of $1 are used."),
                                     fmt_size(vdo.physical_size),
                                     fmt_size(backing_block.Size))}
                </Alert>
            );

        function stop() {
            const usage = get_active_usage(client, block ? block.path : "/", _("stop"));

            if (usage.Blocking) {
                dialog_open({
                    Title: cockpit.format(_("$0 is in use"), vdo.name),
                    Body: BlockingMessage(usage),
                });
                return;
            }

            if (usage.Teardown) {
                dialog_open({
                    Title: cockpit.format(_("Confirm stopping of $0"),
                                          vdo.name),
                    Teardown: TeardownMessage(usage),
                    Action: {
                        Title: _("Stop"),
                        action: function () {
                            return teardown_active_usage(client, usage)
                                    .then(function () {
                                        return vdo.stop();
                                    });
                        }
                    },
                    Inits: [
                        init_active_usage_processes(client, usage)
                    ]
                });
            } else {
                return vdo.stop();
            }
        }

        function delete_() {
            const usage = get_active_usage(client, block ? block.path : "/", _("delete"));

            if (usage.Blocking) {
                dialog_open({
                    Title: cockpit.format(_("$0 is in use"), vdo.name),
                    Body: BlockingMessage(usage),
                });
                return;
            }

            function wipe_with_teardown(block) {
                return block.Format("empty", { 'tear-down': { t: 'b', v: true } }).then(reload_systemd);
            }

            function teardown_configs() {
                if (block) {
                    return wipe_with_teardown(block);
                } else {
                    return vdo.start()
                            .then(function () {
                                return client.wait_for(() => client.slashdevs_block[vdo.dev])
                                        .then(function (block) {
                                            return wipe_with_teardown(block)
                                                    .catch(error => {
                                                        // systemd might have mounted it, let's try unmounting
                                                        const block_fsys = client.blocks_fsys[block.path];
                                                        if (block_fsys) {
                                                            return block_fsys.Unmount({})
                                                                    .then(() => wipe_with_teardown(block));
                                                        } else {
                                                            return Promise.reject(error);
                                                        }
                                                    });
                                        });
                            });
                }
            }

            dialog_open({
                Title: cockpit.format(_("Permanently delete $0?"), vdo.name),
                Body: TeardownMessage(usage),
                Action: {
                    Title: _("Delete"),
                    Danger: _("Deleting erases all data on a VDO device."),
                    action: function () {
                        return (teardown_active_usage(client, usage)
                                .then(teardown_configs)
                                .then(function () {
                                    const location = cockpit.location;
                                    return vdo.remove().then(function () {
                                        location.go("/");
                                    });
                                }));
                    }
                },
                Inits: [
                    init_active_usage_processes(client, usage)
                ]
            });
        }

        function grow_logical() {
            dialog_open({
                Title: cockpit.format(_("Grow logical size of $0"), vdo.name),
                Fields: [
                    SizeSlider("lsize", _("Logical size"),
                               {
                                   max: 5 * vdo.logical_size,
                                   min: vdo.logical_size,
                                   round: 512,
                                   value: vdo.logical_size,
                                   allow_infinite: true
                               })
                ],
                Action: {
                    Title: _("Grow"),
                    action: function (vals) {
                        if (vals.lsize > vdo.logical_size)
                            return vdo.grow_logical(vals.lsize).then(() => {
                                if (block && block.IdUsage == "filesystem")
                                    return cockpit.spawn(["fsadm", "resize",
                                        decode_filename(block.Device)],
                                                         { superuser: true, err: "message" });
                            });
                    }
                }
            });
        }

        function fmt_perc(num) {
            if (num || num == 0)
                return num + "%";
            else
                return "--";
        }

        const stats = this.state.stats;

        const header = (
            <Card>
                <CardHeader actions={{
                    actions: <>
                        { block
                            ? <StorageButton onClick={stop}>{_("Stop")}</StorageButton>
                            : <StorageButton onClick={vdo.start}>{_("Start")}</StorageButton>
                        }
                        { "\n" }
                        <StorageButton kind="danger" onClick={delete_}>{_("Delete")}</StorageButton>
                    </>,
                }}>
                    <CardTitle><Text component={TextVariants.h2}>{cockpit.format(_("VDO device $0"), vdo.name)}</Text></CardTitle>

                </CardHeader>
                <CardBody>
                    <DescriptionList className="pf-m-horizontal-on-sm">
                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("Device file")}</DescriptionListTerm>
                            <DescriptionListDescription>{vdo.dev}</DescriptionListDescription>
                        </DescriptionListGroup>

                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("Backing device")}</DescriptionListTerm>
                            <DescriptionListDescription>
                                { backing_block
                                    ? <StorageBlockNavLink client={client} block={backing_block} />
                                    : vdo.backing_dev
                                }
                            </DescriptionListDescription>
                        </DescriptionListGroup>

                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("Physical")}</DescriptionListTerm>
                            <DescriptionListDescription>
                                { stats
                                    ? cockpit.format(_("$0 data + $1 overhead used of $2 ($3)"),
                                                     fmt_size(stats.dataBlocksUsed * stats.blockSize),
                                                     fmt_size(stats.overheadBlocksUsed * stats.blockSize),
                                                     fmt_size(vdo.physical_size),
                                                     fmt_perc(stats.usedPercent))
                                    : fmt_size(vdo.physical_size)
                                }
                            </DescriptionListDescription>
                        </DescriptionListGroup>

                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("Logical")}</DescriptionListTerm>
                            <DescriptionListDescription>
                                { stats
                                    ? cockpit.format(_("$0 used of $1 ($2 saved)"),
                                                     fmt_size(stats.logicalBlocksUsed * stats.blockSize),
                                                     fmt_size(vdo.logical_size),
                                                     fmt_perc(stats.savingPercent))
                                    : fmt_size(vdo.logical_size)
                                }
                                &nbsp; <StorageButton onClick={grow_logical}>{_("Grow")}</StorageButton>
                            </DescriptionListDescription>
                        </DescriptionListGroup>

                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("Index memory")}</DescriptionListTerm>
                            <DescriptionListDescription>{fmt_size(vdo.index_mem * 1024 * 1024 * 1024)}</DescriptionListDescription>
                        </DescriptionListGroup>

                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("Compression")}</DescriptionListTerm>
                            <DescriptionListDescription>
                                <StorageOnOff state={vdo.compression}
                                              aria-label={_("Use compression")}
                                              onChange={() => vdo.set_compression(!vdo.compression)} />
                            </DescriptionListDescription>
                        </DescriptionListGroup>

                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("Deduplication")}</DescriptionListTerm>
                            <DescriptionListDescription>
                                <StorageOnOff state={vdo.deduplication}
                                              aria-label={_("Use deduplication")}
                                              onChange={() => vdo.set_deduplication(!vdo.deduplication)} />
                            </DescriptionListDescription>
                        </DescriptionListGroup>
                    </DescriptionList>
                </CardBody>
            </Card>
        );

        const content = <Block client={client} block={block} allow_partitions={false} />;

        return <StdDetailsLayout client={this.props.client} alert={alert} header={header} content={content} />;
    }
}
