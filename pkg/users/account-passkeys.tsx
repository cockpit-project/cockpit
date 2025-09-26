import cockpit from "cockpit";
import React, { useState } from 'react';

import { Card, CardBody, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card";
import { Button } from "@patternfly/react-core";

const _ = cockpit.gettext;

function createCredentials() {
    navigator.credentials.create({
        publicKey: {
            challenge: new Uint8Array([
                // must be a cryptographically random number sent from a server
                0x8c, 0x0a, 0x26, 0xff, 0x22, 0x91, 0xc1, 0xe9, 0xb9, 0x4e, 0x2e, 0x17,
                0x1a, 0x98, 0x6a, 0x73, 0x71, 0x9d, 0x43, 0x48,
            ]),
            rp: { id: "localhost", name: "cockpit" },
            user: {
                id: new Uint8Array([0x1a, 0x98, 0x6a, 0x73, 0x71, 0x9d, 0x43]),
                name: "jamiedoe",
                displayName: "Jamie Doe",
            },
            attestation: "none",
            timeout: 60000,
            pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        },
    }).then(credential => {
        console.log("passkey", credential)
    });
}

export function AccountPasskeys (account: any) {
    // check for secure context
    if (!window.isSecureContext) {
        return <>This web page was not loaded in a secure context (https). Please try loading the page again using https or make sure you are using a browser with secure context support.</>
    }

    // check for WebAuthn CR features
    if (window.PublicKeyCredential === undefined ||
        typeof window.PublicKeyCredential !== "function" ||
        typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== "function") {
        return <>WebAuthn is not currently supported by this browser. See this webpage for a list of supported browsers: <a href="https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API#Browser_compatibility">Web Authentication: Browser Compatibility</a></>
    }

    return (
        <Card isPlain id="account-passkeys">
            <CardHeader>
                <CardTitle component="h2">Passkeys</CardTitle>
            </CardHeader>
            <CardBody>
                <Button variant="primary" ouiaId="Primary" onClick={() => createCredentials()}>
                    Create passkey
                </Button>
            </CardBody>
        </Card>
    );
}

// export function instance(user_name, home_dir) {
//     return new AccountPasskeys(user_name, home_dir);
// }
