/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import React, { useState, useContext, useEffect } from 'react';
import cockpit from 'cockpit';
import * as ipaddr from "ipaddr.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { FormFieldGroup, FormFieldGroupHeader, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { Grid } from "@patternfly/react-core/dist/esm/layouts/Grid/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Tooltip } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";

import { PlusIcon, TrashIcon } from '@patternfly/react-icons';

import { NetworkModal, dialogSave } from './dialogs-common.jsx';
import { ModelContext } from './model-context.jsx';
import { useDialogs } from "dialogs.jsx";
import { ip_first_usable_address, ip_network_address, validate_ip, ip_prefix_from_text, ip4_prefix_from_text } from './utils.js';

const _ = cockpit.gettext;

const ip_method_choices = [
    { choice: 'auto', title: _("Automatic") },
    { choice: 'dhcp', title: _("Automatic (DHCP only)") },
    { choice: 'link-local', title: _("Link local") },
    { choice: 'manual', title: _("Manual") },
    { choice: 'ignore', title: _("Ignore") },
    { choice: 'shared', title: _("Shared") },
    { choice: 'disabled', title: _("Disabled") }
];

const supported_ipv4_methods = ['auto', 'link-local', 'manual', 'shared', 'disabled'];
// NM only supports a subset of IPv4 and IPv6 methods for wireguard
// See: https://gitlab.freedesktop.org/NetworkManager/NetworkManager/-/blob/1.42.8/src/libnm-core-impl/nm-setting-wireguard.c#L1723
const wg_supported_ipv4_methods = ['manual', 'disabled'];
const wg_supported_ipv6_methods = ['link-local', 'manual', 'ignored', 'disabled'];

export function get_ip_method_choices(topic, device_type) {
    if (topic === 'ipv4') {
        if (device_type === 'wireguard')
            return ip_method_choices.filter(item => wg_supported_ipv4_methods.includes(item.choice));
        return ip_method_choices.filter(item => supported_ipv4_methods.includes(item.choice));
    }

    if (device_type === 'wireguard')
        return ip_method_choices.filter(item => wg_supported_ipv6_methods.includes(item.choice));

    // IPv6 supports all the choices
    return ip_method_choices;
}

