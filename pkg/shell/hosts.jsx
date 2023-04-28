import cockpit from "cockpit";

import React from 'react';
import ReactDOM from "react-dom";
import PropTypes from 'prop-types';
import { PageSidebar } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Tooltip } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";
import { EditIcon, MinusIcon, CaretUpIcon, CaretDownIcon } from '@patternfly/react-icons';

import 'polyfills';
import { CockpitNav, CockpitNavItem } from "./nav.jsx";
import { HostModal } from "./hosts_dialog.jsx";

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
            show_modal: false,
            edit_machine: null,
        };

        this.toggleMenu = this.toggleMenu.bind(this);
        this.filterHosts = this.filterHosts.bind(this);
        this.onAddNewHost = this.onAddNewHost.bind(this);
        this.onEditHosts = this.onEditHosts.bind(this);
        this.onHostEdit = this.onHostEdit.bind(this);
        this.onRemove = this.onRemove.bind(this);
    }

    componentDidMount() {
        cockpit.user().then(user => {
            this.setState({ current_user: user.name || "" });
        });
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
        this.setState({ show_modal: true });
    }

    onHostEdit(event, machine) {
        this.setState({ show_modal: true, edit_machine: machine });
    }

    onEditHosts() {
        this.setState(s => { return { editing: !s.editing } });
    }

    onRemove(event, machine) {
        event.preventDefault();

        if (this.props.machine === machine) {
            // Removing machine underneath ourself - jump to localhost
            const addr = this.props.hostAddr({ host: "localhost" }, true);
            this.props.jump(addr);
        }

        if (this.props.machines.list.length <= 2)
            this.setState({ editing: false });
        this.props.machines.change(machine.key, { visible: false });
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
            items: this.props.machines.list,
        }];
        const render = (m, term) => <CockpitNavItem
                term={term}
                keyword={m.keyword}
                to={hostAddr({ host: m.address }, true)}
                active={m === this.props.machine}
                key={m.key}
                name={m.label}
                header={(m.user ? m.user : this.state.current_user) + " @"}
                status={m.state === "failed" ? { type: "error", title: _("Connection error") } : null}
                className={m.state}
                jump={this.props.jump}
                actions={<>
                    <Tooltip content={_("Edit")} position="right">
                        <Button isDisabled={m.address === "localhost"} className="nav-action" hidden={!editing} onClick={e => this.onHostEdit(e, m)} key={m.label + "edit"} variant="secondary"><EditIcon /></Button>
                    </Tooltip>
                    <Tooltip content={_("Remove")} position="right">
                        <Button isDisabled={m.address === "localhost"} onClick={e => this.onRemove(e, m)} className="nav-action" hidden={!editing} key={m.label + "remove"} variant="danger"><MinusIcon /></Button>
                    </Tooltip>
                </>}
        />;
        const label = this.props.machine.label || "";
        const user = this.props.machine.user || this.state.current_user;
        return (
            <>
                <div className="ct-switcher">
                    <div className="pf-c-select pf-m-dark">
                        <button onClick={this.toggleMenu} id="host-toggle" aria-labelledby="host-toggle" aria-expanded={(this.state.opened ? "true" : "false")} aria-haspopup="listbox" type="button" className="ct-nav-toggle pf-c-select__toggle pf-m-plain">
                            <span className="pf-c-select__toggle-wrapper desktop_v">
                                <span className="pf-c-select__toggle-text">
                                    <HostLine user={user} host={label} />
                                </span>
                            </span>
                            {this.state.opened && <CaretUpIcon className="pf-c-select__toggle-arrow mobile_v pf-c-icon pf-m-lg" aria-hidden="true" />}
                            {!this.state.opened && <CaretDownIcon className="pf-c-select__toggle-arrow mobile_v pf-c-icon pf-m-lg" aria-hidden="true" />}
                            <span className="pf-c-select__toggle-wrapper mobile_v">
                                {_("Host")}
                            </span>
                            {this.state.opened && <CaretUpIcon className="pf-c-select__toggle-arrow desktop_v pf-c-icon" aria-hidden="true" />}
                            {!this.state.opened && <CaretDownIcon className="pf-c-select__toggle-arrow desktop_v pf-c-icon" aria-hidden="true" />}
                        </button>
                    </div>

                    { this.state.opened &&
                    <HostsSelector>
                        <PageSidebar isNavOpen={this.props.opened} theme="dark" className={"sidebar-hosts" + (this.state.editing ? " edit-hosts" : "")} nav={
                            <>
                                <CockpitNav selector={this.props.selector} groups={groups} item_render={render} sorting={(a, b) => true} filtering={this.filterHosts} current={label} />
                                <div className="nav-hosts-actions">
                                    {this.props.machines.list.length > 1 && <Button variant="secondary" onClick={this.onEditHosts}>{this.state.editing ? _("Stop editing hosts") : _("Edit hosts")}</Button>}
                                    <Button variant="secondary" onClick={this.onAddNewHost}>{_("Add new host")}</Button>
                                </div>
                            </>
                        } />
                    </HostsSelector>
                    }
                </div>
                {this.state.show_modal &&
                    <HostModal machines_ins={this.props.machines}
                               onClose={() => this.setState({ show_modal: false, edit_machine: null })}
                               address={this.state.edit_machine ? this.state.edit_machine.address : null}
                               caller_callback={this.state.edit_machine
                                   ? (new_connection_string) => {
                                       const parts = this.props.machines.split_connection_string(new_connection_string);
                                       if (this.state.edit_machine == this.props.machine && parts.address != this.state.edit_machine.address) {
                                           const addr = this.props.hostAddr({ host: parts.address }, true);
                                           this.props.jump(addr);
                                       }
                                       return Promise.resolve();
                                   }
                                   : null } />
                }
            </>
        );
    }
}

CockpitHosts.propTypes = {
    machine: PropTypes.object.isRequired,
    machines: PropTypes.object.isRequired,
    selector: PropTypes.string.isRequired,
    hostAddr: PropTypes.func.isRequired,
    jump: PropTypes.func.isRequired,
};
