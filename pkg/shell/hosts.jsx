import cockpit from "cockpit";

import React from 'react';
import ReactDOM from "react-dom";
import PropTypes from 'prop-types';
import { Button } from "@patternfly/react-core/dist/esm/components/Button";
import {
    CaretDownIcon,
    CaretUpIcon,
    EditIcon,
    MinusIcon,
} from '@patternfly/react-icons';
import { PageSidebar } from "@patternfly/react-core/dist/esm/components/Page";
import { Tooltip } from "@patternfly/react-core/dist/esm/components/Tooltip";

import 'polyfills';
import { CockpitNav, CockpitNavItem } from "./nav.jsx";
import { HostModal, try2Connect, codes } from "./hosts_dialog.jsx";
import { useLoggedInUser } from "hooks";

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

// top left navigation element when host switching is disabled
export const CockpitCurrentHost = ({ machine }) => {
    const user_info = useLoggedInUser();

    return (
        <div className="ct-switcher ct-switcher-localonly pf-m-dark">
            <HostLine user={machine.user || user_info?.name || ""} host={machine.label || ""} />
        </div>
    );
};

// full host switcher
export class CockpitHosts extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            opened: false,
            editing: false,
            current_user: "",
            current_key: props.machine.key,
            modal_properties: null,
            modal_callback: null,
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
        }).catch(exc => console.log(exc));

        window.trigger_connection_flow = machine => {
            if (!this.state.modal_properties)
                this.connectHost(machine);
        };
        this.props.index.navigate(null, true);
    }

    componentWillUnmount() {
        window.trigger_connection_flow = null;
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

    showModal(properties) {
        return new Promise((resolve, reject) => {
            this.setState({ modal_properties: properties,
                            modal_callback: result => { resolve(result); return Promise.resolve() },
                          });
        });
    }

    async onAddNewHost() {
        await this.showModal({ });
    }

    async onHostEdit(event, machine) {
        const connection_string = await this.showModal({ address: machine.address });
        if (connection_string) {
            const parts = this.props.machines.split_connection_string(connection_string);
            const addr = this.props.hostAddr({ host: parts.address }, true);
            if (machine == this.props.machine && parts.address != machine.address) {
                this.props.loader.connect(parts.address);
                this.props.jump(addr);
            }
        }
    }

    async connectHost(machine) {
        if (machine.address == "localhost" || machine.state == "connected" || machine.state == "connecting")
            return machine.connection_string;

        let connection_string = null;

        if (machine.problem && codes[machine.problem]) {
            // trouble shooting
            connection_string = await this.showModal({
                address: machine.address,
                template: codes[machine.problem],
            });
        } else if (!window.sessionStorage.getItem("connection-warning-shown")) {
            // connect by launching into the "Connection warning" dialog.
            connection_string = await this.showModal({
                address: machine.address,
                template: "connect"
            });
        } else {
            // Try to connect without any dialog
            try {
                await try2Connect(this.props.machines, machine.connection_string);
                connection_string = machine.connection_string;
            } catch (err) {
                // continue with troubleshooting in the dialog
                connection_string = await this.showModal({
                    address: machine.address,
                    template: codes[err.problem] || "change-port",
                    error_options: err,
                });
            }
        }

        if (connection_string) {
            // make the rest of the shell aware that the machine is now connected
            const parts = this.props.machines.split_connection_string(connection_string);
            this.props.loader.connect(parts.address);
            this.props.index.navigate();
        }

        return connection_string;
    }

    async onHostSwitch(machine) {
        const connection_string = await this.connectHost(machine);
        if (connection_string) {
            const parts = this.props.machines.split_connection_string(connection_string);
            const addr = this.props.hostAddr({ host: parts.address }, true);
            this.props.jump(addr);
        }
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

    // HACK: using HTML rather than Select PF4 component as:
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
                jump={() => this.onHostSwitch(m)}
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

        const add_host_action = <Button variant="secondary" onClick={this.onAddNewHost}>{_("Add new host")}</Button>;

        return (
            <>
                <div className="ct-switcher">
                    <div className="pf-v5-c-select pf-m-dark">
                        <button onClick={this.toggleMenu} id="host-toggle" aria-labelledby="host-toggle" aria-expanded={(this.state.opened ? "true" : "false")} aria-haspopup="listbox" type="button" className="ct-nav-toggle pf-v5-c-select__toggle pf-m-plain">
                            <span className="pf-v5-c-select__toggle-wrapper desktop_v">
                                <span className="pf-v5-c-select__toggle-text">
                                    <HostLine user={user} host={label} />
                                </span>
                            </span>
                            <CaretUpIcon
                                className={`pf-v5-c-select__toggle-arrow mobile_v pf-v5-c-icon pf-m-lg ${this.state.opened ? 'clicked' : ''}`}
                                aria-hidden="true"
                            />
                            <span className="pf-v5-c-select__toggle-wrapper mobile_v">
                                {_("Host")}
                            </span>
                            <CaretDownIcon
                                className={`pf-v5-c-select__toggle-arrow desktop_v pf-v5-c-icon ${this.state.opened ? 'clicked' : ''}`}
                                aria-hidden="true"
                            />

                        </button>
                    </div>

                    { this.state.opened &&
                    <HostsSelector>
                        <PageSidebar isSidebarOpen={this.props.opened} theme="dark" className={"sidebar-hosts" + (this.state.editing ? " edit-hosts" : "")}>
                            <CockpitNav
                                selector={this.props.selector}
                                groups={groups}
                                item_render={render}
                                sorting={(a, b) => true}
                                filtering={this.filterHosts}
                                current={label}
                                jump={() => console.error("internal error: jump not supported in hosts selector")}
                            />
                            <div className="nav-hosts-actions">
                                {this.props.machines.list.length > 1 && <Button variant="secondary" onClick={this.onEditHosts}>{this.state.editing ? _("Stop editing hosts") : _("Edit hosts")}</Button>}
                                {add_host_action}
                            </div>
                        </PageSidebar>
                    </HostsSelector>
                    }
                </div>
                {this.state.modal_properties &&
                 <HostModal machines_ins={this.props.machines}
                            onClose={() => this.setState({ modal_properties: null })}
                            {...this.state.modal_properties}
                            caller_callback={this.state.modal_callback}
                            caller_cancelled={() => this.state.modal_callback(null)}
                 />
                }
            </>
        );
    }
}

CockpitHosts.propTypes = {
    machine: PropTypes.object.isRequired,
    machines: PropTypes.object.isRequired,
    index: PropTypes.object.isRequired,
    loader: PropTypes.object.isRequired,
    selector: PropTypes.string.isRequired,
    hostAddr: PropTypes.func.isRequired,
    jump: PropTypes.func.isRequired,
};
