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

import '../lib/patternfly/patternfly-5-cockpit.scss';
import './sosreport.scss';
import "polyfills";
import 'cockpit-dark-theme'; // once per page

import React, { useState } from "react";
import { createRoot } from 'react-dom/client';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { CodeBlockCode } from "@patternfly/react-core/dist/esm/components/CodeBlock/index.js";
import { Modal } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Card, CardBody, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { Page, PageSection, PageSectionVariants } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Label, LabelGroup } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { Dropdown, DropdownItem, KebabToggle } from '@patternfly/react-core/dist/esm/deprecated/components/Dropdown/index.js';
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { InputGroup } from "@patternfly/react-core/dist/esm/components/InputGroup/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { EyeIcon, EyeSlashIcon } from '@patternfly/react-icons';

import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";
import { ListingTable } from "cockpit-components-table.jsx";

import cockpit from "cockpit";
import { superuser } from "superuser";
import { useObject, useEvent } from "hooks";

import { SuperuserButton } from "../shell/superuser.jsx";

import { fmt_to_fragments } from "utils.jsx";
import * as timeformat from "timeformat";
import { WithDialogs, useDialogs } from "dialogs.jsx";
import { FormHelper } from "cockpit-components-form-helper";

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
                obfuscated,
                name
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

        watch = cockpit.channel({ payload: "fswatch1", path: "/var/tmp", superuser: true });
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

function sosCreate(args, setProgress, setError, setErrorDetail) {
    let output = "";
    let plugins_count = 0;
    const progress_regex = /Running ([0-9]+)\/([0-9]+):/; // Only for sos < 3.6
    const finishing_regex = /Finishing plugins.*\[Running: (.*)\]/;
    const starting_regex = /Starting ([0-9]+)\/([0-9]+).*\[Running: (.*)\]/;

    // TODO - Use a real API instead of scraping stdout once such an API exists
    const task = cockpit.spawn(["sos", "report", "--batch"].concat(args),
                               { superuser: true, err: "out", pty: true });

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

        setProgress(p);
    });

    task.catch(error => {
        setError(error.toString());
        setErrorDetail(output);
    });

    return task;
}

