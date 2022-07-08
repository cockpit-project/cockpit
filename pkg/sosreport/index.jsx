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

import '../lib/patternfly/patternfly-4-cockpit.scss';
import './sosreport.scss';
import "polyfills";

import React, { useState } from "react";
import ReactDOM from "react-dom";
import {
    Button,
    CodeBlockCode,
    Card,
    CardBody,
    Page,
    PageSection,
    PageSectionVariants,
    Flex,
    Label,
    LabelGroup,
    Dropdown,
    DropdownItem,
    KebabToggle,
    CardHeader,
    CardTitle,
    CardActions,
    Text,
    TextVariants
} from "@patternfly/react-core";

import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";
import { ListingTable } from "cockpit-components-table.jsx";

import cockpit from "cockpit";
import { superuser } from "superuser";
import { useObject, useEvent } from "hooks";

import { SuperuserButton } from "../shell/superuser.jsx";

import {
    useNewDialogState,
    Dialog,
    DialogError,
    Fields,
    TextField,
    NewPasswordField,
    CheckboxField,
    CheckboxFieldItem
} from "./dialogs.jsx";

import { fmt_to_fragments } from "utils.jsx";
import * as timeformat from "timeformat";
import { WithDialogs, useDialogs } from "dialogs.jsx";

const _ = cockpit.gettext;

