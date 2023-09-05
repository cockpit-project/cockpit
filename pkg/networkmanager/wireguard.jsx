/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2023 Red Hat, Inc.
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

import React, { useContext, useEffect, useState } from 'react';
import cockpit from 'cockpit';
import { Button } from '@patternfly/react-core/dist/esm/components/Button/index.js';
import { ClipboardCopy } from '@patternfly/react-core/dist/esm/components/ClipboardCopy/index.js';
import { EmptyState, EmptyStateBody } from '@patternfly/react-core/dist/esm/components/EmptyState/index.js';
import { FormGroup, FormFieldGroup, FormFieldGroupHeader, FormHelperText } from '@patternfly/react-core/dist/esm/components/Form/index.js';
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Grid } from '@patternfly/react-core/dist/esm/layouts/Grid/index.js';
import { HelperText, HelperTextItem } from '@patternfly/react-core/dist/esm/components/HelperText/index';
import { InputGroup } from '@patternfly/react-core/dist/esm/components/InputGroup/index.js';
import { Popover } from '@patternfly/react-core/dist/esm/components/Popover/index.js';
import { Radio } from '@patternfly/react-core/dist/esm/components/Radio/index.js';
import { Text } from "@patternfly/react-core/dist/esm/components/Text/index.js";
import { TextInput } from '@patternfly/react-core/dist/esm/components/TextInput/index.js';
import { HelpIcon, TrashIcon } from '@patternfly/react-icons';

import { Name, NetworkModal, dialogSave } from "./dialogs-common";
import { ModelContext } from './model-context';
import { useDialogs } from 'dialogs.jsx';

import './wireguard.scss';

const _ = cockpit.gettext;

function addressesToString(addresses) {
    return addresses.map(address => address[0] + "/" + address[1]).join(", ");
}

function stringToAddresses(str) {
    return str.split(/[\s,]+/).map(strAddress => {
        const parts = strAddress.split("/");
        if (parts.length > 2) {
            throw new Error(_("Addresses are not formatted correctly"));
        }
        const [ip, prefix] = parts;
        const defaultPrefix = "32";
        // Gateway usually conflicts with routing that NetworkManager configures for WireGuard interfaces
        // So it should not be set in that case or more accurately set to 0 i.e. "0.0.0.0" in string format
        const gateway = "0.0.0.0";
        return [ip, prefix ?? defaultPrefix, gateway];
    });
}

