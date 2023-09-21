/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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

import PropTypes from 'prop-types';
import React from 'react';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { DataList, DataListCell, DataListItem, DataListItemCells, DataListItemRow } from "@patternfly/react-core/dist/esm/components/DataList/index.js";
import { Modal } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Tab, Tabs } from "@patternfly/react-core/dist/esm/components/Tabs/index.js";
import { TextArea } from "@patternfly/react-core/dist/esm/components/TextArea/index.js";
import { CheckIcon, CopyIcon, ExternalLinkAltIcon, OutlinedQuestionCircleIcon } from '@patternfly/react-icons';

import cockpit from "cockpit";
import 'cockpit-components-modifications.css';

const _ = cockpit.gettext;

/* Dialog for showing scripts to modify system
 *
 * Enables showing shell and ansible script. Shell one is mandatory and ansible one can be omitted.
 *
 */
export const ModificationsExportDialog = ({ show, onClose, shell, ansible }) => {
    const [active_tab, setActiveTab] = React.useState("ansible");
    const [copied, setCopied] = React.useState(false);
    const [timeoutId, setTimeoutId] = React.useState(null);

    const handleSelect = (_event, active_tab) => {
        setCopied(false);
        setActiveTab(active_tab);
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            setTimeoutId(null);
        }
    };

    const copyToClipboard = () => {
        try {
            navigator.clipboard.writeText((active_tab === "ansible" ? ansible : shell).trim())
                    .then(() => {
                        setCopied(true);
                        setTimeoutId(setTimeout(() => {
                            setCopied(false);
                            setTimeoutId(null);
                        }, 3000));
                    })
                    .catch(e => console.error('Text could not be copied: ', e ? e.toString() : ""));
        } catch (error) {
            console.error('Text could not be copied: ', error.toString());
        }
    };

    const footer = (
        <>
            <Button variant='secondary' className="btn-clipboard" onClick={copyToClipboard} icon={copied ? <CheckIcon className="green-icon" /> : <CopyIcon />}>
                { _("Copy to clipboard") }
            </Button>
            <Button variant='secondary' className='btn-cancel' onClick={onClose}>
                { _("Close") }
            </Button>
        </>
    );

    return (
        <Modal isOpen={show} className="automation-script-modal"
               position="top" variant="medium"
               onClose={onClose}
               footer={footer}
               title={_("Automation script") }>
            <Tabs activeKey={active_tab} onSelect={handleSelect}>
                <Tab eventKey="ansible" title={_("Ansible")}>
                    <TextArea resizeOrientation='vertical' readOnlyVariant="default" defaultValue={ansible.trim()} />
                    <div className="ansible-docs-link">
                        <OutlinedQuestionCircleIcon />
                        { _("Create new task file with this content.") }
                        <Button variant="link" component="a" href="https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_reuse_roles.html"
                                target="_blank" rel="noopener noreferrer"
                                icon={<ExternalLinkAltIcon />}>
                            { _("Ansible roles documentation") }
                        </Button>
                    </div>
                </Tab>
                <Tab eventKey="shell" title={_("Shell script")}>
                    <TextArea resizeOrientation='vertical' readOnlyVariant="default" defaultValue={shell.trim()} />
                </Tab>
            </Tabs>
        </Modal>
    );
};

ModificationsExportDialog.propTypes = {
    shell: PropTypes.string.isRequired,
    ansible: PropTypes.string.isRequired,
    show: PropTypes.bool.isRequired,
    onClose: PropTypes.func.isRequired,
};

/* Display list of modifications in human readable format
 *
 * Also show `View automation script` button which opens dialog in which different
 * scripts are available. With these scripts it is possible to apply the same
 * configurations to  other machines.
 *
 * Pass array `entries` to show human readable messages.
 * Pass string `shell` and `ansible` with scripts.
 *
 */
export const Modifications = ({ entries, failed, permitted, title, shell, ansible }) => {
    const [showDialog, setShowDialog] = React.useState(false);

    let emptyRow = null;
    let fail_message = permitted ? _("No system modifications") : _("The logged in user is not permitted to view system modifications");
    fail_message = failed || fail_message;
    if (entries === null) {
        emptyRow = <DataListItem>
            <DataListItemRow>
                <DataListItemCells dataListCells={[<DataListCell key="loading">{_("Loading system modifications...")}</DataListCell>]} />
            </DataListItemRow>
        </DataListItem>;
    }
    if (entries?.length === 0) {
        emptyRow = <DataListItem>
            <DataListItemRow>
                <DataListItemCells dataListCells={[<DataListCell key={fail_message}>{fail_message}</DataListCell>]} />
            </DataListItemRow>
        </DataListItem>;
    }

    return (
        <>
            <ModificationsExportDialog show={showDialog} shell={shell} ansible={ansible} onClose={() => setShowDialog(false)} />
            <Card className="modifications-table">
                <CardHeader>
                    <CardTitle component="h2">{title}</CardTitle>
                    { !emptyRow &&
                        <Button variant="secondary" onClick={() => setShowDialog(true)}>
                            {_("View automation script")}
                        </Button>
                    }
                </CardHeader>
                <CardBody className="contains-list">
                    <DataList aria-label={title} isCompact>
                        { emptyRow ||
                            entries.map(entry => <DataListItem key={entry}>
                                <DataListItemRow>
                                    <DataListItemCells dataListCells={[<DataListCell key={entry}>{entry}</DataListCell>]} />
                                </DataListItemRow>
                            </DataListItem>
                            )
                        }
                    </DataList>
                </CardBody>
            </Card>
        </>
    );
};

Modifications.propTypes = {
    failed: PropTypes.string,
    title: PropTypes.string.isRequired,
    permitted: PropTypes.bool.isRequired,
    entries: PropTypes.arrayOf(PropTypes.string),
    shell: PropTypes.string.isRequired,
    ansible: PropTypes.string.isRequired,
};