function sosLister() {
    const self = {
        ready: false,
        problem: null,
        reports: {}
    };

    cockpit.event_target(self);

    function emit_changed() {
        self.dispatchEvent("changed");
    }

    function parse_report_name(path) {
        const basename = path.replace(/.*\//, "");
        const archive_rx = /^(secured-)?sosreport-(.*)\.tar\.[^.]+(\.gpg)?$/;
        const m = basename.match(archive_rx);
        if (m) {
            let name = m[2];
            let obfuscated = false;
            if (name.endsWith("-obfuscated")) {
                obfuscated = true;
                name = name.replace(/-obfuscated$/, "");
            }

            return {
                encrypted: !!m[1],
                obfuscated: obfuscated,
                name: name
            };
        }
    }

    function update_reports() {
        cockpit.script('find /var/tmp -maxdepth 1 -name \'*sosreport-*.tar.*\' -print0 | xargs -0 -r stat --printf="%n\\r%W\\n"', { superuser: true, err: "message" })
                .then(output => {
                    const reports = { };
                    const lines = output.split("\n");
                    for (const line of lines) {
                        const [path, date] = line.split("\r");
                        const report = parse_report_name(path);
                        if (report) {
                            report.date = Number(date);
                            reports[path] = report;
                        }
                    }
                    self.reports = reports;
                    self.ready = true;
                    emit_changed();
                })
                .catch(err => {
                    self.problem = err.problem || err.message;
                    self.ready = true;
                    emit_changed();
                });
    }

    let watch = null;

    function restart() {
        if (superuser.allowed === null)
            return;

        if (watch)
            watch.close("cancelled");
        self.ready = false;
        self.problem = null;
        watch = null;

        watch = cockpit.channel({ payload: "fslist1", path: "/var/tmp", superuser: true });
        watch.addEventListener("message", (event, payload) => {
            const msg = JSON.parse(payload);
            if (msg.event != "present" && parse_report_name(msg.path))
                update_reports();
        });

        update_reports();
    }

    restart();
    superuser.addEventListener("changed", restart);
    return self;
}

function sosCreate(args, setProgress) {
    let output = "";
    let plugins_count = 0;
    const progress_regex = /Running ([0-9]+)\/([0-9]+):/; // Only for sos < 3.6
    const finishing_regex = /Finishing plugins.*\[Running: (.*)\]/;
    const starting_regex = /Starting ([0-9]+)\/([0-9]+).*\[Running: (.*)\]/;

    // TODO - Use a real API instead of scraping stdout once such an API exists
    const task = cockpit.spawn(["sos", "report", "--batch"].concat(args),
                               { superuser: true, err: "out", pty: true });

    setProgress(0, () => task.close("cancelled"));

    task.stream(text => {
        let p = 0;
        let m;

        output += text;
        const lines = output.split("\n");
        for (let i = lines.length - 1; i >= 0; i--) {
            if ((m = starting_regex.exec(lines[i]))) {
                plugins_count = parseInt(m[2], 10);
                p = ((parseInt(m[1], 10) - m[3].split(" ").length) / plugins_count) * 100;
                break;
            } else if ((m = finishing_regex.exec(lines[i]))) {
                if (!plugins_count)
                    p = 100;
                else
                    p = ((plugins_count - m[1].split(" ").length) / plugins_count) * 100;
                break;
            } else if ((m = progress_regex.exec(lines[i]))) {
                p = (parseInt(m[1], 10) / parseInt(m[2], 10)) * 100;
                break;
            }
        }

        setProgress(p, () => task.close("cancelled"));
    });

    return task.catch(error => {
        if (error.problem == "cancelled")
            return Promise.resolve();
        else
            return Promise.reject(new DialogError(error.toString(), <CodeBlockCode>{output}</CodeBlockCode>));
    });
}

function sosDownload(path) {
    const basename = path.replace(/.*\//, "");
    const query = window.btoa(JSON.stringify({
        payload: "fsread1",
        binary: "raw",
        path: path,
        superuser: true,
        max_read_size: 150 * 1024 * 1024,
        external: {
            "content-disposition": 'attachment; filename="' + basename + '"',
            "content-type": "application/x-xz, application/octet-stream"
        }
    }));
    const prefix = (new URL(cockpit.transport.uri("channel/" + cockpit.transport.csrf_token))).pathname;
    const url = prefix + '?' + query;
    return new Promise((resolve, reject) => {
        // We download via a hidden iframe to get better control over the error cases
        const iframe = document.createElement("iframe");
        iframe.setAttribute("src", url);
        iframe.setAttribute("hidden", "hidden");
        iframe.addEventListener("load", () => {
            const title = iframe.contentDocument.title;
            if (title) {
                reject(title);
            } else {
                resolve();
            }
        });
        document.body.appendChild(iframe);
    });
}

function sosRemove(path) {
    return cockpit.script(cockpit.format("rm -f '$0' '$0'.*", path), { superuser: true, err: "message" });
}

const SOSDialog = () => {
    const dlg = useNewDialogState({
        label: "",
        passphrase: "",
        obfuscate: false,
        verbose: false,
    });

    function run() {
        const args = [];

        if (dlg.values.label) {
            if (dlg.values.label == "FOO")
                dlg.set_value_error("label", "Label can not be FOO");

            args.push("--labelll");
            args.push("cockpit-" + dlg.values.label);
        }

        if (dlg.values.passphrase) {
            args.push("--encrypt-pass");
            args.push(dlg.values.passphrase);
        }

        if (dlg.values.obfuscate) {
            args.push("--clean");
        }

        if (dlg.values.verbose) {
            args.push("-vvv");
        }

        if (dlg.has_value_errors())
            return;

        function set_progress(perc, cancel) {
            dlg.set_progress(cockpit.format(_("Progress: $0"), perc.toFixed() + "%"));
            dlg.set_cancel(cancel);
        }

        return sosCreate(args, set_progress);
    }

    return (
        <Dialog state={dlg}
                id="sos-dialog"
                title={_("Run new report")}
                actionLabel={_("Run report")} action={run}
                cancelLabel={_("Stop report")}>
            <p>{ _("SOS reporting collects system information to help with diagnosing problems.") }</p>
            <p>{ _("This information is stored only on the system.") }</p>
            <br />
            <Fields>
                <TextField tag="label"
                           label={_("Report label")} />
                <NewPasswordField tag="passphrase"
                                  label={_("Encryption passphrase")}
                                  helperText="Leave empty to skip encryption" />
                <CheckboxField label={_("Options")}>
                    <CheckboxFieldItem tag="obfuscate"
                                       label={_("Obfuscate network addresses, hostnames, and usernames")} />
                    <CheckboxFieldItem tag="verbose"
                                       label={_("Use verbose logging")} />
                </CheckboxField>
            </Fields>
        </Dialog>);
};

const SOSRemoveDialog = ({ path }) => {
    const dlg = useNewDialogState({});

    return (
        <Dialog state={dlg}
                id="sos-remove-dialog"
                danger
                title={_("Delete report permanently?")}
                actionLabel={_("Delete")} action={() => sosRemove(path)}>
            <p>{fmt_to_fragments(_("The file $0 will be deleted."), <b>{path}</b>)}</p>
        </Dialog>);
};

const SOSErrorDialog = ({ error }) => {
    const dlg = useNewDialogState({});

    return (
        <Dialog state={dlg}
                id="sos-error-dialog"
                title={_("Error")}>
            <p>{error}</p>
        </Dialog>);
};

const Menu = ({ items }) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <Dropdown onSelect={() => setIsOpen(!isOpen)}
                  toggle={<KebabToggle onToggle={setIsOpen} />}
                  isOpen={isOpen}
                  isPlain
                  position="right"
                  dropdownItems={items} />
    );
};

