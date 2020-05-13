import cockpit from "cockpit";

import React from 'react';
import ReactDOM from "react-dom";
import PropTypes from 'prop-types';
import { PageSidebar, Button } from '@patternfly/react-core';
import { EditIcon, MinusIcon } from '@patternfly/react-icons';

import 'polyfills';
import { superuser } from "superuser.jsx";
import { CockpitNav, CockpitNavItem } from "./nav.jsx";

import { machines } from "machines";
import { new_machine_dialog_manager } from "machine-dialogs";

import "../../node_modules/@patternfly/patternfly/components/Select/select.scss";

import $ from "jquery"; // Ech... Fixme: We now use the same dialogs as dashboard and we need jQuery to open them

const _ = cockpit.gettext;
const hosts_sel = document.getElementById("nav-hosts");

class HostsSelector extends React.Component {
    constructor() {
        super();
        this.el = document.createElement("div");
        this.el.className = "view-hosts";
    }

    componentDidMount() {
        hosts_sel.appendChild(this.el);
    }

    componentWillUnmount() {
        hosts_sel.removeChild(this.el);
    }

    render() {
        const { children } = this.props;
        return ReactDOM.createPortal(children, this.el);
    }
}

function HostLine({ host, user }) {
    return (
        <>
            <span id="current-username" className="username">{user}</span>
            {user && <span className="at">@</span>}
            <span className="hostname">{host}</span>
        </>
    );
}

