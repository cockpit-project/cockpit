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
class ModificationsExportDialog extends React.Component {
    constructor(props) {
        super(props);

        this.timeoutId = null;
        this.state = {
            active_tab: "shell",
            copied: false
        };

        this.handleSelect = this.handleSelect.bind(this);
        this.copyToClipboard = this.copyToClipboard.bind(this);
    }

    handleSelect(event, active_tab) {
        this.setState({ active_tab, copied: false });
        if (this.timeoutId !== null) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
    }

    copyToClipboard() {
        try {
            navigator.clipboard.writeText(this.props[this.state.active_tab].trim())
                    .then(() => {
                        this.setState({ copied: true });
                        this.timeoutId = setTimeout(() => {
                            this.setState({ copied: false });
                        }, 3000);
                    })
                    .catch(e => console.error('Text could not be copied: ', e ? e.toString() : ""));
        } catch (error) {
            console.error('Text could not be copied: ', error.toString());
        }
    }

    render() {
        const footer = (
            <>
                <Button variant='secondary' className="btn-clipboard" onClick={this.copyToClipboard} icon={this.state.copied ? <CheckIcon className="green-icon" /> : <CopyIcon />}>
                    { _("Copy to clipboard") }
                </Button>
                <Button variant='secondary' className='btn-cancel' onClick={this.props.onClose}>
                    { _("Close") }
                </Button>
            </>
        );
        return (
            <Modal isOpen={this.props.show} className="automation-script-modal"
                   position="top" variant="medium"
                   onClose={this.props.onClose}
                   footer={footer}
                   title={_("Automation script") }>
                <Tabs activeKey={this.state.active_tab} onSelect={this.handleSelect}>
                    <Tab eventKey="shell" title={_("Shell script")}>
                        <TextArea resizeOrientation='vertical' readOnlyVariant="default" defaultValue={this.props.shell.trim()} />
                    </Tab>
                    <Tab eventKey="ansible" title={_("Ansible")}>
                        <TextArea resizeOrientation='vertical' readOnlyVariant="default" defaultValue={this.props.ansible.trim()} />
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
                </Tabs>
            </Modal>
        );
    }
}

ModificationsExportDialog.propTypes = {
    shell: PropTypes.string.isRequired,
    ansible: PropTypes.string,
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
export class Modifications extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            showDialog: false,
        };
    }

    render() {
        let emptyRow = null;
        let fail_message = this.props.permitted ? _("No system modifications") : _("The logged in user is not permitted to view system modifications");
        fail_message = this.props.failed ? _("Error running semanage to discover system modifications") : fail_message;
        if (this.props.entries === null) {
            emptyRow = <DataListItem>
                <DataListItemRow>
                    <DataListItemCells dataListCells={[<DataListCell key="loading">{_("Loading system modifications...")}</DataListCell>]} />
                </DataListItemRow>
            </DataListItem>;
        }
        if (this.props.entries?.length === 0) {
            emptyRow = <DataListItem>
                <DataListItemRow>
                    <DataListItemCells dataListCells={[<DataListCell key={fail_message}>{fail_message}</DataListCell>]} />
                </DataListItemRow>
            </DataListItem>;
        }

        return (
            <>
                <ModificationsExportDialog show={this.state.showDialog} shell={this.props.shell} ansible={this.props.ansible} onClose={ () => this.setState({ showDialog: false }) } />
                <Card className="modifications-table">
                    <CardHeader>
                        <CardTitle component="h2">{this.props.title}</CardTitle>
                        { !emptyRow &&
                            <Button variant="secondary" onClick={() => this.setState({ showDialog: true }) }>
                                {_("View automation script")}
                            </Button>
                        }
                    </CardHeader>
                    <CardBody className="contains-list">
                        <DataList aria-label={this.props.title} isCompact>
                            { emptyRow ||
                                this.props.entries.map(entry => <DataListItem key={entry}>
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
    }
}

Modifications.propTypes = {
    failed: PropTypes.bool,
    title: PropTypes.string.isRequired,
    permitted: PropTypes.bool.isRequired,
    entries: PropTypes.arrayOf(PropTypes.string),
    shell: PropTypes.string.isRequired,
    ansible: PropTypes.string,
};
