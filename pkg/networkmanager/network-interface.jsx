/*
 * Copyright (C) 2021 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */
import cockpit from "cockpit";
import React, { useContext, useEffect, useRef, useState } from "react";
import { useEvent } from "hooks";
import { Breadcrumb, BreadcrumbItem } from "@patternfly/react-core/dist/esm/components/Breadcrumb/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { InputGroup, InputGroupItem } from "@patternfly/react-core/dist/esm/components/InputGroup/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Gallery } from "@patternfly/react-core/dist/esm/layouts/Gallery/index.js";
import { Modal, ModalBody, ModalFooter, ModalHeader } from '@patternfly/react-core/dist/esm/components/Modal/index.js';
import { Page, PageBreadcrumb, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Progress } from "@patternfly/react-core/dist/esm/components/Progress/index.js";
import { SearchInput } from "@patternfly/react-core/dist/esm/components/SearchInput/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Tooltip } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";
import {
    ConnectedIcon,
    DisconnectedIcon,
    EyeIcon,
    EyeSlashIcon,
    LockIcon,
    LockOpenIcon,
    PlusIcon,
    RedoIcon,
    ThumbtackIcon,
    TrashIcon
} from "@patternfly/react-icons";

import { SortByDirection } from '@patternfly/react-table';
import { FormHelper } from "cockpit-components-form-helper";
import { ListingTable } from "cockpit-components-table.jsx";
import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { Privileged } from "cockpit-components-privileged.jsx";
import { distanceToNow } from "timeformat";
import { fmt_to_fragments } from 'utils.jsx';
import { useDialogs } from "dialogs.jsx";

import { ModelContext } from './model-context.jsx';
import { NetworkInterfaceMembers } from "./network-interface-members.jsx";
import { NetworkAction } from './dialogs-common.jsx';
import { NetworkPlots } from "./plots";
import * as utils from "./utils.js";

import {
    array_join,
    choice_title,
    complete_settings,
    connection_settings,
    free_member_connection,
    is_managed,
    render_active_connection,
    settings_applier,
    show_unexpected_error,
    syn_click,
    with_checkpoint,
} from './interfaces.js';
import {
    team_runner_choices,
    team_watch_choices,
} from './team.jsx';
import {
    bond_mode_choices,
} from './bond.jsx';

import { get_ip_method_choices } from './ip-settings.jsx';

const _ = cockpit.gettext;

