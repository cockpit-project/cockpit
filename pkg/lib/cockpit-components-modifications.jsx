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
import { Button, Modal, Nav, NavItem, TabContent, TabPane, TabContainer } from 'patternfly-react';

import cockpit from "cockpit";
import './listing.less';
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

        this.state = {
            active_tab: "shell",
            copied: false
        };

        this.handleSelect = this.handleSelect.bind(this);
        this.copyToClipboard = this.copyToClipboard.bind(this);
    }

    handleSelect(active_tab) {
        this.setState({ active_tab });
    }

    copyToClipboard() {
        try {
            navigator.clipboard.writeText(this.props[this.state.active_tab])
                    .then(() => {
                        this.setState({ copied: true });
                        setTimeout(() => {
                            this.setState({ copied: false });
                        }, 3000);
                    })
                    .catch(e => console.error('Text could not be copied: ', e ? e.toString() : ""));
        } catch (error) {
            console.error('Text could not be copied: ', error.toString());
        }
    }

    render() {
        return (
            <Modal show={this.props.show} className="automation-script-modal">
                <Modal.Header>
                    <Modal.Title>{ _("Automation Script") }</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <TabContainer id="basic-tabs-pf" defaultActiveKey={"shell"}>
                        <React.Fragment>
                            <Nav bsClass="nav nav-tabs nav-tabs-pf" onSelect={this.handleSelect}>
                                <NavItem eventKey={"shell"}>
                                    {_("Shell Script")}
                                </NavItem>
                                {this.props.ansible &&
                                    <NavItem eventKey={"ansible"}>
                                        {_("Ansible Playbook")}
                                    </NavItem>
                                }
                            </Nav>
                            <TabContent animation>
                                <TabPane eventKey={"shell"}>
                                    <pre>
                                        {this.props.shell}
                                    </pre>
                                </TabPane>
                                {this.props.ansible &&
                                    <TabPane eventKey={"ansible"}>
                                        <pre>
                                            {this.props.ansible}
                                        </pre>
                                    </TabPane>
                                }
                            </TabContent>
                        </React.Fragment>
                    </TabContainer>
                </Modal.Body>
                <Modal.Footer>
                    <Button bsStyle='default' className='btn' onClick={this.copyToClipboard}>
                        { this.state.copied ? <span className="fa fa-check fa-xs green-icon" /> : <span className="fa fa-clipboard fa-xs" /> }
                        <span>{ _("Copy to clipboard") }</span>
                    </Button>
                    <Button bsStyle='default' className='btn-cancel' onClick={this.props.onClose}>
                        { _("Close") }
                    </Button>
                </Modal.Footer>
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
        let fail_message = this.props.permitted ? _("No System Modifications") : _("The logged in user is not permitted to view system modifications");
        fail_message = this.props.failed ? _("Error running semanage to discover system modifications") : fail_message;
        if (this.props.entries === null) {
            emptyRow = <thead className={"listing-ct-empty"}>
                <tr className="modification-row">
                    <td>
                        <div className="spinner spinner-sm" />
                        <span>{_("Loading system modifications...")}</span>
                    </td>
                </tr>
            </thead>;
        }
        if (this.props.entries !== null && this.props.entries.length === 0) {
            emptyRow = <thead className={"listing-ct-empty"}>
                <tr className="modification-row">
                    <td>
                        { fail_message }
                    </td>
                </tr>
            </thead>;
        }

        return (
            <React.Fragment>
                <ModificationsExportDialog show={this.state.showDialog} shell={this.props.shell} ansible={this.props.ansible} onClose={ () => this.setState({ showDialog: false }) } />
                <table className={"listing-ct listing-ct-wide modifications-table"}>
                    <caption className="cockpit-caption">
                        <div className="modifications-caption">
                            {this.props.title}
                            { !emptyRow &&
                                <a className="modifications-export" onClick={ () => this.setState({ showDialog: true }) } >{_("View automation script")}</a>
                            }
                        </div>
                    </caption>
                    { emptyRow ||
                        <tbody>
                            {this.props.entries.map(entry => <tr className="modification-row" key={entry.split(' ').join('')}><td>{entry}</td></tr>)}
                        </tbody>
                    }
                </table>
            </React.Fragment>
        );
    }
}

Modifications.propTypes = {
    title: PropTypes.string.isRequired,
    permitted: PropTypes.bool.isRequired,
    entries: PropTypes.arrayOf(PropTypes.string),
    shell: PropTypes.string.isRequired,
    ansible: PropTypes.string,
};
