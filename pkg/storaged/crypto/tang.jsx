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

import cockpit from "cockpit";
import React from "react";

import { ClipboardCopy } from "@patternfly/react-core/dist/esm/components/ClipboardCopy/index.js";
import { Text, TextContent, TextVariants } from "@patternfly/react-core/dist/esm/components/Text/index.js";

import sha1 from "js-sha1";
import sha256 from "js-sha256";
import stable_stringify from "json-stable-stringify-without-jsonify";

const _ = cockpit.gettext;

export function validate_url(url) {
    if (url.length === 0)
        return _("Address cannot be empty");
    if (!parse_url(url))
        return _("Address is not a valid URL");
}

export function get_tang_adv(url) {
    return cockpit.spawn(["curl", "-sSf", url + "/adv"], { err: "message" })
            .then(JSON.parse)
            .catch(error => {
                return Promise.reject(error.toString().replace(/^curl: \([0-9]+\) /, ""));
            });
}

function parse_url(url) {
    // clevis-encrypt-tang defaults to "http://" (via curl), so we do the same here.
    if (!/^[a-zA-Z]+:\/\//.test(url))
        url = "http://" + url;
    try {
        return new URL(url);
    } catch (e) {
        if (e instanceof TypeError)
            return null;
        throw e;
    }
}

function tang_adv_payload(adv) {
    return JSON.parse(window.atob(adv.payload));
}

function jwk_b64_encode(bytes) {
    // Use the urlsafe character set, and strip the padding.
    return cockpit.base64_encode(bytes).replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, '');
}

function compute_thp(jwk) {
    const REQUIRED_ATTRS = {
        RSA: ['kty', 'p', 'd', 'q', 'dp', 'dq', 'qi', 'oth'],
        EC: ['kty', 'crv', 'x', 'y'],
        oct: ['kty', 'k'],
    };

    if (!jwk.kty)
        return "(no key type attribute=";
    if (!REQUIRED_ATTRS[jwk.kty])
        return cockpit.format("(unknown keytype $0)", jwk.kty);

    const req = REQUIRED_ATTRS[jwk.kty];
    const norm = { };
    req.forEach(k => { if (k in jwk) norm[k] = jwk[k]; });
    return {
        sha256: jwk_b64_encode(sha256.digest(stable_stringify(norm))),
        sha1: jwk_b64_encode(sha1.digest(stable_stringify(norm)))
    };
}

function compute_sigkey_thps(adv) {
    function is_signing_key(jwk) {
        if (!jwk.use && !jwk.key_ops)
            return true;
        if (jwk.use == "sig")
            return true;
        if (jwk.key_ops && jwk.key_ops.indexOf("verify") >= 0)
            return true;
        return false;
    }

    return adv.keys.filter(is_signing_key).map(compute_thp);
}

export const TangKeyVerification = ({ url, adv }) => {
    const parsed = parse_url(url);
    const cmd = cockpit.format("ssh $0 tang-show-keys $1", parsed.hostname, parsed.port);
    const sigkey_thps = compute_sigkey_thps(tang_adv_payload(adv));

    return (
        <TextContent>
            <Text component={TextVariants.p}>{_("Check the key hash with the Tang server.")}</Text>

            <Text component={TextVariants.h3}>{_("How to check")}</Text>
            <span>{_("In a terminal, run: ")}</span>
            <ClipboardCopy hoverTip={_("Copy to clipboard")}
                            clickTip={_("Successfully copied to clipboard!")}
                            variant="inline-compact"
                            isCode>
                {cmd}
            </ClipboardCopy>
            <Text component={TextVariants.p}>
                {_("Check that the SHA-256 or SHA-1 hash from the command matches this dialog.")}
            </Text>

            <Text component={TextVariants.h3}>{_("SHA-256")}</Text>
            { sigkey_thps.map(s => <Text key={s.sha256} component={TextVariants.pre}>{s.sha256}</Text>) }

            <Text component={TextVariants.h3}>{_("SHA-1")}</Text>
            { sigkey_thps.map(s => <Text key={s.sha1} component={TextVariants.pre}>{s.sha1}</Text>) }
        </TextContent>);
};