// known networks: with ssid; hidden networks: no ssid
const WiFiConnectDialog = ({ dev, model, ssid: knownSsid, ap }) => {
    const Dialogs = useDialogs();
    const [inputSsid, setInputSsid] = useState("");
    const [security, setSecurity] = useState("wpa-psk");
    const [password, setPassword] = useState("");
    const [passwordVisible, setPasswordVisible] = useState(false);
    const [dialogError, setDialogError] = useState(null);
    const [connecting, setConnecting] = useState(false);
    const [activeConnection, setActiveConnection] = useState(null);
    const [createdConnection, setCreatedConnection] = useState(null);

    const isHidden = !knownSsid;
    const ssid = knownSsid || inputSsid;
    const idPrefix = "network-wifi-connect";

    // Validation
    const passwordRequired = !isHidden || security !== "none";
    const ssidInvalid = isHidden && inputSsid.trim() === "";
    const passwordInvalid = passwordRequired && password.trim() === "";
    const canConnect = !ssidInvalid && !passwordInvalid;

    useEvent(model, "changed");

    // Monitor active connection state changes
    useEffect(() => {
        if (!activeConnection)
            return;

        const acState = activeConnection.State;
        const currentSSID = dev.ActiveAccessPoint?.Ssid;

        utils.debug("ActiveConnection state changed:", acState, "current SSID:", currentSSID, "target:", ssid);

        // ActiveConnection states:
        // 0 = UNKNOWN, 1 = ACTIVATING, 2 = ACTIVATED, 3 = DEACTIVATING, 4 = DEACTIVATED

        if (acState === 2 && currentSSID === ssid) {
            utils.debug("Connected successfully to", ssid);
            Dialogs.close();
        } else if (acState === 4) {
            utils.debug("Connection failed for", ssid);
            setConnecting(false);
            setDialogError(isHidden ? _("Failed to connect. Check your credentials.") : _("Failed to connect. Check your password."));
            if (createdConnection) {
                createdConnection.delete_()
                        .catch(err => console.warn("Failed to delete connection:", err));
            }
            setActiveConnection(null);
            setCreatedConnection(null);
        }
    }, [activeConnection, dev.ActiveAccessPoint?.Ssid, ssid, createdConnection, Dialogs, isHidden]);

    const onSubmit = (ev) => {
        if (ev) {
            ev.preventDefault();
        }

        utils.debug("Connecting to", ssid, isHidden ? `with security ${security}` : "with password");
        setConnecting(true);
        setDialogError(null);

        const settings = {
            connection: {
                id: ssid,
                type: "802-11-wireless",
                autoconnect: true,
            },
            "802-11-wireless": {
                ssid: utils.ssid_to_nm(ssid),
                mode: "infrastructure",
            },
        };

        if (isHidden) {
            settings["802-11-wireless"].hidden = true;
        }

        if (!isHidden || security !== "none") {
            settings["802-11-wireless-security"] = {
                "key-mgmt": isHidden ? security : "wpa-psk",
                psk: password,
            };
        }

        dev.activate_with_settings(settings, isHidden ? null : ap)
                .then(result => {
                    utils.debug("Connection activation started");
                    setCreatedConnection(result.connection);
                    setActiveConnection(result.active_connection);
                })
                .catch(err => {
                    setConnecting(false);
                    setDialogError(typeof err === 'string' ? err : err.message);
                });
    };

    return (
        <Modal id={idPrefix + "-dialog"}
               position="top"
               variant="small"
               isOpen
               onClose={Dialogs.close}>
            <ModalHeader title={isHidden ? _("Connect to hidden network") : cockpit.format(_("Connect to $0"), ssid)} />
            <ModalBody>
                <Form id={idPrefix + "-body"} onSubmit={onSubmit} isHorizontal>
                    {dialogError && <ModalError dialogError={_("Failed to connect")} dialogErrorDetail={dialogError} />}
                    {isHidden && (
                        <>
                            <FormGroup fieldId={idPrefix + "-ssid-input"} label={_("Network name")}>
                                <TextInput id={idPrefix + "-ssid-input"}
                                           type="text"
                                           value={inputSsid}
                                           onChange={(_event, value) => setInputSsid(value)}
                                           validated={ssidInvalid ? "error" : "default"}
                                           autoFocus // eslint-disable-line jsx-a11y/no-autofocus
                                           isDisabled={connecting} />
                                <FormHelper helperTextInvalid={ssidInvalid ? _("Network name is required") : undefined} />
                            </FormGroup>
                            <FormGroup fieldId={idPrefix + "-security-select"} label={_("Security")}>
                                <FormSelect id={idPrefix + "-security-select"}
                                            value={security}
                                            onChange={(_event, value) => setSecurity(value)}
                                            isDisabled={connecting}>
                                    <FormSelectOption value="none" label={_("None")} />
                                    <FormSelectOption value="wpa-psk" label={_("WPA/WPA2 Personal")} />
                                </FormSelect>
                            </FormGroup>
                        </>
                    )}
                    {(!isHidden || security !== "none") && (
                        <FormGroup fieldId={idPrefix + "-password-input"} label={_("Password")}>
                            <InputGroup>
                                <InputGroupItem isFill>
                                    <TextInput id={idPrefix + "-password-input"}
                                               type={passwordVisible ? "text" : "password"}
                                               value={password}
                                               onChange={(_event, value) => setPassword(value)}
                                               validated={passwordInvalid ? "error" : "default"}
                                               autoFocus={!isHidden} // eslint-disable-line jsx-a11y/no-autofocus
                                               isDisabled={connecting} />
                                </InputGroupItem>
                                <InputGroupItem>
                                    <Button variant="control"
                                            aria-label={passwordVisible ? _("Hide password") : _("Show password")}
                                            onClick={() => setPasswordVisible(!passwordVisible)}
                                            isDisabled={connecting}>
                                        {passwordVisible ? <EyeSlashIcon /> : <EyeIcon />}
                                    </Button>
                                </InputGroupItem>
                            </InputGroup>
                            <FormHelper helperTextInvalid={passwordInvalid ? _("Password is required") : undefined} />
                        </FormGroup>
                    )}
                </Form>
            </ModalBody>
            <ModalFooter>
                <Button variant='primary'
                        id={idPrefix + "-connect"}
                        onClick={onSubmit}
                        isLoading={connecting}
                        isDisabled={connecting || !canConnect}>
                    {_("Connect")}
                </Button>
                <Button variant='link'
                        id={idPrefix + "-cancel"}
                        onClick={Dialogs.close}
                        isDisabled={connecting}>
                    {_("Cancel")}
                </Button>
            </ModalFooter>
        </Modal>
    );
};

