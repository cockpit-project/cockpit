import React, { useState } from "react";
import { createRoot } from 'react-dom/client';

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Page } from "@patternfly/react-core/dist/esm/components/Page/index.js";

import cockpit from "cockpit";
import { WithDialogs, useDialogs } from "dialogs.jsx";
import { connect_host } from "cockpit-connect-ssh";

import '../lib/patternfly/patternfly-5-cockpit.scss';

const RemotePage = () => {
    const dialogs = useDialogs();
    const [host, setHost] = useState("127.0.0.1");
    const [user, setUser] = useState("");
    const [command, setCommand] = useState("hostname");
    const [output, setOutput] = useState("");
    const [error, setError] = useState("");

    const on_go = async () => {
        setOutput("");
        setError("");
        try {
            await connect_host(dialogs, host, user);
            const out = await cockpit.script(command, [], { host, user });
            setOutput(out.trim());
        } catch (ex) {
            setError(JSON.stringify(ex));
        }
    };

    return (
        <Page>
            <Form isHorizontal>
                <FormGroup fieldId="host" label="Host" isRequired>
                    <TextInput id="host" value={host} onChange={(_ev, value) => setHost(value)} isRequired />
                </FormGroup>
                <FormGroup fieldId="user" label="User">
                    <TextInput id="user" value={user} onChange={(_ev, value) => setUser(value)} isRequired />
                </FormGroup>
                <FormGroup fieldId="command" label="Command" isRequired>
                    <TextInput id="command" value={command} onChange={(_ev, value) => setCommand(value)} isRequired />
                </FormGroup>
                <Button onClick={on_go}>Go</Button>
            </Form>

            <label htmlFor="output" className="control-label">Output:</label>
            <pre id="output">{output}</pre>
            <label htmlFor="error" className="control-label">Error:</label>
            <span id="error">{error}</span>
        </Page>
    );
};

document.addEventListener("DOMContentLoaded", () => {
    cockpit.translate();
    const app = document.getElementById("app");
    cockpit.assert(app);
    createRoot(app).render(<WithDialogs><RemotePage /></WithDialogs>);
    // signal tests that we are ready
    cockpit.transport.wait(() => true);
});