const MenuItem = ({ onClick, onlyNarrow, children }) => (
    <DropdownItem className={onlyNarrow ? "show-only-when-narrow" : null}
                  onKeyPress={onClick}
                  onClick={onClick}>
        {children}
    </DropdownItem>
);

const SOSBody = () => {
    const Dialogs = useDialogs();
    const lister = useObject(sosLister, obj => obj.close, []);
    useEvent(lister, "changed");

    const superuser_proxy = useObject(() => cockpit.dbus(null, { bus: "internal" }).proxy("cockpit.Superuser",
                                                                                          "/superuser"),
                                      obj => obj.close(),
                                      []);
    useEvent(superuser_proxy, "changed");

    if (!lister.ready)
        return <EmptyStatePanel loading />;

    if (lister.problem) {
        if (lister.problem == "access-denied")
            return (
                <EmptyStatePanel
                    title={_("Administrative access required")}
                    paragraph={_("Administrative access is required to create and access reports.")}
                    action={<SuperuserButton />} />);
        else
            return <EmptyStatePanel title={lister.problem} />;
    }

    function run_report() {
        Dialogs.show(<SOSDialog />);
    }

    function make_report_row(path) {
        const report = lister.reports[path];

        function download() {
            sosDownload(path).catch(err => Dialogs.show(<SOSErrorDialog error={err.toString()} />));
        }

        function remove() {
            Dialogs.show(<SOSRemoveDialog path={path} />);
        }

        const labels = [];
        if (report.encrypted)
            labels.push(<Label key="enc" color="orange">
                {_("Encrypted")}
            </Label>);
        if (report.obfuscated)
            labels.push(<Label key="obf" color="gray">
                {_("Obfuscated")}
            </Label>);

        const action = (
            <Button variant="secondary" className="show-only-when-wide"
                    onClick={download}>
                {_("Download")}
            </Button>);
        const menu = <Menu items={[
            <MenuItem key="download"
                      onlyNarrow
                      onClick={download}>
                {_("Download")}
            </MenuItem>,
            <MenuItem key="remove"
                      onClick={remove}>
                {_("Delete")}
            </MenuItem>
        ]} />;

        return {
            props: { key: path },
            columns: [
                report.name,
                timeformat.distanceToNow(new Date(report.date * 1000), true),
                { title: <LabelGroup>{labels}</LabelGroup> },
                {
                    title: <>{action}{menu}</>,
                    props: { className: "pf-c-table__action table-row-action" }
                },
            ]
        };
    }

    return (
        <PageSection>
            <Card className="ct-card">
                <CardHeader>
                    <CardTitle>
                        <Text component={TextVariants.h2}>{_("Reports")}</Text>
                    </CardTitle>
                    <CardActions>
                        <Button id="create-button" variant="primary" onClick={run_report}>
                            {_("Run report")}
                        </Button>
                    </CardActions>
                </CardHeader>
                <CardBody className="contains-list">
                    <ListingTable emptyCaption={_("No system reports.")}
                                  columns={ [
                                      { title: _("Report") },
                                      { title: _("Created") },
                                      { title: _("Attributes") },
                                  ] }
                                  rows={Object
                                          .keys(lister.reports)
                                          .sort((a, b) => lister.reports[b].date - lister.reports[a].date)
                                          .map(make_report_row)} />
                </CardBody>
            </Card>
        </PageSection>);
};

const SOSPage = () => {
    return (
        <WithDialogs>
            <Page>
                <PageSection variant={PageSectionVariants.light}>
                    <Flex alignItems={{ default: 'alignItemsCenter' }}>
                        <h2 className="pf-u-font-size-3xl">{_("System diagnostics")}</h2>
                    </Flex>
                </PageSection>
                <SOSBody />
            </Page>
        </WithDialogs>);
};

document.addEventListener("DOMContentLoaded", () => {
    cockpit.translate();
    ReactDOM.render(<SOSPage />, document.getElementById('app'));
});
