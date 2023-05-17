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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import React, { useState, useContext, useEffect } from 'react';
import cockpit from 'cockpit';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { FormFieldGroup, FormFieldGroupHeader, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { Grid } from "@patternfly/react-core/dist/esm/layouts/Grid/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";

import { MinusIcon, PlusIcon } from '@patternfly/react-icons';

import { NetworkModal, dialogSave } from './dialogs-common.jsx';
import { ModelContext } from './model-context.jsx';
import { useDialogs } from "dialogs.jsx";

const _ = cockpit.gettext;

export const ipv4_method_choices =
    [
        { choice: 'auto', title: _("Automatic (DHCP)") },
        { choice: 'link-local', title: _("Link local") },
        { choice: 'manual', title: _("Manual") },
        { choice: 'shared', title: _("Shared") },
        { choice: 'disabled', title: _("Disabled") }
    ];

export const ipv6_method_choices =
    [
        { choice: 'auto', title: _("Automatic") },
        { choice: 'dhcp', title: _("Automatic (DHCP only)") },
        { choice: 'link-local', title: _("Link local") },
        { choice: 'manual', title: _("Manual") },
        { choice: 'ignore', title: _("Ignore") },
        { choice: 'shared', title: _("Shared") },
        { choice: 'disabled', title: _("Disabled") }
    ];

export const IpSettingsDialog = ({ topic, connection, dev, settings }) => {
    const Dialogs = useDialogs();
    const idPrefix = "network-ip-settings";
    const model = useContext(ModelContext);

    const params = settings[topic];
    const [addresses, setAddresses] = useState(params.addresses ? params.addresses.map(addr => ({ address: addr[0], netmask: addr[1], gateway: addr[2] })) : []);
    const [dialogError, setDialogError] = useState(undefined);
    const [dns, setDns] = useState(params.dns || []);
    const [dnsSearch, setDnsSearch] = useState(params.dns_search || []);
    const [ignoreAutoDns, setIgnoreAutoDns] = useState(params.ignore_auto_dns);
    const [ignoreAutoRoutes, setIgnoreAutoRoutes] = useState(params.ignore_auto_routes);
    const [method, setMethod] = useState(params.method);
    const [routes, setRoutes] = useState(params.routes ? params.routes.map(addr => ({ address: addr[0], netmask: addr[1], gateway: addr[2], metric: addr[3] })) : []);

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

    useEffect(() => {
        // The manual method needs at least one address
        if (method == 'manual' && addresses.length == 0)
            setAddresses([{ address: "", netmask: "", gateway: "" }]);

        if (!canHaveExtra) {
            setAddresses([]);
            setDns([]);
            setDnsSearch([]);
        }

        if (isOff)
            setRoutes([]);
    }, [method, addresses.length, canHaveExtra, isOff]);

    const onSubmit = (ev) => {
        const createSettingsObj = () => ({
            ...settings,
            [topic]: {
                ...settings[topic],
                method,
                addresses: addresses.map(addr => [addr.address, addr.netmask, addr.gateway]),
                dns,
                dns_search: dnsSearch,
                routes: routes.map(route => [route.address, route.netmask, route.gateway, route.metric]),
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

        // Prevent dialog from closing because of <form> onsubmit event
        if (event)
            event.preventDefault();

        return false;
    };
    const addressIpv4Helper = (address) => {
        const config = { address, netmask: null, gateway: null };
        const split = address.split('.');

        if (split.length !== 4)
            return config;

        config.gateway = `${split[0]}.${split[1]}.${split[2]}.${split[3] === "1" ? "254" : "1"}`;
        if (split[0] >= 0 && split[0] <= 127) {
            return { ...config, netmask: "255.0.0.0" };
        } else if (split[0] >= 128 && split[0] <= 191) {
            return { ...config, netmask: "255.255.0.0" };
        } else if (split[0] <= 192 && split[0] <= 223) {
            return { ...config, netmask: "255.255.255.0" };
        } else return { ...config, gateway: null };
    };

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
                                    {(topic == "ipv4" ? ipv4_method_choices : ipv6_method_choices).map(choice => <FormSelectOption value={choice.choice} label={choice.title} key={choice.choice} />)}
                                </FormSelect>
                                <Button variant="secondary"
                                        isDisabled={!canHaveExtra}
                                        onClick={() => setAddresses([...addresses, { address: "", netmask: "", gateway: "" }])}
                                        id={idPrefix + "-address-add"}
                                        aria-label={_("Add item")}
                                        icon={<PlusIcon />} />
                            </Flex>
                        }
                    />
                }
            >
                {addresses.map((address, i) => {
                    const prefixText = (topic == "ipv4") ? _("Prefix length or netmask") : _("Prefix length");

                    return (
                        <Grid key={i} hasGutter>
                            <FormGroup fieldId={idPrefix + "-address-" + i} label={_("Address")} className="pf-m-4-col-on-sm">
                                <TextInput id={idPrefix + "-address-" + i} value={address.address} onChange={(_event, value) => setAddresses(
                                    addresses.map((item, index) =>
                                        i === index
                                            ? addressIpv4Helper(value)
                                            : item
                                    ))} />
                            </FormGroup>
                            <FormGroup fieldId={idPrefix + "-netmask-" + i} label={prefixText} className="pf-m-4-col-on-sm">
                                <TextInput id={idPrefix + "-netmask-" + i} value={address.netmask} onChange={(_event, value) => setAddresses(
                                    addresses.map((item, index) =>
                                        i === index
                                            ? { ...item, netmask: value }
                                            : item
                                    ))} />
                            </FormGroup>
                            <FormGroup fieldId={idPrefix + "-gateway-" + i} label={_("Gateway")} className="pf-m-4-col-on-sm">
                                <TextInput id={idPrefix + "-gateway-" + i} value={address.gateway} onChange={(_event, value) => setAddresses(
                                    addresses.map((item, index) =>
                                        i === index
                                            ? { ...item, gateway: value }
                                            : item
                                    ))} />
                            </FormGroup>
                            <FormGroup className="pf-m-1-col-on-sm remove-button-group">
                                <Button variant='secondary'
                                        isDisabled={method == 'manual' && i == 0}
                                        onClick={() => setAddresses(addresses.filter((_, index) => index !== i))}
                                        aria-label={_("Remove item")}
                                        icon={<MinusIcon />} />
                            </FormGroup>
                        </Grid>
                    );
                })}
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
                                <Button variant="secondary"
                                        isDisabled={!canHaveExtra}
                                        onClick={() => setDns([...dns, ""])}
                                        id={idPrefix + "-dns-add"}
                                        aria-label={_("Add item")}
                                        icon={<PlusIcon />} />
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
                                <Button variant='secondary'
                                        size="sm"
                                        onClick={() => setDns(dns.filter((_, index) => index !== i))}
                                        aria-label={_("Remove item")}
                                        icon={<MinusIcon />} />
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
                                <Button variant="secondary"
                                        isDisabled={!canHaveExtra}
                                        onClick={() => setDnsSearch([...dnsSearch, ""])}
                                        id={idPrefix + "-dns-search-add"}
                                        aria-label={_("Add item")}
                                        icon={<PlusIcon />} />
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
                                <Button variant='secondary'
                                        size="sm"
                                        onClick={() => setDnsSearch(dnsSearch.filter((_, index) => index !== i))}
                                        aria-label={_("Remove item")}
                                        icon={<MinusIcon />} />
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
                                <Button variant="secondary"
                                        isDisabled={isOff}
                                        onClick={() => setRoutes([...routes, { address: "", netmask: "", gateway: "", metric: "" }])}
                                        id={idPrefix + "-route-add"}
                                        aria-label={_("Add item")}
                                        icon={<PlusIcon />} />
                            </Flex>
                        }
                    />
                }
            >
                {routes.map((route, i) => {
                    return (
                        <Grid key={i} hasGutter>
                            <FormGroup fieldId={idPrefix + "-route-address-" + i} label={_("Address")} className="pf-m-3-col-on-sm">
                                <TextInput id={idPrefix + "-route-address-" + i} value={route.address} onChange={(_event, value) => setRoutes(
                                    routes.map((item, index) =>
                                        i === index
                                            ? { ...item, address: value }
                                            : item
                                    ))} />
                            </FormGroup>
                            <FormGroup fieldId={idPrefix + "-route-netmask-" + i} label={_("Prefix length or netmask")} className="pf-m-4-col-on-sm">
                                <TextInput id={idPrefix + "-route-netmask-" + i} value={route.netmask} onChange={(_event, value) => setRoutes(
                                    routes.map((item, index) =>
                                        i === index
                                            ? { ...item, netmask: value }
                                            : item
                                    ))} />
                            </FormGroup>
                            <FormGroup fieldId={idPrefix + "-route-gateway-" + i} label={_("Gateway")} className="pf-m-3-col-on-sm">
                                <TextInput id={idPrefix + "-route-gateway-" + i} value={route.gateway} onChange={(_event, value) => setRoutes(
                                    routes.map((item, index) =>
                                        i === index
                                            ? { ...item, gateway: value }
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
                                <Button variant='secondary'
                                        size="sm"
                                        onClick={() => setRoutes(routes.filter((_, index) => index !== i))}
                                        aria-label={_("Remove item")}
                                        icon={<MinusIcon />} />
                            </FormGroup>
                        </Grid>
                    );
                })}
            </FormFieldGroup>
        </NetworkModal>
    );
};