export function WireGuardDialog({ settings, connection, dev }) {
    const Dialogs = useDialogs();
    const idPrefix = "network-wireguard-settings";
    const model = useContext(ModelContext);

    const [iface, setIface] = useState(settings.connection.interface_name);
    const [isPrivKeyGenerated, setIsPrivKeyGenerated] = useState(true);
    const [generatedPrivateKey, setGeneratedPrivateKey] = useState("");
    const [pastedPrivateKey, setPastedPrivatedKey] = useState("");
    const [publicKey, setPublicKey] = useState("");
    const [listenPort, setListenPort] = useState(settings.wireguard.listen_port);
    const [addresses, setAddresses] = useState(addressesToString(settings.ipv4.addresses));
    const [dialogError, setDialogError] = useState("");
    const [peers, setPeers] = useState(settings.wireguard.peers.map(peer => ({ ...peer, allowedIps: peer.allowedIps.join(",") })));

    // Additional check for `wg` after install_dialog for non-packagekit and el8 environments
    useEffect(() => {
        async function checkWireguardPackage() {
            try {
                await cockpit.script("command -v wg");
            } catch (e) {
                setDialogError(_("wireguard-tools package is not installed"));
            }
        }

        checkWireguardPackage();
    }, []);

    useEffect(() => {
        if (!connection)
            generatePrivateKey();
    }, [connection]);

    useEffect(() => {
        async function getPrivateKey() {
            const objpath = connection[" priv"].path;
            const [result] = await model.client.call(objpath, "org.freedesktop.NetworkManager.Settings.Connection", "GetSecrets", ["wireguard"]);
            setGeneratedPrivateKey(result.wireguard["private-key"].v);
        }

        if (connection?.[" priv"].path) {
            getPrivateKey();
        }
    }, [model, connection]);

    useEffect(() => {
        const privateKey = isPrivKeyGenerated ? generatedPrivateKey : pastedPrivateKey;
        if (privateKey === "") {
            setPublicKey("");
            return;
        }

        async function getPublicKey() {
            try {
                const key = await cockpit.spawn(["wg", "pubkey"], { err: 'message' }).input(privateKey.trim());
                setPublicKey(key.trim());
            } catch (e) {
                console.error(e.message);
                setPublicKey('');
            }
        }

        getPublicKey();
    }, [isPrivKeyGenerated, generatedPrivateKey, pastedPrivateKey]);

    async function generatePrivateKey() {
        try {
            const key = await cockpit.spawn(["wg", "genkey"]);
            setGeneratedPrivateKey(key.trim());
        } catch (e) {
            setDialogError(e.message);
        }
    }

    function onSubmit() {
        const private_key = isPrivKeyGenerated ? generatedPrivateKey : pastedPrivateKey;

        // Validate Addresses before submit
        // Also validate listenPort as PF TextInput[type=number] accepts normal text as well on firefox
        // See - https://github.com/patternfly/patternfly-react/issues/9391
        let addr, peersArr;
        const listen_port = Number(listenPort);
        try {
            addr = stringToAddresses(addresses);

            if (isNaN(listen_port)) {
                throw new Error(_("Listen port must be a number"));
            }

            peersArr = peers.map((peer, index) => {
                if (peer.endpoint !== '') {
                    const parts = peer.endpoint.split(":");
                    if (parts.length !== 2) {
                        throw cockpit.format(_("Peer #$0 has invalid endpoint. It must be specified as host:port, e.g. 1.2.3.4:51820 or example.com:51820"), index + 1);
                    }
                    const [, port] = parts;
                    if (port == '' || isNaN(Number(port))) {
                        throw cockpit.format(_("Peer #$0 has invalid endpoint port. Port must be a number."), index + 1);
                    }
                }
                return ({ ...peer, allowedIps: peer.allowedIps.split(',') });
            });
        } catch (e) {
            setDialogError(typeof e === 'string' ? e : e.message);
            return;
        }

        function createSettingsObj() {
            return {
                ...settings,
                connection: {
                    ...settings.connection,
                    id: `con-${iface}`,
                    interface_name: iface,
                    type: 'wireguard'
                },
                wireguard: {
                    private_key,
                    listen_port,
                    peers: peersArr,
                },
                ipv4: {
                    addresses: addr,
                    method: 'manual',
                    dns: [],
                    dns_search: []
                }
            };
        }

        dialogSave({
            connection,
            dev,
            model,
            settings: createSettingsObj(),
            onClose: Dialogs.close,
            setDialogError
        });
    }

    return (
        <NetworkModal
            title={!connection ? _("Add WireGuard VPN") : _("Edit WireGuard VPN")}
            onSubmit={onSubmit}
            dialogError={dialogError}
            idPrefix={idPrefix}
            submitDisabled={!iface || !addresses || !generatedPrivateKey}
            isCreateDialog={!connection}
        >
            <Name idPrefix={idPrefix} iface={iface} setIface={setIface} />
            <FormGroup label={_("Private key")} fieldId={idPrefix + '-private-key-input'} isInline hasNoPaddingTop>
                <Radio label={_("Generated")} name="private-key" id={idPrefix + '-generated-key'} defaultChecked onChange={() => { setIsPrivKeyGenerated(true) }} />
                <Radio label={_("Paste existing key")} name="private-key" id={idPrefix + '-paste-key'} onChange={() => { setIsPrivKeyGenerated(false) }} />

                {isPrivKeyGenerated
                    ? <InputGroup className='pf-v5-u-pt-sm'>
                        <Flex className='pf-v5-u-w-100' spaceItems={{ default: 'spaceItemsSm' }}>
                            <FlexItem grow={{ default: 'grow' }}>
                                <ClipboardCopy isReadOnly id={idPrefix + '-private-key-input'} className='pf-v5-u-font-family-monospace pf-v5-u-w-100'>{generatedPrivateKey}</ClipboardCopy>
                            </FlexItem>
                            {connection && <FlexItem>
                                <Button variant='secondary' onClick={generatePrivateKey}>{_("Regenerate")}</Button>
                            </FlexItem>}
                        </Flex>
                    </InputGroup>
                    : <InputGroup className='pf-v5-u-pt-sm'>
                        <TextInput id={idPrefix + '-private-key-input'}
                            className='pf-v5-u-font-family-monospace'
                            value={pastedPrivateKey}
                            onChange={(_, val) => setPastedPrivatedKey(val)}
                            isDisabled={isPrivKeyGenerated}
                        />
                    </InputGroup>}
            </FormGroup>
            <FormGroup label={_("Public key")}>
                {(isPrivKeyGenerated || publicKey)
                    ? <ClipboardCopy isReadOnly className='pf-v5-u-font-family-monospace' id={idPrefix + '-public-key'}>{publicKey}</ClipboardCopy>
                    : <Flex className='placeholder-text' alignItems={{ default: 'alignItemsCenter' }}><Text>{_("Public key will be generated when a valid private key is entered")}</Text></Flex>}
            </FormGroup>
            <FormGroup label={_("Listen port")} fieldId={idPrefix + '-listen-port-input'}>
                <Flex>
                    <TextInput id={idPrefix + '-listen-port-input'} className='network-number-field' value={listenPort} onChange={(_, val) => { setListenPort(val) }} />
                    {!parseInt(listenPort) && <FormHelperText>
                        <HelperText>
                            <HelperTextItem>{_("Will be set to \"Automatic\"")}</HelperTextItem>
                        </HelperText>
                    </FormHelperText>}
                </Flex>
            </FormGroup>
            <FormGroup label={_("IPv4 addresses")} fieldId={idPrefix + '-addresses-input'}>
                <TextInput id={idPrefix + '-addresses-input'} value={addresses} onChange={(_, val) => { setAddresses(val) }} placeholder="Example, 10.0.0.1/24, 1.2.3.4/24" />
                <FormHelperText>
                    <HelperText>
                        <HelperTextItem>{_("Multiple addresses can be specified using commas or spaces as delimiters.")}</HelperTextItem>
                    </HelperText>
                </FormHelperText>
            </FormGroup>
            <FormFieldGroup
                header={
                    <FormFieldGroupHeader
                        className='pf-v5-u-align-items-center'
                        titleText={{
                            text: (
                                <Flex className='pf-m-space-items-none'>
                                    <FlexItem>
                                        <Text>{_("Peers")}</Text>
                                    </FlexItem>
                                    <FlexItem>
                                        <Popover
                                            bodyContent={
                                                <p>{_("Peers are other machines that connect with this one. Public keys from other machines will be shared with each other.")}</p>
                                            }
                                            footerContent={
                                                <p>{_("Endpoint acting as a \"server\" need to be specified as host:port, otherwise it can be left empty.")}</p>
                                            }
                                        >
                                            <Button variant='plain'><HelpIcon /></Button>
                                        </Popover>
                                    </FlexItem>
                                </Flex>
                            )
                        }}
                        actions={
                            <Button
                                variant='secondary'
                                onClick={() => setPeers(peers => [...peers, { publicKey: '', endpoint: '', allowedIps: '' }])}
                            >
                                {_("Add peer")}
                            </Button>
                        }
                    />
                }
                className='dynamic-form-group'
            >
                {(peers.length !== 0)
                    ? peers.map((peer, i) => (
                        <Grid key={i} hasGutter id={idPrefix + '-peer-' + i}>
                            <FormGroup className='pf-m-6-col-on-md' label={_("Public key")} fieldId={idPrefix + '-publickey-peer-' + i}>
                                <TextInput
                                    value={peer.publicKey}
                                    onChange={(_, val) => {
                                        setPeers(peers => peers.map((peer, index) => i === index ? { ...peer, publicKey: val } : peer));
                                    }}
                                    id={idPrefix + '-publickey-peer-' + i}
                                />
                            </FormGroup>
                            <FormGroup className='pf-m-3-col-on-md' label={_("Endpoint")} fieldId={idPrefix + '-endpoint-peer-' + i}>
                                <TextInput
                                    value={peer.endpoint}
                                    onChange={(_, val) => {
                                        setPeers(peers => peers.map((peer, index) => i === index ? { ...peer, endpoint: val } : peer));
                                    }}
                                    id={idPrefix + '-endpoint-peer-' + i}
                                />
                            </FormGroup>
                            <FormGroup className='pf-m-3-col-on-md' label={_("Allowed IPs")} fieldId={idPrefix + '-allowedips-peer-' + i}>
                                <TextInput
                                    value={peer.allowedIps}
                                    onChange={(_, val) => {
                                        setPeers(peers => peers.map((peer, index) => i === index ? { ...peer, allowedIps: val } : peer));
                                    }}
                                    id={idPrefix + '-allowedips-peer-' + i}
                                />
                            </FormGroup>
                            <FormGroup className='pf-m-1-col-on-md remove-button-group'>
                                <Button
                                    variant='plain'
                                    id={idPrefix + '-btn-close-peer-' + i}
                                    onClick={() => {
                                        setPeers(peers => peers.filter((_, index) => i !== index));
                                    }}
                                >
                                    <TrashIcon />
                                </Button>
                            </FormGroup>
                        </Grid>
                    ))
                    : <EmptyState>
                        <EmptyStateBody>{_("No peers added.")}</EmptyStateBody>
                    </EmptyState>
                }
            </FormFieldGroup>
        </NetworkModal>
    );
}

export function getWireGuardGhostSettings({ newIfaceName }) {
    return {
        connection: {
            id: `con-${newIfaceName}`,
            interface_name: newIfaceName
        },
        wireguard: {
            listen_port: 0,
            private_key: "",
            peers: []
        },
        ipv4: {
            addresses: []
        }
    };
}