export const IpSettingsDialog = ({ topic, connection, dev, settings }) => {
    const Dialogs = useDialogs();
    const idPrefix = "network-ip-settings";
    const model = useContext(ModelContext);

    const params = settings[topic];
    const [addresses, setAddresses] = useState(params.address_data);
    const [defaultGateway, setDefaultGateway] = useState(params.gateway);
    const [gatewaySetExplicitly, setGatewaySetExplicitly] = useState(false);
    const [dialogError, setDialogError] = useState(undefined);
    const [dns, setDns] = useState(params.dns_data || []);
    const [dnsSearch, setDnsSearch] = useState(params.dns_search || []);
    const [ignoreAutoDns, setIgnoreAutoDns] = useState(params.ignore_auto_dns);
    const [ignoreAutoRoutes, setIgnoreAutoRoutes] = useState(params.ignore_auto_routes);
    const [method, setMethod] = useState(params.method);
    const [routes, setRoutes] = useState(params.route_data);

    // The link local, shared, and disabled methods can't take any
    // addresses, dns servers, or dns search domains.  Routes,
    // however, are ok, even for "disabled" and "ignored".  But
    // since that doesn't make sense, we remove routes as well for
    // these methods.
    const isOff = (method == "disabled" || method == "ignore");
    const canHaveExtra = !(method == "link-local" || method == "shared" || isOff);

    // The auto_*_btns only make sense when the address method
    // is "auto" or "dhcp".
    const canAuto = (method == "auto" || method == "dhcp");

    const prefixText = (topic == "ipv4") ? _("Prefix length or netmask") : _("Prefix length");

    useEffect(() => {
        // The manual method needs at least one address
        if (method == 'manual' && addresses.length == 0)
            setAddresses([{ address: "", prefix: "" }]);

        if (!canHaveExtra) {
            setAddresses([]);
            setDns([]);
            setDnsSearch([]);
        }

        if (isOff)
            setRoutes([]);
    }, [method, addresses.length, canHaveExtra, isOff]);

    const onSubmit = (_ev) => {
        const createSettingsObj = () => ({
            ...settings,
            [topic]: {
                ...settings[topic],
                method,
                address_data: addresses,
                gateway: defaultGateway,
                dns_data: dns,
                dns_search: dnsSearch,
                route_data: routes,
                ignore_auto_dns: ignoreAutoDns,
                ignore_auto_routes: ignoreAutoRoutes,
            }
        });

        dialogSave({
            model,
            dev,
            connection,
            settings: createSettingsObj(),
            setDialogError,
            onClose: Dialogs.close,
        });
    };

    const ipDefaultPrefix = (address) => {
        if (address.kind() === "ipv6") {
            return "64";
        }

        // use classful IPv4 prefixes when only host address is specified
        const octets = address.octets;
        if (octets[0] >= 0 && octets[0] <= 127) {
            return "8";
        } else if (octets[0] >= 128 && octets[0] <= 191) {
            return "16";
        } else if (octets[0] >= 192 && octets[0] <= 223) {
            return "24";
        }

        return "";
    };

    const addressHelper = (address_str, prefix_str, i, prefixField) => {
        const config = { address: address_str, prefix: prefix_str };

        if (!validate_ip(address_str)) {
            return config;
        }

        const address = ipaddr.parse(address_str);
        if (address.kind() !== topic) {
            return config;
        }

        if (prefix_str === "" && !prefixField) {
            config.prefix = ipDefaultPrefix(address);
        }

        // prefix_str can contain prefix or IPv4 subnet mask
        let numericPrefix;
        try {
            numericPrefix = (address.kind() === "ipv4") ? ip4_prefix_from_text(config.prefix) : ip_prefix_from_text(config.prefix);
        } catch (_e) {
            return config;
        }

        // do not set gateway for last three prefixes
        // /30 and /126 only has two usable addresses
        // /31 and /127 is a point-to-point link with no gateway
        // /32 and /128 is a single host address
        const maxPrefix = (address.kind() === "ipv4") ? 30 : 126;

        if (i === 0 && numericPrefix < maxPrefix && !gatewaySetExplicitly) {
            const netAddr = ip_network_address(address, numericPrefix);
            const firstAddr = ip_first_usable_address(address, numericPrefix);
            const addrCompactStr = address.toString();

            // do not set the default gateway automatically if the host address
            // is the first address in the subnet or network address
            if (firstAddr !== null && addrCompactStr !== firstAddr &&
                 netAddr !== null && netAddr !== addrCompactStr) {
                setDefaultGateway(firstAddr);
            } else {
                setDefaultGateway("");
            }
        } else if (!gatewaySetExplicitly) {
            // reset
            setDefaultGateway("");
        }

        return config;
    };

    const removeAddress = (i) => {
        // also reset gateway when removing the last address
        if (addresses.length === 1) {
            setDefaultGateway("");
            setGatewaySetExplicitly(false);
        }

        setAddresses(addresses.filter((_, index) => index !== i));
    };

    // Prefer device type if the device exists, otherwise fallback to a connection type
    // of an existing connection that is down in which case the device may not exist.
    const deviceType = dev?.DeviceType ?? connection?.Settings.connection.type;

    return (
        <NetworkModal dialogError={dialogError}
                      idPrefix={idPrefix}
                      onSubmit={onSubmit}
                      title={topic == "ipv4" ? _("IPv4 settings") : _("IPv6 settings")}
                      isFormHorizontal={false}
        >
            <FormFieldGroup
                data-field='addresses'
                header={
                    <FormFieldGroupHeader
                        titleText={{ text: _("Addresses") }}
                        actions={
                            <Flex>
                                <FormSelect className="network-ip-settings-method"
                                            id={idPrefix + "-select-method"}
                                            aria-label={_("Select method")}
                                            onChange={(_, val) => setMethod(val)}
                                            value={method}>
                                    {get_ip_method_choices(topic, deviceType).map(choice => <FormSelectOption value={choice.choice} label={choice.title} key={choice.choice} />)}
                                </FormSelect>
                                <Tooltip content={_("Add address")}>
                                    <Button icon={<PlusIcon />} variant="secondary"
                                        isDisabled={!canHaveExtra}
                                        onClick={() => setAddresses([...addresses, { address: "", prefix: "" }])}
                                        id={idPrefix + "-address-add"}
                                        aria-label={_("Add address")} />
                                </Tooltip>
                            </Flex>
                        }
                    />
                }
            >
                <Grid hasGutter>
                    {addresses.map((address, i) => {
                        return (
                            <React.Fragment key={i}>
                                <FormGroup fieldId={idPrefix + "-address-" + i} label={_("Address")} className="pf-m-6-col-on-sm">
                                    <TextInput id={idPrefix + "-address-" + i} value={address.address} onChange={(_event, value) => setAddresses(
                                        addresses.map((item, index) =>
                                            i === index
                                                ? addressHelper(value, item.prefix, i, false)
                                                : item
                                        ))} />
                                </FormGroup>
                                <FormGroup fieldId={idPrefix + "-netmask-" + i} label={prefixText} className="pf-m-6-col-on-sm">
                                    <TextInput id={idPrefix + "-netmask-" + i} value={address.prefix} onChange={(_event, value) => setAddresses(
                                        addresses.map((item, index) =>
                                            i === index
                                                ? addressHelper(item.address, value, i, true)
                                                : item
                                        ))} />
                                </FormGroup>
                                <FormGroup className="pf-m-1-col-on-sm remove-button-group">
                                    <Button variant='plain'
                                            isDisabled={method == 'manual' && i == 0}
                                            onClick={() => removeAddress(i)}
                                            aria-label={_("Remove item")}
                                            icon={<TrashIcon />} />
                                </FormGroup>
                            </React.Fragment>
                        );
                    })}
                    {addresses.length > 0 &&
                        <FormGroup fieldId={idPrefix + "-gateway"} label={_("Gateway")}>
                            <TextInput id={idPrefix + "-gateway"}
                                value={defaultGateway}
                                onChange={(_event, value) => { setDefaultGateway(value); setGatewaySetExplicitly(true) }}
                            />
                        </FormGroup>
                    }
                </Grid>
            </FormFieldGroup>
            <FormFieldGroup
                data-field='dns'
                header={
                    <FormFieldGroupHeader
                        titleText={{ text: _("DNS") }}
                        actions={
                            <Flex alignItems={{ default: 'alignItemsCenter' }}>
                                <Switch
                                    isChecked={!ignoreAutoDns}
                                    isDisabled={!canAuto}
                                    onChange={(_event, value) => setIgnoreAutoDns(!value)}
                                    label={_("Automatic")} />
                                <Tooltip content={_("Add DNS server")}>
                                    <Button icon={<PlusIcon />} variant="secondary"
                                        isDisabled={!canHaveExtra}
                                        onClick={() => setDns([...dns, ""])}
                                        id={idPrefix + "-dns-add"}
                                        aria-label={_("Add DNS server")} />
                                </Tooltip>
                            </Flex>
                        }
                    />
                }
            >
                {dns.map((server, i) => {
                    return (
                        <Grid key={i} hasGutter>
                            <FormGroup fieldId={idPrefix + "-dns-server-" + i} label={_("Server")}>
                                <TextInput id={idPrefix + "-dns-server-" + i} value={server} onChange={(_event, value) => setDns(
                                    dns.map((item, index) =>
                                        i === index
                                            ? value
                                            : item
                                    ))} />
                            </FormGroup>
                            <FormGroup className="pf-m-1-col-on-sm remove-button-group">
                                <Button variant='plain'
                                        size="sm"
                                        onClick={() => setDns(dns.filter((_, index) => index !== i))}
                                        aria-label={_("Remove item")}
                                        icon={<TrashIcon />} />
                            </FormGroup>
                        </Grid>
                    );
                })}
            </FormFieldGroup>
            <FormFieldGroup
                data-field='dns_search'
                header={
                    <FormFieldGroupHeader
                        titleText={{ text: _("DNS search domains") }}
                        actions={
                            <Flex alignItems={{ default: 'alignItemsCenter' }}>
                                <Switch
                                    isChecked={!ignoreAutoDns}
                                    isDisabled={!canAuto}
                                    onChange={(_event, value) => setIgnoreAutoDns(!value)}
                                    label={_("Automatic")} />
                                <Tooltip content={_("Add search domain")}>
                                    <Button icon={<PlusIcon />} variant="secondary"
                                        isDisabled={!canHaveExtra}
                                        onClick={() => setDnsSearch([...dnsSearch, ""])}
                                        id={idPrefix + "-dns-search-add"}
                                        aria-label={_("Add search domain")} />
                                </Tooltip>
                            </Flex>
                        }
                    />
                }
            >
                {dnsSearch.map((domain, i) => {
                    return (
                        <Grid key={i} hasGutter>
                            <FormGroup fieldId={idPrefix + "-search-domain-" + i} label={_("Search domain")}>
                                <TextInput id={idPrefix + "-search-domain-" + i} value={domain} onChange={(_event, value) => setDnsSearch(
                                    dnsSearch.map((item, index) =>
                                        i === index
                                            ? value
                                            : item
                                    ))} />
                            </FormGroup>
                            <FormGroup className="pf-m-1-col-on-sm remove-button-group">
                                <Button variant='plain'
                                        size="sm"
                                        onClick={() => setDnsSearch(dnsSearch.filter((_, index) => index !== i))}
                                        aria-label={_("Remove item")}
                                        icon={<TrashIcon />} />
                            </FormGroup>
                        </Grid>
                    );
                })}
            </FormFieldGroup>
            <FormFieldGroup
                data-field='routes'
                header={
                    <FormFieldGroupHeader
                        titleText={{ text: _("Routes") }}
                        actions={
                            <Flex alignItems={{ default: 'alignItemsCenter' }}>
                                <Switch
                                    isChecked={!ignoreAutoRoutes}
                                    isDisabled={!canAuto}
                                    onChange={(_event, value) => setIgnoreAutoRoutes(!value)}
                                    label={_("Automatic")} />
                                <Tooltip content={_("Add route")}>
                                    <Button icon={<PlusIcon />} variant="secondary"
                                        isDisabled={isOff}
                                        onClick={() => setRoutes([...routes, { dest: "", prefix: "", next_hop: "", metric: "" }])}
                                        id={idPrefix + "-route-add"}
                                        aria-label={_("Add route")} />
                                </Tooltip>
                            </Flex>
                        }
                    />
                }
            >
                {routes.map((route, i) => {
                    return (
                        <Grid key={i} hasGutter>
                            <FormGroup fieldId={idPrefix + "-route-address-" + i} label={_("Address")} className="pf-m-3-col-on-sm">
                                <TextInput id={idPrefix + "-route-address-" + i} value={route.dest} onChange={(_event, value) => setRoutes(
                                    routes.map((item, index) =>
                                        i === index
                                            ? { ...item, dest: value }
                                            : item
                                    ))} />
                            </FormGroup>
                            <FormGroup fieldId={idPrefix + "-route-netmask-" + i} label={prefixText} className="pf-m-4-col-on-sm">
                                <TextInput id={idPrefix + "-route-netmask-" + i} value={route.prefix} onChange={(_event, value) => setRoutes(
                                    routes.map((item, index) =>
                                        i === index
                                            ? { ...item, prefix: value }
                                            : item
                                    ))} />
                            </FormGroup>
                            <FormGroup fieldId={idPrefix + "-route-gateway-" + i} label={_("Gateway")} className="pf-m-3-col-on-sm">
                                <TextInput id={idPrefix + "-route-gateway-" + i} value={route.next_hop} onChange={(_event, value) => setRoutes(
                                    routes.map((item, index) =>
                                        i === index
                                            ? { ...item, next_hop: value }
                                            : item
                                    ))} />
                            </FormGroup>
                            <FormGroup fieldId={idPrefix + "-route-metric-" + i} label={_("Metric")} className="pf-m-2-col-on-sm">
                                <TextInput id={idPrefix + "-route-metric-" + i} value={route.metric} onChange={(_event, value) => setRoutes(
                                    routes.map((item, index) =>
                                        i === index
                                            ? { ...item, metric: value }
                                            : item
                                    ))} />
                            </FormGroup>
                            <FormGroup className="pf-m-1-col-on-sm remove-button-group">
                                <Button variant='plain'
                                        size="sm"
                                        onClick={() => setRoutes(routes.filter((_, index) => index !== i))}
                                        aria-label={_("Remove item")}
                                        icon={<TrashIcon />} />
                            </FormGroup>
                        </Grid>
                    );
                })}
            </FormFieldGroup>
        </NetworkModal>
    );
};
