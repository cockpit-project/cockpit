import cockpit from "cockpit";
import React, { useState } from 'react';

import { Card, CardBody, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card";
import { Button } from "@patternfly/react-core";

const _ = cockpit.gettext;

async function createCredentials(username: string) {
    console.log(username);
    const credential = await (navigator.credentials.create({
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
    })) as PublicKeyCredential | null;
    // FIXME: Testing purposes
    console.log("passkey", credential, credential?.toJSON());
    window.passkey = credential;
    // FIXME Testing purposes
    if (!credential) return;
    // Need to parse publickey from the response. Then we cast it to get the correct class as it's not done automatically
    const publicKey = btoa(String.fromCharCode.apply(null, new Uint8Array((credential.response as AuthenticatorAttestationResponse).getPublicKey())))
    return new Promise((resolve, reject) => {
            // credential ID is base64 encoded, need to decode before sending it. Format is (passkey:<id>,<publicKey>)
            // TODO: alice isn't showin in Accounts page, so hardcoding it for testing purposes.
            cockpit.spawn(["ipa", "user-add-passkey", "alice", `passkey:${btoa(credential.id)},${publicKey}`], { err: "out" })
                    .done(function() {
                        resolve();
                    })
                    .fail(function(ex, response) {
                        if (ex.exit_status) {
                            console.log(ex);
                            if (response)
                                ex = new Error(response);
                            else
                                ex = new Error(_("Failed to change password"));
                        }
                        reject(ex);
                    });
        });
}

export function isPasskeySupported(): boolean {
    return !(window.PublicKeyCredential === undefined ||
        typeof window.PublicKeyCredential !== "function" ||
        typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== "function")
}

export function AccountPasskeys ({account}: any) {
    // check for secure context
    if (!window.isSecureContext) {
        return <>This web page was not loaded in a secure context (https). Please try loading the page again using https or make sure you are using a browser with secure context support.</>
    }

    // check for WebAuthn CR features
    if (!isPasskeySupported()) {
        return <>WebAuthn is not currently supported by this browser. See this webpage for a list of supported browsers: <a href="https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API#Browser_compatibility">Web Authentication: Browser Compatibility</a></>
    }

    return (
        <Card isPlain id="account-passkeys">
            <CardHeader>
                <CardTitle component="h2">Passkeys</CardTitle>
            </CardHeader>
            <CardBody>
                <Button variant="primary" ouiaId="Primary" onClick={() => createCredentials(account.name)}>
                    Create passkey
                </Button>
            </CardBody>
        </Card>
    );
}

// export function instance(user_name, home_dir) {
//     return new AccountPasskeys(user_name, home_dir);
// }
