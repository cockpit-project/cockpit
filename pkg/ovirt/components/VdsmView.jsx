/*jshint esversion: 6 */
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
import React from "react";
import cockpit from 'cockpit';

import './VdsmView.css';

import { VDSM_CONF_FILE } from '../config.es6';
import { logDebug, logError } from '../../machines/helpers.es6';

React;
const _ = cockpit.gettext;

class VdsmConf extends React.Component { // TODO: needs design
    constructor (props) {
        super(props)

        this.state = {
            fileContent: _("Loading data ..."),
            changed: false,
            loaded: false,
            reloadConfirmation: false,
            saveConfirmation: false,
        };

        this.onSave = this.onSave.bind(this);
        this.onSaveConfirmed = this.onSaveConfirmed.bind(this);
        this.onSaveCanceled = this.onSaveCanceled.bind(this);

        this.onReload = this.onReload.bind(this);
        this.onReloadConfirmed = this.onReloadConfirmed.bind(this);
        this.onReloadCanceled = this.onReloadCanceled.bind(this);

        this.onEditorChange = this.onEditorChange.bind(this);
    }

    componentDidMount() {
        this.doReload();
    }

    componentWillUnmount() {
    }

    doReload () {
        cockpit.file(VDSM_CONF_FILE).read()
            .done( (content) => {
                this.setState({ fileContent: content, changed: false, loaded: true });
            }).fail( (error) => { // TODO: more visible for the user
            logError(`Error reading ${VDSM_CONF_FILE}: ${JSON.stringify(error)}`);
        })
    }

    doSave () {
        cockpit.file(VDSM_CONF_FILE, { superuser: 'try' }).replace(this.state.fileContent)
            .done( () => {
                logDebug('Content of vdsm.conf replaced.')
                this.setState({ changed: false });
            }).fail( (error) => {
                logError(`Error writing ${VDSM_CONF_FILE}: ${JSON.stringify(error)}`);
        })
    }

    onSave () {this.setState({saveConfirmation: true});} // render confirmation buttons
    onSaveConfirmed () {this.doSave(); this.setState({saveConfirmation: false});}
    onSaveCanceled () {this.setState({saveConfirmation: false});}

    onReload () {this.setState({reloadConfirmation: true});} // render confirmation buttons
    onReloadConfirmed () {this.doReload(); this.setState({reloadConfirmation: false});}
    onReloadCanceled () {this.setState({reloadConfirmation: false});}

    onEditorChange (event) {this.setState({fileContent: event.target.value, changed: true});}

    render () {
        let reloadButton = null;
        if (!this.state.saveConfirmation) {
            if (this.state.reloadConfirmation) {
                reloadButton = (
                    <span>&nbsp;{_("Confirm reload:")}&nbsp;
                        <button className='btn btn-danger btn-xs' onClick={this.onReloadConfirmed}>{_("OK")}</button>&nbsp;
                        <button className='btn btn-primary btn-xs' onClick={this.onReloadCanceled}>{_("Cancel")}</button>
                    </span>);
            } else {
                reloadButton = (<button className='btn btn-default' onClick={this.onReload}>{_("Reload")}</button>);
            }
        }

        let saveButton = null;
        if (!this.state.reloadConfirmation) {
            if (this.state.saveConfirmation) {
                saveButton = (
                    <span>&nbsp;{_("Confirm save:")}&nbsp;
                        <button className='btn btn-danger btn-xs' onClick={this.onSaveConfirmed}>{_("OK")}</button>
                        &nbsp;
                        <button className='btn btn-primary btn-xs' onClick={this.onSaveCanceled}>{_("Cancel")}</button>
                    </span>)
            } else {
                saveButton = (<button className='btn btn-default' onClick={this.onSave} disabled={!this.state.changed}>{_("Save")}</button>)
            }
        }

        let loaded = null;
        if (this.state.loaded) {
            loaded = (<div id='vdsmview-data-loaded'/>);
        }

        return (
            <div className='ovirt-provider-vdsm'>
                <h1>{_("Edit the vdsm.conf")}</h1>

                <a href='/system/services#/vdsmd.service' target='_top'>
                    {_("VDSM Service Management")}
                </a>

                <div className='ovirt-provider-vdsm-menu'>
                    <div className="ovirt-provider-vdsm-inline-block"></div>
                    <div className='btn-group ovirt-provider-vdsm-menu-buttons'>
                        {saveButton}
                        {reloadButton}
                    </div>
                </div>

                <br/>
                <textarea className='ovirt-provider-vdsm-editor' value={this.state.fileContent} onChange={this.onEditorChange}/>

                {loaded}
            </div>
        );

    }
}

const VdsmView = () => {
    return (<div>
        <VdsmConf />
    </div>);
};

export default VdsmView;