export const NetworkInterfacePage = ({
    privileged,
    operationInProgress,
    usage_monitor,
    plot_state,
    interfaces,
    iface
}) => {
    const model = useContext(ModelContext);
    useEvent(model, "changed");
    const [isScanning, setIsScanning] = useState(false);
    const [prevAPCount, setPrevAPCount] = useState(0);
    const [networkSearch, setNetworkSearch] = useState("");

    const dev_name = iface.Name;
    const dev = iface.Device;
    const isManaged = iface && (!dev || is_managed(dev));

    const accessPointCount = dev?.DeviceType === '802-11-wireless' ? (dev.AccessPoints?.length || 0) : 0;

    const Dialogs = useDialogs();

    // WiFi scanning: re-enable button when APs change or after timeout
    useEffect(() => {
        if (isScanning) {
            if (accessPointCount !== prevAPCount && prevAPCount !== 0)
                setIsScanning(false);
            const timer = setTimeout(() => setIsScanning(false), 5000);
            return () => clearTimeout(timer);
        }
        setPrevAPCount(accessPointCount);
    }, [isScanning, accessPointCount, prevAPCount]);

    // Track stable WiFi network order (by signal strength on first scan, preserved thereafter)
    const stableAPOrder = useRef([]);

    // Update stable AP order when APs are added/removed
    useEffect(() => {
        if (dev?.DeviceType !== '802-11-wireless')
            return;

        const accessPoints = dev.AccessPoints || [];
        const currentMACs = new Set(accessPoints.map(ap => ap.HwAddress));
        const stableMACs = new Set(stableAPOrder.current);

        // Re-sort if APs added/removed
        const needsResort = currentMACs.size !== stableMACs.size ||
                           ![...currentMACs].every(mac => stableMACs.has(mac));

        if (needsResort) {
            // Sort by signal strength
            const sorted = [...accessPoints].sort((a, b) => b.Strength - a.Strength);
            // Store MAC addresses
            stableAPOrder.current = sorted.map(ap => ap.HwAddress);
        }
    }, [dev?.AccessPoints, dev?.DeviceType]);

    let ghostSettings = null;
    let connectionSettings = null;

    if (iface) {
        if (iface.MainConnection) {
            connectionSettings = iface.MainConnection.Settings;
        } else {
            ghostSettings = createGhostConnectionSettings();
            connectionSettings = ghostSettings;
        }
    }

    function deleteConnections() {
        function deleteConnectionAndMembers(con) {
            return Promise.all(con.Members.map(s => free_member_connection(s))).then(() => con.delete_());
        }

        function deleteConnections(cons) {
            return Promise.all(cons.map(deleteConnectionAndMembers));
        }

        function deleteIfaceConnections(iface) {
            return deleteConnections(iface.Connections);
        }

        const location = cockpit.location;

        function modify() {
            return deleteIfaceConnections(iface)
                    .then(function () {
                        location.go("/");
                    })
                    .catch(show_unexpected_error);
        }

        if (iface) {
            with_checkpoint(model, modify,
                            {
                                devices: dev ? [dev] : [],
                                fail_text: fmt_to_fragments(_("Deleting $0 will break the connection to the server, and will make the administration UI unavailable."), <b>{dev_name}</b>),
                                anyway_text: cockpit.format(_("Delete $0"), dev_name),
                                hack_does_add_or_remove: true,
                                rollback_on_failure: true
                            });
        }
    }

    function connect() {
        if (!(iface.MainConnection || (dev && ghostSettings)))
            return;

        function fail(error) {
            show_unexpected_error(error);
        }

        function modify() {
            if (iface.MainConnection) {
                return iface.MainConnection.activate(dev, null).catch(fail);
            } else {
                return dev.activate_with_settings(ghostSettings, null).catch(fail);
            }
        }

        with_checkpoint(model, modify,
                        {
                            devices: dev ? [dev] : [],
                            fail_text: fmt_to_fragments(_("Switching on $0 will break the connection to the server, and will make the administration UI unavailable."), <b>{dev_name}</b>),
                            anyway_text: cockpit.format(_("Switch on $0"), dev_name)
                        });
    }

    function disconnect() {
        if (!dev) {
            console.log("Trying to switch off without a device?");
            return;
        }

        function modify () {
            return dev.disconnect()
                    .catch(error => show_unexpected_error(error));
        }

        with_checkpoint(model, modify,
                        {
                            devices: [dev],
                            fail_text: fmt_to_fragments(_("Switching off $0 will break the connection to the server, and will make the administration UI unavailable."), <b>{dev_name}</b>),
                            anyway_text: cockpit.format(_("Switch off $0"), dev_name)
                        });
    }

    function renderDesc() {
        let desc;
        let cs;
        if (dev) {
            if (dev.DeviceType == 'ethernet' || dev.IdVendor || dev.IdModel) {
                desc = cockpit.format("$IdVendor $IdModel $Driver", dev);
            } else if (dev.DeviceType == 'bond') {
                desc = _("Bond");
            } else if (dev.DeviceType == 'team') {
                desc = _("Team");
            } else if (dev.DeviceType == 'vlan') {
                desc = _("VLAN");
            } else if (dev.DeviceType == 'bridge') {
                desc = _("Bridge");
            } else if (dev.Driver == 'wireguard') {
                desc = "WireGuard";
            } else
                desc = cockpit.format(_("Unknown \"$0\""), dev.DeviceType);
        } else if (iface) {
            cs = connection_settings(iface.Connections[0]);
            if (cs.type == "bond")
                desc = _("Bond");
            else if (cs.type == "team")
                desc = _("Team");
            else if (cs.type == "vlan")
                desc = _("VLAN");
            else if (cs.type == "bridge")
                desc = _("Bridge");
            else if (cs.type == "wireguard")
                desc = "WireGuard";
            else if (cs.type)
                desc = cockpit.format(_("Unknown \"$0\""), cs.type);
            else
                desc = _("Unknown");
        } else
            desc = _("Unknown");

        return desc;
    }

    function renderMac() {
        let mac;
        if (dev &&
            dev.HwAddress) {
            mac = dev.HwAddress;
        } else if (iface &&
                   iface.MainConnection &&
                   iface.MainConnection.Settings &&
                   iface.MainConnection.Settings.ethernet &&
                   iface.MainConnection.Settings.ethernet.assigned_mac_address) {
            mac = iface.MainConnection.Settings.ethernet.assigned_mac_address;
        }

        const can_edit_mac = (privileged && iface && iface.MainConnection &&
                              (connection_settings(iface.MainConnection).type == "802-3-ethernet" ||
                               connection_settings(iface.MainConnection).type == "bond"));

        let mac_desc;
        if (can_edit_mac) {
            mac_desc = (
                <NetworkAction type="mac" iface={iface} buttonText={mac} connectionSettings={iface.MainConnection.Settings} />
            );
        } else {
            mac_desc = mac;
        }

        return mac_desc;
    }

    function renderCarrierStatusRow() {
        if (dev && dev.Carrier !== undefined) {
            return (
                <DescriptionListGroup>
                    <DescriptionListTerm>{_("Carrier")}</DescriptionListTerm>
                    <DescriptionListDescription data-label="Carrier">
                        {dev.Carrier ? (dev.Speed ? cockpit.format_bits_per_sec(dev.Speed * 1e6) : _("Yes")) : _("No")}
                    </DescriptionListDescription>
                </DescriptionListGroup>
            );
        } else
            return null;
    }

    function renderActiveStatusRow() {
        let state;

        if (iface.MainConnection && iface.MainConnection.Groups.length > 0)
            return null;

        if (!dev)
            state = _("Inactive");
        else if (isManaged && dev.State != 100)
            state = dev.StateText;
        else
            state = null;

        const activeConnection = render_active_connection(dev, true, false);
        return (
            <DescriptionListGroup>
                <DescriptionListTerm>{_("Status")}</DescriptionListTerm>
                <DescriptionListDescription data-label="Status" className="networking-interface-status">
                    {[activeConnection, state].filter(val => val).join(", ")}
                </DescriptionListDescription>
            </DescriptionListGroup>
        );
    }

    function renderConnectionSettingsRows(con, settings) {
        if (!isManaged || !settings)
            return [];

        let group_settings = null;
        if (con && con.Groups.length > 0)
            group_settings = con.Groups[0].Settings;

        function renderIpSettings(topic) {
            const params = settings[topic];
            const parts = [];

            if (params.method != "manual")
                parts.push(choice_title(get_ip_method_choices(topic), params.method, _("Unknown configuration")));

            const addr_is_extra = (params.method != "manual");
            const addrs = [];
            params.address_data?.forEach(function (a) {
                addrs.push(a.address + "/" + a.prefix);
            });

            if (addrs.length > 0)
                parts.push(cockpit.format(addr_is_extra ? _("Additional address $val") : _("Address $val"),
                                          { val: addrs.join(", ") }));

            const gateway = params.gateway;
            if (gateway && gateway != "0.0.0.0" && gateway != "::")
                parts.push(cockpit.format(_("Gateway $gateway"), { gateway }));

            const dns_is_extra = (!params["ignore-auto-dns"] && params.method != "manual");
            if (params.dns_data?.length > 0)
                parts.push(cockpit.format(dns_is_extra ? _("Additional DNS $val") : _("DNS $val"),
                                          { val: params.dns_data.join(", ") }));
            if (params.dns_search?.length > 0)
                parts.push(cockpit.format(dns_is_extra ? _("Additional DNS search domains $val") : _("DNS search domains $val"),
                                          { val: params.dns_search.join(", ") }));

            return parts;
        }

        function renderAutoconnectRow() {
            if (settings.connection.autoconnect !== undefined) {
                return (
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("General")}</DescriptionListTerm>
                        <DescriptionListDescription data-label="General">
                            <Checkbox id="autoreconnect" isDisabled={!privileged}
                                      onChange={(_event, checked) => {
                                          settings.connection.autoconnect = checked;
                                          settings_applier(self.model, dev, con)(settings);
                                      }}
                                      isChecked={settings.connection.autoconnect}
                                      label={_("Connect automatically")} />
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                );
            }
        }

        function renderSettingsRow(title, rows, configure) {
            const link_text = [];
            for (let i = 0; i < rows.length; i++) {
                link_text.push(rows[i]);
                if (i < rows.length - 1)
                    link_text.push(<br key={"break-" + i} />);
            }

            return (
                <DescriptionListGroup>
                    <DescriptionListTerm>{title}</DescriptionListTerm>
                    <DescriptionListDescription data-label={title}>
                        {link_text.length
                            ? <span className="network-interface-settings-text">
                                {link_text}
                            </span>
                            : null}
                        {privileged
                            ? (typeof configure === 'function' ? <Button variant="link" isInline onClick={syn_click(model, configure)}>{_("edit")}</Button> : configure)
                            : null}
                    </DescriptionListDescription>
                </DescriptionListGroup>
            );
        }

        function renderIpSettingsRow(topic, title) {
            if (!settings[topic])
                return null;

            const configure = <NetworkAction type={topic} iface={iface} connectionSettings={settings} />;
            return renderSettingsRow(title, renderIpSettings(topic), configure);
        }

        function renderMtuSettingsRow() {
            const rows = [];
            const options = settings.ethernet;

            if (!options)
                return null;

            function addRow(fmt, args) {
                rows.push(cockpit.format(fmt, args));
            }

            if (options.mtu)
                addRow("$mtu", options);
            else
                addRow(_("Automatic"), options);

            const configure = <NetworkAction type="mtu" iface={iface} connectionSettings={settings} />;
            return renderSettingsRow(_("MTU"), rows, configure);
        }

        function render_connection_link(con, key) {
            return <span key={key}>
                {
                    array_join(
                        con.Interfaces.map(iface =>
                            <Button variant="link" key={iface.Name}
                                    isInline
                                    onClick={() => cockpit.location.go([iface.Name])}>{iface.Name}</Button>),
                        ", ")
                }
            </span>;
        }

        function render_group() {
            if (con && con.Groups.length > 0) {
                return (
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Group")}</DescriptionListTerm>
                        <DescriptionListDescription data-label="Group">
                            {array_join(con.Groups.map(render_connection_link), ", ")}
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                );
            } else
                return null;
        }

        function renderBondSettingsRow() {
            const parts = [];
            const rows = [];

            if (!settings.bond)
                return null;

            const options = settings.bond.options;

            parts.push(choice_title(bond_mode_choices, options.mode, options.mode));
            if (options.arp_interval)
                parts.push(_("ARP monitoring"));

            if (parts.length > 0)
                rows.push(parts.join(", "));

            const configure = <NetworkAction type="bond" iface={iface} connectionSettings={settings} />;
            return renderSettingsRow(_("Bond"), rows, configure);
        }

        function renderTeamSettingsRow() {
            const parts = [];
            const rows = [];

            if (!settings.team)
                return null;

            const config = settings.team.config;

            if (config === null)
                parts.push(_("Broken configuration"));
            else {
                if (config.runner)
                    parts.push(choice_title(team_runner_choices, config.runner.name, config.runner.name));
                if (config.link_watch && config.link_watch.name != "ethtool")
                    parts.push(choice_title(team_watch_choices, config.link_watch.name, config.link_watch.name));
            }

            if (parts.length > 0)
                rows.push(parts.join(", "));

            const configure = <NetworkAction type="team" iface={iface} connectionSettings={settings} />;
            return renderSettingsRow(_("Team"), rows, configure);
        }

        function renderTeamPortSettingsRow() {
            const parts = [];
            const rows = [];

            if (!settings.team_port)
                return null;

            /* Only "activebackup" and "lacp" team ports have
             * something to configure.
             */
            if (!group_settings ||
                !group_settings.team ||
                !group_settings.team.config ||
                !group_settings.team.config.runner ||
                !(group_settings.team.config.runner.name == "activebackup" ||
                  group_settings.team.config.runner.name == "lacp"))
                return null;

            const config = settings.team_port.config;

            if (config === null)
                parts.push(_("Broken configuration"));

            if (parts.length > 0)
                rows.push(parts.join(", "));

            const configure = <NetworkAction type="teamport" iface={iface} connectionSettings={settings} />;
            return renderSettingsRow(_("Team port"), rows, configure);
        }

        function renderBridgeSettingsRow() {
            const rows = [];
            const options = settings.bridge;

            if (!options)
                return null;

            function addRow(fmt, args) {
                rows.push(cockpit.format(fmt, args));
            }

            if (options.stp) {
                addRow(_("Spanning tree protocol"));
                if (options.priority != 32768)
                    addRow(_("Priority $priority"), options);
                if (options.forward_delay != 15)
                    addRow(_("Forward delay $forward_delay"), options);
                if (options.hello_time != 2)
                    addRow(_("Hello time $hello_time"), options);
                if (options.max_age != 20)
                    addRow(_("Maximum message age $max_age"), options);
            }

            const configure = <NetworkAction type="bridge" iface={iface} connectionSettings={settings} />;
            return renderSettingsRow(_("Bridge"), rows, configure);
        }

        function renderBridgePortSettingsRow() {
            const rows = [];
            const options = settings.bridge_port;

            if (!options)
                return null;

            function addRow(fmt, args) {
                rows.push(cockpit.format(fmt, args));
            }

            if (options.priority != 32)
                addRow(_("Priority $priority"), options);
            if (options.path_cost != 100)
                addRow(_("Path cost $path_cost"), options);
            if (options.hairpin_mode)
                addRow(_("Hairpin mode"));

            const configure = <NetworkAction type="bridgeport" iface={iface} connectionSettings={settings} />;
            return renderSettingsRow(_("Bridge port"), rows, configure);
        }

        function renderVlanSettingsRow() {
            const rows = [];
            const options = settings.vlan;

            if (!options)
                return null;

            function addRow(fmt, args) {
                rows.push(cockpit.format(fmt, args));
            }

            addRow(_("Parent $parent"), options);
            addRow(_("ID $id"), options);

            const configure = <NetworkAction type="vlan" iface={iface} connectionSettings={settings} />;
            return renderSettingsRow(_("VLAN"), rows, configure);
        }

        function renderWireGuardSettingsRow() {
            const rows = [];
            const options = settings.wireguard;

            if (!options) {
                return null;
            }

            const configure = <NetworkAction type="wg" iface={iface} connectionSettings={settings} />;

            return renderSettingsRow(_("WireGuard"), rows, configure);
        }

        return [
            render_group(),
            renderAutoconnectRow(),
            renderIpSettingsRow("ipv4", _("IPv4")),
            renderIpSettingsRow("ipv6", _("IPv6")),
            renderMtuSettingsRow(),
            renderVlanSettingsRow(),
            renderBridgeSettingsRow(),
            renderBridgePortSettingsRow(),
            renderBondSettingsRow(),
            renderTeamSettingsRow(),
            renderTeamPortSettingsRow(),
            renderWireGuardSettingsRow(),
        ];
    }

    function renderWiFiNetworks() {
        if (!dev || dev.DeviceType !== '802-11-wireless')
            return null;

        let accessPoints = dev.AccessPoints || [];
        if (accessPoints.length === 0)
            return null;

        const activeSSID = dev.ActiveAccessPoint ? dev.ActiveAccessPoint.Ssid : null;

        // Deduplicate APs by MAC address, preferring ones with known SSID
        // only if they are active or have a matching connection
        const apByMac = new Map();
        accessPoints.forEach(ap => {
            const existing = apByMac.get(ap.HwAddress);
            if (!existing) {
                apByMac.set(ap.HwAddress, ap);
            } else if (!existing.Ssid && ap.Ssid) {
                // Prefer AP with SSID only if it's active or has a connection
                const isActive = activeSSID && ap.Ssid === activeSSID;
                if (isActive || ap.Connection) {
                    apByMac.set(ap.HwAddress, ap);
                }
            }
        });
        accessPoints = Array.from(apByMac.values());

        // Filter by search term
        const totalNetworks = accessPoints.length;
        if (networkSearch) {
            const searchLower = networkSearch.toLowerCase();
            accessPoints = accessPoints.filter(ap => {
                const ssid = ap.Ssid || _("(hidden network)");
                return ssid.toLowerCase().includes(searchLower);
            });
        }

        function forgetNetwork(ap) {
            const ssid = ap.Ssid || "";
            utils.debug("Forgetting network", ssid);

            if (ap.Connection) {
                ap.Connection.delete_()
                        .then(() => utils.debug("Forgot network", ssid))
                        .catch(show_unexpected_error);
            }
        }

        function connectToAP(ap) {
            const ssid = ap.Ssid || "";
            utils.debug("Connecting to", ssid);

            if (ap.Connection) {
                // Activate existing connection (which already has password if needed)
                utils.debug("Activating existing connection for", ssid);
                ap.Connection.activate(dev, ap)
                        .then(() => utils.debug("Connected successfully to", ssid))
                        .catch(show_unexpected_error);
                return;
            }

            // Create new connection
            const isSecured = !!(ap.WpaFlags || ap.RsnFlags);

            if (isSecured) {
                // Show password dialog for secured networks
                utils.debug("Showing password dialog for", ssid);
                Dialogs.show(<WiFiConnectDialog dev={dev} ap={ap} ssid={ssid} model={model} />);
                return;
            }

            // Create new connection for open networks
            utils.debug("Creating new connection for", ssid);
            const settings = {
                connection: {
                    id: ssid,
                    type: "802-11-wireless",
                    autoconnect: true,
                },
                "802-11-wireless": {
                    ssid: utils.ssid_to_nm(ssid),
                    mode: "infrastructure",
                }
            };

            dev.activate_with_settings(settings, ap)
                    .then(result => utils.debug("Connected successfully to", ssid))
                    .catch(show_unexpected_error);
        }

        const networkSort = (rows, direction, columnIndex) => {
            if (columnIndex === 0) {
                // Network column: simple alphabetical sort, no special cases
                const sorted = [...rows].sort((a, b) =>
                    a.columns[0].sortKey.localeCompare(b.columns[0].sortKey)
                );
                return direction === SortByDirection.asc ? sorted : sorted.reverse();
            } else {
                // Signal column (default): group by connected > known > unknown, each sorted by signal strength

                // Separate into groups
                const activeRows = [];
                const knownRows = [];
                const unknownRows = [];

                rows.forEach(r => {
                    const ssid = r.props["data-ssid"];
                    const isActive = activeSSID && ssid === activeSSID;
                    if (isActive) {
                        activeRows.push(r);
                    } else {
                        // Check if known by looking for Connection in the AP data
                        // We need to find the AP from accessPoints by matching MAC
                        const mac = r.props.key;
                        const ap = accessPoints.find(ap => ap.HwAddress === mac);
                        if (ap?.Connection) {
                            knownRows.push(r);
                        } else {
                            unknownRows.push(r);
                        }
                    }
                });

                // Sort each group by stable signal order
                const sortByStableOrder = (a, b) => {
                    const aMAC = a.props.key;
                    const bMAC = b.props.key;
                    const aOrder = stableAPOrder.current.indexOf(aMAC);
                    const bOrder = stableAPOrder.current.indexOf(bMAC);
                    if (aOrder === -1 || bOrder === -1) {
                        return a.columns[2].sortKey.localeCompare(b.columns[2].sortKey);
                    }
                    return aOrder - bOrder;
                };

                knownRows.sort(sortByStableOrder);
                unknownRows.sort(sortByStableOrder);

                // Concatenate groups
                const result = [...activeRows, ...knownRows, ...unknownRows];
                return direction === SortByDirection.asc ? result : result.reverse();
            }
        };

        const rows = accessPoints.map((ap, index) => {
            const isActive = activeSSID && ap.Ssid === activeSSID;
            const isSecured = !!(ap.WpaFlags || ap.RsnFlags);
            const displaySsid = ap.Ssid || _("(hidden network)");

            const securityIcon = isSecured
                ? <LockIcon aria-label={_("secured")} />
                : <LockOpenIcon aria-label={_("open")} />;

            const nameContent = (
                <>
                    {displaySsid}
                    {isActive && <>{" "} <ConnectedIcon className="nm-icon-connected" /></>}
                    {!isActive && ap.Connection && <>{" "} <ThumbtackIcon className="nm-icon-known" /></>}
                </>
            );

            const timestamp = ap.Connection?.Settings?.connection?.timestamp || 0;
            const nameColumn = timestamp > 0
                ? (
                    <Tooltip content={cockpit.format(_("Last connected: $0"), distanceToNow(timestamp * 1000))}>
                        <span>{nameContent}</span>
                    </Tooltip>
                )
                : nameContent;

            const signalColumn = (
                <Progress value={ap.Strength}
                          label={ap.Strength + "%"}
                          aria-label={_("Signal strength")}
                          size="sm" />
            );

            let actionColumn;
            if (isActive) {
                actionColumn = (
                    <Privileged allowed={privileged}
                                tooltipId={"wifi-disconnect-" + index}
                                excuse={_("Not permitted to disconnect network")}>
                        <Button variant="danger"
                                size="sm"
                                icon={<DisconnectedIcon />}
                                isDisabled={!privileged}
                                onClick={() => {
                                    dev.disconnect()
                                            .then(() => utils.debug("Disconnected successfully from", displaySsid))
                                            .catch(show_unexpected_error);
                                }}
                                aria-label={_("Disconnect")}>
                            {_("Disconnect")}
                        </Button>
                    </Privileged>
                );
            } else if (!ap.Ssid) {
                // Hidden network - no Connect button
                actionColumn = null;
            } else {
                actionColumn = (
                    <>
                        <Privileged allowed={privileged}
                                    tooltipId={"wifi-connect-" + index}
                                    excuse={_("Not permitted to connect to network")}>
                            <Button variant="secondary"
                                    size="sm"
                                    icon={<ConnectedIcon />}
                                    isDisabled={!privileged}
                                    onClick={() => connectToAP(ap)}
                                    aria-label={_("Connect")}>
                                {_("Connect")}
                            </Button>
                        </Privileged>
                        {ap.Connection && (
                            <>
                                {" "}
                                <Privileged allowed={privileged}
                                            tooltipId={"wifi-forget-" + index}
                                            excuse={_("Not permitted to forget network")}>
                                    <Button variant="danger"
                                            size="sm"
                                            icon={<TrashIcon />}
                                            isDisabled={!privileged}
                                            onClick={() => forgetNetwork(ap)}
                                            aria-label={_("Forget")}>
                                        {_("Forget")}
                                    </Button>
                                </Privileged>
                            </>
                        )}
                    </>
                );
            }

            return {
                columns: [
                    { title: nameColumn, sortKey: ap.Ssid, header: true },
                    { title: <>{securityIcon} {ap.Mode}</>, sortKey: ap.Mode },
                    { title: signalColumn, sortKey: String(ap.Strength).padStart(3, '0') },
                    { title: cockpit.format_bits_per_sec(ap.MaxBitrate * 1000) },
                    { title: actionColumn },
                ],
                props: { key: ap.HwAddress, "data-ssid": ap.Ssid }
            };
        });

        return (
            <Card isPlain id="network-interface-wifi-networks">
                <CardHeader actions={{
                    actions: (
                        <Flex>
                            {totalNetworks > 3 && (
                                <FlexItem>
                                    <SearchInput
                                        placeholder={_("Filter")}
                                        value={networkSearch}
                                        onChange={(_event, value) => setNetworkSearch(value)}
                                        onClear={() => setNetworkSearch("")}
                                    />
                                </FlexItem>
                            )}
                            <FlexItem>
                                <Button variant="secondary"
                                        onClick={() => Dialogs.show(<WiFiConnectDialog dev={dev} model={model} />)}
                                        icon={<PlusIcon />}>
                                    {_("Connect to hidden network")}
                                </Button>
                            </FlexItem>
                            <FlexItem>
                                <Button variant="secondary"
                                        onClick={() => { setIsScanning(true); dev.request_scan() }}
                                        isDisabled={isScanning}
                                        icon={isScanning ? <Spinner size="md" /> : <RedoIcon />}>
                                    {_("Refresh")}
                                </Button>
                            </FlexItem>
                        </Flex>
                    )
                }}>
                    <CardTitle component="h2">{_("Available networks")}</CardTitle>
                </CardHeader>
                <ListingTable aria-label={_("Available networks")}
                              variant='compact'
                              columns={[
                                  { title: _("Network"), header: true, sortable: true },
                                  { title: _("Mode") },
                                  { title: _("Signal"), sortable: true },
                                  { title: _("Rate") },
                                  { title: "", props: { screenReaderText: _("Actions") } },
                              ]}
                              sortBy={{ index: 2, direction: SortByDirection.asc }}
                              sortMethod={networkSort}
                              rows={rows} />
            </Card>
        );
    }

    function renderConnectionMembers(con) {
        const memberIfaces = { };
        const members = { };

        const rx_plot_data = {
            direct: "network.interface.in.bytes",
            internal: "network.interface.rx",
            units: "bytes",
            derive: "rate",
            factor: 8
        };

        const tx_plot_data = {
            direct: "network.interface.out.bytes",
            internal: "network.interface.tx",
            units: "bytes",
            derive: "rate",
            factor: 8
        };

        const cs = con && connection_settings(con);
        if (!con || (cs.type != "bond" && cs.type != "team" && cs.type != "bridge")) {
            plot_state.plot_instances('rx', rx_plot_data, [dev_name], true);
            plot_state.plot_instances('tx', tx_plot_data, [dev_name], true);
            return null;
        }

        const plot_ifaces = [];

        con.Members.forEach(member_con => {
            member_con.Interfaces.forEach(iface => {
                if (iface.MainConnection != member_con)
                    return;

                const dev = iface.Device;

                /* Unmanaged devices shouldn't show up as members
                 * but let's not take any chances.
                 */
                if (dev && !is_managed(dev))
                    return;

                plot_ifaces.push(iface.Name);
                usage_monitor.add(iface.Name);
                members[iface.Name] = iface;
                memberIfaces[iface.Name] = true;
            });
        });

        plot_state.plot_instances('rx', rx_plot_data, plot_ifaces, true);
        plot_state.plot_instances('tx', tx_plot_data, plot_ifaces, true);

        const sorted_members = Object.keys(members).sort()
                .map(name => members[name]);

        return (
            <NetworkInterfaceMembers members={sorted_members}
                                     memberIfaces={memberIfaces}
                                     interfaces={interfaces}
                                     iface={iface}
                                     usage_monitor={usage_monitor}
                                     privileged={privileged} />
        );
    }

    function createGhostConnectionSettings() {
        const settings = {
            connection: {
                interface_name: iface.Name
            },
            ipv4: {
                method: "auto",
                address_data: [],
                dns_data: [],
                dns_search: [],
                route_data: []
            },
            ipv6: {
                method: "auto",
                address_data: [],
                dns_data: [],
                dns_search: [],
                route_data: []
            }
        };
        complete_settings(settings, dev);
        return settings;
    }

    /* Disable the On/Off button for interfaces that we don't know about at all,
       and for devices that NM declares to be unavailable. Neither can be activated.
    */

    let onoff;
    if (isManaged) {
        onoff = (
            <Privileged allowed={privileged}
                        tooltipId="interface-switch"
                        excuse={ _("Not permitted to configure network devices") }>
                <Switch id="interface-switch"
                        isChecked={!!(dev && dev.ActiveConnection)}
                        isDisabled={!iface || (dev && dev.State == 20) || !privileged}
                        onChange={(_event, enable) => enable ? connect() : disconnect()}
                        aria-label={_("Enable or disable the device")} />
            </Privileged>
        );
    }

    const isDeletable = (iface && !dev) || (dev && (dev.DeviceType == 'bond' ||
                                                    dev.DeviceType == 'team' ||
                                                    dev.DeviceType == 'vlan' ||
                                                    dev.DeviceType == 'bridge' ||
                                                    dev.DeviceType == 'wireguard'));

    const settingsRows = renderConnectionSettingsRows(iface.MainConnection, connectionSettings)
            .map((component, idx) => <React.Fragment key={idx}>{component}</React.Fragment>);

    return (
        <Page id="network-interface"
              data-test-wait={operationInProgress}
              className="pf-m-no-sidebar">
            <PageBreadcrumb hasBodyWrapper={false} stickyOnBreakpoint={{ default: "top" }}>
                <Breadcrumb>
                    <BreadcrumbItem to='#/'>
                        {_("Networking")}
                    </BreadcrumbItem>
                    <BreadcrumbItem isActive>
                        {dev_name}
                    </BreadcrumbItem>
                </Breadcrumb>
            </PageBreadcrumb>
            <PageSection hasBodyWrapper={false}>
                <NetworkPlots plot_state={plot_state} />
            </PageSection>
            <PageSection hasBodyWrapper={false}>
                <Gallery hasGutter>
                    <Card isPlain className="network-interface-details">
                        <CardHeader actions={{
                            actions: (
                                <>
                                    {isDeletable && isManaged &&
                                    <Button variant="danger"
                                                 onClick={syn_click(model, deleteConnections)}
                                                 id="network-interface-delete">
                                        {_("Delete")}
                                    </Button>}
                                    {onoff}
                                </>
                            ),
                        }}>
                            <CardTitle className="network-interface-details-title">
                                <span id="network-interface-name">{dev_name}</span>
                                <span id="network-interface-hw">{renderDesc()}</span>
                                <span id="network-interface-mac">{renderMac()}</span>
                            </CardTitle>
                        </CardHeader>
                        <CardBody>
                            <DescriptionList id="network-interface-settings" className="network-interface-settings pf-m-horizontal-on-sm">
                                {renderActiveStatusRow()}
                                {renderCarrierStatusRow()}
                                {settingsRows}
                            </DescriptionList>
                        </CardBody>
                        { !isManaged
                            ? <CardBody>
                                {_("This device cannot be managed here.")}
                            </CardBody>
                            : null
                        }
                    </Card>
                    {renderWiFiNetworks()}
                    {renderConnectionMembers(iface.MainConnection)}
                </Gallery>
            </PageSection>
        </Page>
    );
};
