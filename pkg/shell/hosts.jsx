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
import { build_href, split_connection_string } from "./util.jsx";
import { add_host, edit_host, connect_host } from "./hosts_dialog.jsx";

const _ = cockpit.gettext;

class HostsSelector extends React.Component {
    constructor() {
        super();
        this.el = document.createElement("div");
        this.el.className = "view-hosts";
    }

    componentDidMount() {
        const hosts_sel = document.getElementById("nav-hosts");
        hosts_sel.appendChild(this.el);
    }

    componentWillUnmount() {
        const hosts_sel = document.getElementById("nav-hosts");
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
export const CockpitCurrentHost = ({ current_user, machine }) => {
    return (
        <div className="ct-switcher ct-switcher-localonly pf-m-dark">
            <HostLine user={machine.user || current_user || ""} host={machine.label || ""} />
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
            current_key: props.state.current_machine.key,
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
    }

    static getDerivedStateFromProps(nextProps, prevState) {
        if (nextProps.state.current_machine.key !== prevState.current_key) {
            document.getElementById(nextProps.selector).classList.toggle("interact", false);
            return {
                current_key: nextProps.state.current_machine.key,
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

    async onAddNewHost() {
        await add_host(this.props.host_modal_state);
    }

    async onHostEdit(event, machine) {
        await edit_host(this.props.host_modal_state, this.props.state, machine);
    }

    async onHostSwitch(machine) {
        const { state } = this.props;

        // We could launch the connection dialogs here and not jump at
        // all when the login fails (or is cancelled), but the
        // traditional behavior is to jump and then try to connect.

        const connection_string = machine.connection_string;
        const parts = split_connection_string(connection_string);
        const addr = build_href({ host: parts.address });
        state.jump(addr);
        state.ensure_connection();
    }

    onEditHosts() {
        this.setState(s => { return { editing: !s.editing } });
    }

    onRemove(event, machine) {
        const { state } = this.props;
        const { current_machine } = state;

        event.preventDefault();

        if (current_machine === machine) {
            // Removing machine underneath ourself - jump to localhost
            const addr = build_href({ host: "localhost" });
            state.jump(addr);
        }

        if (state.machines.list.length <= 2)
            this.setState({ editing: false });
        state.machines.change(machine.key, { visible: false });
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
        const { state } = this.props;
        const { current_machine } = state;

        const editing = this.state.editing;
        const groups = [{
            name: _("Hosts"),
            items: state.machines.list,
        }];
        const render = (m, term) => <CockpitNavItem
                term={term}
                keyword={m.keyword}
                to={build_href({ host: m.address })}
                active={m === current_machine}
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
        const label = current_machine.label || "";
        const user = current_machine.user || this.state.current_user;

        const add_host_action = <Button variant="secondary" onClick={this.onAddNewHost}>{_("Add new host")}</Button>;

        return (
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
                    <PageSidebar theme="dark" className={"sidebar-hosts" + (this.state.editing ? " edit-hosts" : "")}>
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
                            {state.machines.list.length > 1 && <Button variant="secondary" onClick={this.onEditHosts}>{this.state.editing ? _("Stop editing hosts") : _("Edit hosts")}</Button>}
                            {add_host_action}
                        </div>
                    </PageSidebar>
                </HostsSelector>
                }
            </div>
        );
    }
}

CockpitHosts.propTypes = {
    state: PropTypes.object.isRequired,
    host_modal_state: PropTypes.object.isRequired,
    selector: PropTypes.string.isRequired,
};