export class CockpitHosts extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            opened: false,
            editing: false,
            current_user: "",
            current_key: props.machine.key,
            privileged: false,
        };

        this.toggleMenu = this.toggleMenu.bind(this);
        this.filterHosts = this.filterHosts.bind(this);
        this.onAddNewHost = this.onAddNewHost.bind(this);
        this.onEditHosts = this.onEditHosts.bind(this);
        this.onHostEdit = this.onHostEdit.bind(this);
        this.onRemove = this.onRemove.bind(this);

        this.machines = machines.instance();
        this.mdialogs = new_machine_dialog_manager(this.machines);
    }

    componentDidMount() {
        superuser.addEventListener("changed", () => this.setState({ privileged: !!superuser.allowed }));

        this.setState({ privileged: superuser.allowed });

        cockpit.user().then(user => {
            this.setState({ current_user: user.name || "" });
        });
    }

    componentDidUpdate(prevProps) {
        if (prevProps.machines !== this.props.machines) {
            this.machines = machines.instance();
            this.mdialogs = new_machine_dialog_manager(this.machines);
        }
    }

    static getDerivedStateFromProps(nextProps, prevState) {
        if (nextProps.machine.key !== prevState.current_key) {
            document.getElementById(nextProps.selector).classList.toggle("interact", false);
            return {
                current_key: nextProps.machine.key,
                opened: false,
                editing: false,
            };
        }
        return null;
    }

    toggleMenu() {
        document.getElementById(this.props.selector).classList.toggle("interact", !this.state.opened);

        this.setState(s => {
            return (
                {
                    opened: !s.opened,
                    editing: false,
                }
            );
        });
    }

    onAddNewHost() {
        this.mdialogs.render_dialog("add-machine", "hosts_setup_server_dialog");
    }

    onHostEdit(event, machine) {
        const dlg = $("#edit-host-dialog");

        const can_change_user = machine.address != "localhost";
        const name = document.getElementById("edit-host-name");
        name.disabled = machine.state == "failed";
        name.value = machine.label;

        document.getElementById("edit-host-user-row").hidden = !machines.allow_connection_string;
        const user = document.getElementById("edit-host-user");
        if (machines.allow_connection_string) {
            user.placeholder = this.state.current_user;
            user.disabled = !can_change_user;
            user.value = machine.user || "";
            $("#edit-host-dialog a[data-content]").popover();
        }

        this.mdialogs.render_color_picker("#edit-host-colorpicker", machine.address);

        document.getElementById("edit-host-sync-users").addEventListener("click", e => {
            dlg.modal('hide');
            this.mdialogs.render_dialog("sync-users",
                                        "hosts_setup_server_dialog",
                                        machine.address);
        });

        // Remove all existing listeners so we don't change it multiple times
        const orig = document.getElementById("edit-host-apply");
        var copy = orig.cloneNode(true);
        orig.parentNode.replaceChild(copy, orig);

        document.getElementById("edit-host-apply").addEventListener("click", e => {
            dlg.dialog('failure', null);
            const values = {
                color: machines.colors.parse(document.querySelector('#edit-host-colorpicker #host-edit-color').style["background-color"]),
                label: name.value,
            };

            if (can_change_user && machines.allow_connection_string)
                values.user = user.value;

            const promise = this.machines.change(machine.key, values);
            dlg.dialog('promise', promise);
        });
        dlg.modal('show');
    }

    onEditHosts() {
        this.setState(s => { return { editing: !s.editing } });
    }

    onRemove(event, machine) {
        event.preventDefault();
        if (this.props.machines.length <= 2)
            this.setState({ editing: false });
        this.machines.change(machine.key, { visible: false });
    }

    filterHosts(host, term) {
        if (!term)
            return host;
        const new_host = Object.assign({}, host);
        term = term.toLowerCase();

        if (host.label.toLowerCase().indexOf(term) > -1)
            new_host.keyword = host.label.toLowerCase();

        const user = host.user || this.state.current_user;
        if (user.toLowerCase().indexOf(term) > -1)
            new_host.keyword = user.toLowerCase() + " @";

        if (new_host.keyword)
            return new_host;
        return null;
    }

    // HACK: using HTMl rather than Select PF4 component as:
    // 1. It does not change the arrow when opened/closed
    // 2. It closes the dropdown even when trying to search... and cannot tell it not to
    render() {
        const hostAddr = this.props.hostAddr;
        const editing = this.state.editing;
        const groups = [{
            name: _("Hosts"),
            items: this.props.machines,
        }];
        const render = (m, term) => <CockpitNavItem
                term={term}
                keyword={m.keyword}
                to={hostAddr({ host: m.address }, true)}
                active={m === this.props.machine}
                key={m.key}
                name={m.label}
                header={(m.user ? m.user : this.state.current_user) + " @"}
                status={m.state === "failed" ? { type: "error", title: _("Connection Error") } : null}
                className={m.state}
                actions={[
                    <Button isDisabled={m.address === "localhost"} className="nav-action" hidden={!editing} onClick={e => this.onHostEdit(e, m)} key={m.label + "edit"} variant="secondary"><EditIcon /></Button>,
                    <Button isDisabled={m === this.props.machine || m.address === "localhost"} onClick={e => this.onRemove(e, m)} className="nav-action" hidden={!editing} key={m.label + "remove"} variant="danger"><MinusIcon /></Button>
                ]}
        />;
        const label = this.props.machine.label || "";
        const user = this.props.machine.user || this.state.current_user;
        return (
            <div className="ct-switcher">
                <div className="pf-c-select pf-m-dark">
                    <button onClick={this.toggleMenu} id="pf-toggle-id-58" aria-labelledby="pf-toggle-id-58" aria-expanded={(this.state.opened ? "true" : "false")} aria-haspopup="listbox" type="button" className="ct-nav-toggle pf-c-select__toggle pf-m-plain">
                        <span className="pf-c-select__toggle-wrapper desktop_v">
                            <span className="pf-c-select__toggle-text">
                                <HostLine user={user} host={label} />
                            </span>
                        </span>
                        <span className={"pf-c-select__toggle-arrow mobile_v fa fa-caret-" + (this.state.opened ? "up" : "down")} aria-hidden="true" />
                        <span className="pf-c-select__toggle-wrapper mobile_v">
                            {_("Host")}
                        </span>
                        <span className={"pf-c-select__toggle-arrow fa desktop_v fa-caret-" + (this.state.opened ? "up" : "down")} aria-hidden="true" />
                    </button>
                </div>

                { this.state.opened &&
                <HostsSelector>
                    <PageSidebar isNavOpen={this.props.opened} theme="dark" className={"sidebar-hosts" + (this.state.editing ? " edit-hosts" : "")} nav={
                        <>
                            <CockpitNav selector={this.props.selector} groups={groups} item_render={render} sorting={(a, b) => true} filtering={this.filterHosts} current={label} />
                            {this.state.privileged &&
                                <div className="nav-hosts-actions">
                                    {this.props.machines.length > 1 && <Button variant="secondary" onClick={this.onEditHosts}>{this.state.editing ? _("Stop editing hosts") : _("Edit hosts")}</Button>}
                                    <Button variant="secondary" onClick={this.onAddNewHost}>{_("Add new host")}</Button>
                                </div>
                            }
                        </>
                    } />
                </HostsSelector>
                }
            </div>
        );
    }
}

CockpitHosts.propTypes = {
    machine: PropTypes.object.isRequired,
    machines: PropTypes.array.isRequired,
    selector: PropTypes.string.isRequired,
    hostAddr: PropTypes.func.isRequired,
};
