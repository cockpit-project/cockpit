/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

import cockpit from "cockpit";
import * as cockpitListing from "cockpit-components-listing.jsx";
import { InsightsStatus } from './insights.jsx';

const _ = cockpit.gettext;

// Show details for an installed product
class SubscriptionProductDetails extends React.Component {
    render() {
        return (
            <table key={this.props.productId}>
                <tbody>
                    <tr><td className="form-tr-ct-title">{_("Product name")}</td><td><span>{this.props.productName}</span></td></tr>
                    <tr><td className="form-tr-ct-title">{_("Product ID")}</td><td><span>{this.props.productId}</span></td></tr>
                    <tr><td className="form-tr-ct-title">{_("Version")}</td><td><span>{this.props.version}</span></td></tr>
                    <tr><td className="form-tr-ct-title">{_("Architecture")}</td><td><span>{this.props.arch}</span></td></tr>
                    <tr><td className="form-tr-ct-title">{_("Status")}</td><td><span>{this.props.status}</span></td></tr>
                    <tr><td className="form-tr-ct-title">{_("Starts")}</td><td><span>{this.props.starts}</span></td></tr>
                    <tr><td className="form-tr-ct-title">{_("Ends")}</td><td><span>{this.props.ends}</span></td></tr>
                </tbody>
            </table>
        );
    }
}

/* 'Curtains' implements a subset of the PatternFly Empty State pattern
 * https://www.patternfly.org/patterns/empty-state/
 * Special values for icon property:
 *   - 'waiting' - display spinner
 *   - 'error'   - display error icon
 */
class Curtains extends React.Component {
    render() {
        var description = null;
        if (this.props.description)
            description = <h1>{this.props.description}</h1>;

        var message = null;
        if (this.props.message)
            message = <p>{this.props.message}</p>;

        var curtains = "curtains-ct";

        var icon = this.props.icon;
        if (icon == 'waiting')
            icon = <div className="spinner spinner-lg" />;
        else if (icon == 'error')
            icon = <div className="pficon pficon-error-circle-o" />;

        return (
            <div className={ curtains + " blank-slate-pf" }>
                <div className="blank-slate-pf-icon">
                    {icon}
                </div>
                {description}
                {message}
            </div>
        );
    }
}

/* Component to show a dismissable error, message as child text
 * dismissError callback function triggered when the close button is pressed
 */
class DismissableError extends React.Component {
    constructor(props) {
        super(props);
        this.handleDismissError = this.handleDismissError.bind(this);
    }

    handleDismissError(e) {
        // only consider primary mouse button
        if (!e || e.button !== 0)
            return;
        if (this.props.dismissError)
            this.props.dismissError();
        e.stopPropagation();
    }

    render() {
        return (
            <div className="alert alert-danger alert-dismissable alert-ct-top">
                <span className="pficon pficon-error-circle-o" />
                <span>{this.props.children}</span>
                <button type="button" className="close" aria-hidden="true" onClick={this.handleDismissError}>
                    <span className="pficon pficon-close" />
                </button>
            </div>
        );
    }
}

/* Show subscriptions status of the system, offer to register/unregister the system
 * Expected properties:
 * status        subscription status
 * error        error message to show (in Curtains if not connected, as a dismissable alert otherwise
 * dismissError callback, triggered for the dismissable error in connected state
 * register     callback, triggered when user clicks on register
 * unregister   callback, triggered when user clicks on unregister
 */
class SubscriptionStatus extends React.Component {
    constructor(props) {
        super(props);
        this.handleRegisterSystem = this.handleRegisterSystem.bind(this);
        this.handleUnregisterSystem = this.handleUnregisterSystem.bind(this);
    }

    handleRegisterSystem(e) {
        // only consider primary mouse button
        if (!e || e.button !== 0)
            return;
        this.props.register();
        e.stopPropagation();
    }

    handleUnregisterSystem(e) {
        // only consider primary mouse button
        if (!e || e.button !== 0)
            return;
        this.props.unregister();
        e.stopPropagation();
    }

    render() {
        var errorMessage;
        if (this.props.error) {
            errorMessage = (
                <DismissableError dismissError={this.props.dismissError}>{this.props.error}</DismissableError>
            );
        }

        var label;
        var action;
        var insights;
        var note;
        var isUnregistering = (this.props.status == "unregistering");
        if (this.props.status == 'Unknown') {
            label = <label>{ _("Status: System isn't registered") }</label>;
            action = (<button className="btn btn-primary"
                              onClick={this.handleRegisterSystem}>{_("Register")}</button>
            );
        } else {
            label = <label>{ cockpit.format(_("Status: $0"), this.props.status) }</label>;
            action = (<button className="btn btn-primary" disabled={isUnregistering}
                              onClick={this.handleUnregisterSystem}>{_("Unregister")}</button>
            );
            if (isUnregistering) {
                note = (
                    <div className="dialog-wait-ct">
                        <div className="spinner spinner-sm" />
                        <span>{ _("Unregistering system...") }</span>
                    </div>
                );
            }
            if (this.props.insights_available)
                insights = <InsightsStatus />;
        }
        return (
            <div className="subscription-status-ct">
                <h2>{_("Subscriptions")}</h2>
                {errorMessage}
                {label}
                {action}
                {insights}
                {note}
            </div>
        );
    }
}

/* Show subscriptions status of the system and registered products, offer to register/unregister the system
 * Expected properties:
 * status       subscription status
 * error        error message to show (in Curtains if not connected, as a dismissable alert otherwise
 * dismissError callback, triggered for the dismissable error in connected state
 * products     subscribed products (properties as in subscriptions-client)
 * register     callback, triggered when user clicks on register
 * unregister   callback, triggered when user clicks on unregister
 */
export class SubscriptionsPage extends React.Component {
    constructor(props) {
        super(props);
        this.renderCurtains = this.renderCurtains.bind(this);
        this.renderSubscriptions = this.renderSubscriptions.bind(this);
    }

    renderCurtains() {
        var icon;
        var description;
        var message;
        if (this.props.status === undefined) {
            icon = <div className="spinner spinner-lg" />;
            message = _("Updating");
            description = _("Retrieving subscription status...");
        } else if (this.props.status == 'access-denied') {
            icon = <i className="fa fa-exclamation-circle" />;
            message = _("Access denied");
            description = _("The current user isn't allowed to access system subscription status.");
        } else {
            icon = <i className="fa fa-exclamation-circle" />;
            message = _("Unable to connect");
            description = _("Couldn't get system subscription status. Please ensure subscription-manager is installed.");
        }
        return (
            <Curtains
                icon={icon}
                description={description}
                message={message} />
        );
    }

    renderSubscriptions() {
        var entries = this.props.products.map(function(itm) {
            var tabRenderers = [
                {
                    name: _("Details"),
                    renderer: SubscriptionProductDetails,
                    data: itm,
                },
            ];
            var columns = [ { name: itm.productName, 'header': true } ];
            return <cockpitListing.ListingRow key={itm.productId} columns={columns} tabRenderers={tabRenderers} />;
        });

        return (
            <div className="container-fluid">
                <SubscriptionStatus {...this.props } />
                <cockpitListing.Listing
                    title={ _("Installed products") }
                    emptyCaption={ _("No installed products on the system.") }
                >
                    {entries}
                </cockpitListing.Listing>
            </div>
        );
    }

    render() {
        if (this.props.status === undefined ||
            this.props.status == 'not-found' ||
            this.props.status == 'access-denied') {
            return this.renderCurtains();
        } else {
            return this.renderSubscriptions();
        }
    }
}
