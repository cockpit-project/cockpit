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

import { Listing, ListingRow } from "cockpit-components-listing.jsx";

import { VmLastMessage, VmDescription, VmMemory, VmCpu, VmOS, VmHA, VmStateless } from './ClusterVms.jsx';
import { createVmFromTemplate } from '../actions.es6';
import { getCurrentCluster } from '../selectors.es6';
import { logDebug } from '../../machines/helpers.es6';

const NoTemplate = () => (<div>{_("No VM found in oVirt.")}</div>);
const NoTemplateUnitialized = () => (<div>{_("Please wait till list of templates is loaded from the server.")}</div>);

const _ = cockpit.gettext;

class CreateVmFromTemplate extends React.Component {
    constructor (props) {
        super(props);
        this.state = {
            enterDetails: false,
            vmName: '',
        };

        this.onDoCreateVm = this.onDoCreateVm.bind(this);
        this.onCreateVm = this.onCreateVm.bind(this);
        this.onCancel = this.onCancel.bind(this);

        this.onVmNameChanged = this.onVmNameChanged.bind(this);
    }

    onCreateVm () {
        this.setState({ enterDetails: true, vmName: '' });
    }

    onCancel () {
        this.setState({ enterDetails: false, vmName: '' });
    }

    onVmNameChanged (e) {
        this.setState({ vmName: e.target.value });
    }

    onDoCreateVm () {
        this.props.dispatch(createVmFromTemplate({
            templateName: this.props.template.name,
            clusterName: this.props.cluster.name,
            vm: { name: this.state.vmName }
        }));
        this.setState({ enterDetails: false, vmName: '' });
    }

    render () {
        if (this.state.enterDetails) {
            return (
                <div>
                    <input className='form-control' type='text' placeholder={_("Enter New VM name")} value={this.state.vmName} onChange={this.onVmNameChanged} />
                    <button onClick={this.onCancel} className='btn btn-default btn-danger'>{_("Cancel")}</button>
                    <button onClick={this.onDoCreateVm} className='btn btn-default btn-danger'>{_("Create")}</button>
                </div>
            );
        }

        return (<button onClick={this.onCreateVm}>{_("Create VM")}</button>);
    }
}

const TemplateActions = ({ template, cluster, dispatch }) => {
    if (!cluster) {
        logDebug('TemplateActions: unknown cluster');
        return null;
    }

    return (
        <span>
            <CreateVmFromTemplate template={template} cluster={cluster} dispatch={dispatch} />
            <VmLastMessage vm={template} />
        </span>
    );
};

const Template = ({ template, templates, cluster, dispatch }) => {
    return (<ListingRow
        columns={[
            {name: template.name, 'header': true},
            template.version.name,
            template.version.baseTemplateId ? (templates[template.version.baseTemplateId].name) : null,
            <VmDescription descr={template.description} />,
            <VmMemory mem={template.memory} />,
            <VmCpu vm={template} />,
            <VmOS os={template.os} />,
            <VmHA highAvailability={template.highAvailability} />,
            <VmStateless stateless={template.stateless} />,
            <TemplateActions template={template} cluster={cluster} dispatch={dispatch} />
        ]}
    />);
};

const ClusterTemplates = ({ config, dispatch }) => {
    const { templates, hosts, clusters, ovirtConfig } = config.providerState;

    if (!templates) { // before cluster templates are loaded ;
        return (<NoTemplateUnitialized />);
    }

    if (templates.length === 0) { // there are no templates
        return (<NoTemplate />);
    }

    const currentCluster = getCurrentCluster(hosts, clusters, ovirtConfig);
    let title = cockpit.format(_("Cluster Templates"));
    if (currentCluster) {
        title = cockpit.format(_("Templates of $0 cluster"), currentCluster.name);
    }

    return (<div className='container-fluid'>
        <Listing title={title} emptyCaption='' columnTitles={[
            _("Name"), _("Version"), _("Base Template"), _("Description"), _("Memory"), _("vCPUs"), _("OS"),
            _("HA"), _("Stateless"), _("Action")]}>
            {Object.getOwnPropertyNames(templates).map(templateId => {
                return (
                    <Template template={templates[templateId]}
                        templates={templates}
                        cluster={currentCluster}
                        dispatch={dispatch}
                        key={templateId} />);
            })}
        </Listing>
    </div>);
};

export default ClusterTemplates;