function sosDownload(path) {
    const basename = path.replace(/.*\//, "");
    const query = window.btoa(JSON.stringify({
        payload: "fsread1",
        binary: "raw",
        path,
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
    const Dialogs = useDialogs();
    const [label, setLabel] = useState("");
    const [passphrase, setPassphrase] = useState("");
    const [showPassphrase, setShowPassphrase] = useState(false);
    const [obfuscate, setObfuscate] = useState(false);
    const [verbose, setVerbose] = useState(false);
    const [task, setTask] = useState(null);
    const [progress, setProgress] = useState(null);
    const [error, setError] = useState(null);
    const [errorDetail, setErrorDetail] = useState(null);

    function run() {
        setError(null);
        setProgress(null);

        const args = [];

        if (label) {
            args.push("--label");
            args.push(label);
        }

        if (passphrase) {
            args.push("--encrypt-pass");
            args.push(passphrase);
        }

        if (obfuscate) {
            args.push("--clean");
        }

        if (verbose) {
            args.push("-v");
        }

        const task = sosCreate(args, setProgress, err => { if (err == "cancelled") Dialogs.close(); else setError(err); },
                               setErrorDetail);
        setTask(task);
        task.then(Dialogs.close);
        task.finally(() => setTask(null));
    }

    const actions = [];
    actions.push(<Button key="run" isLoading={!!task} isDisabled={!!task} onClick={run}>
        {_("Run report")}
    </Button>);
    if (task)
        actions.push(<Button key="stop" variant="secondary" onClick={() => task.close("cancelled")}>
            {_("Stop report")}
        </Button>);
    else
        actions.push(<Button key="cancel" variant="link" onClick={Dialogs.close}>
            {_("Cancel")}
        </Button>);

    return <Modal id="sos-dialog"
                  position="top"
                  variant="medium"
                  isOpen
                  onClose={Dialogs.close}
                  footer={
                      <>
                          {actions}
                          {progress ? <span>{cockpit.format(_("Progress: $0"), progress.toFixed() + "%")}</span> : null}
                      </>
                  }
                  title={ _("Run new report") }>
        { error
            ? <>
                <Alert variant="warning" isInline title={error}>
                    <CodeBlockCode>{errorDetail}</CodeBlockCode>
                </Alert>
                <br />
            </>
            : null }
        <p>{ _("SOS reporting collects system information to help with diagnosing problems.") }</p>
        <p>{ _("This information is stored only on the system.") }</p>
        <br />
        <Form isHorizontal>
            <FormGroup label={_("Report label")}>
                <TextInput id="sos-dialog-ti-1" value={label} onChange={(_event, value) => setLabel(value)} />
            </FormGroup>
            <FormGroup label={_("Encryption passphrase")}>
                <InputGroup>
                    <TextInput type={showPassphrase ? "text" : "password"} value={passphrase} onChange={(_event, value) => setPassphrase(value)}
                               id="sos-dialog-ti-2" autoComplete="new-password" />
                    <Button variant="control" onClick={() => setShowPassphrase(!showPassphrase)}>
                        { showPassphrase ? <EyeSlashIcon /> : <EyeIcon /> }
                    </Button>
                </InputGroup>
                <FormHelper helperText={_("Leave empty to skip encryption")} />
            </FormGroup>
            <FormGroup label={_("Options")} hasNoPaddingTop>
                <Checkbox label={_("Obfuscate network addresses, hostnames, and usernames")}
                          id="sos-dialog-cb-1" isChecked={obfuscate} onChange={(_, o) => setObfuscate(o)} />
                <Checkbox label={_("Use verbose logging")}
                          id="sos-dialog-cb-2" isChecked={verbose} onChange={(_, v) => setVerbose(v)} />
            </FormGroup>
        </Form>
    </Modal>;
};

const SOSRemoveDialog = ({ path }) => {
    const Dialogs = useDialogs();
    const [task, setTask] = useState(null);
    const [error, setError] = useState(null);

    function remove() {
        setError(null);
        setTask(sosRemove(path)
                .then(Dialogs.close)
                .catch(err => {
                    setTask(null);
                    setError(err.toString());
                }));
    }

    return (
        <Modal id="sos-remove-dialog"
               position="top"
               variant="medium"
               isOpen
               onClose={Dialogs.close}
               title={_("Delete report permanently?")}
               titleIconVariant="warning"
               actions={[
                   <Button key="apply"
                           variant="danger"
                           onClick={remove}
                           isLoading={!!task}
                           isDisabled={!!task}>
                       {_("Delete")}
                   </Button>,
                   <Button key="cancel"
                           onClick={Dialogs.close}
                           isDisabled={!!task}
                           variant="link">
                       {_("Cancel")}
                   </Button>
               ]}>
            { error && <><Alert variant="warning" isInline title={error} /><br /></> }
            <p>{fmt_to_fragments(_("The file $0 will be deleted."), <b>{path}</b>)}</p>
        </Modal>);
};

const SOSErrorDialog = ({ error }) => {
    const Dialogs = useDialogs();

    return (
        <Modal id="sos-error-dialog"
               position="top"
               variant="medium"
               isOpen
               onClose={Dialogs.close}
               title={ _("Error") }>
            <p>{error}</p>
        </Modal>);
};

const Menu = ({ items }) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <Dropdown onSelect={() => setIsOpen(!isOpen)}
                  toggle={<KebabToggle onToggle={(_, isOpen) => setIsOpen(isOpen)} />}
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
                    props: { className: "pf-v5-c-table__action table-row-action" }
                },
            ]
        };
    }

    return (
        <PageSection>
            <Card className="ct-card">
                <CardHeader actions={{
                    actions: <Button id="create-button" variant="primary" onClick={run_report}>
                        {_("Run report")}
                    </Button>,
                }}>
                    <CardTitle component="h2">{_("Reports")}</CardTitle>
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
                <PageSection padding={{ default: "padding" }} variant={PageSectionVariants.light}>
                    <Flex alignItems={{ default: 'alignItemsCenter' }}>
                        <h2 className="pf-v5-u-font-size-3xl">{_("System diagnostics")}</h2>
                    </Flex>
                </PageSection>
                <SOSBody />
            </Page>
        </WithDialogs>);
};

document.addEventListener("DOMContentLoaded", () => {
    cockpit.translate();
    const root = createRoot(document.getElementById('app'));
    root.render(<SOSPage />);
});
