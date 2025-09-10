import React from 'react';
import { createRoot } from "react-dom/client";

import '../lib/patternfly/patternfly-6-cockpit.scss';

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";

import { install_dialog } from "../lib/cockpit-components-install-dialog.jsx";

import 'cockpit-dark-theme'; // once per page
import 'page.scss';

const PackageManagerPage = () => {
    const [isInstalling, setIsInstalling] = React.useState(false);
    const [installPackages, setInstallPackages] = React.useState("");

    const openInstallDialog = async () => {
        setIsInstalling(true);
        try {
            await install_dialog(installPackages.split(","));
        } finally {
            setIsInstalling(false);
        }
    };

    return (
        <Page isContentFilled className="no-masthead-sidebar">
            <PageSection hasBodyWrapper={false}>
                <Content>
                    <Card>
                        <CardTitle id="install-card-title">Install dialog test</CardTitle>
                        <CardBody>
                            <TextInput id="install-packages" value={installPackages} onChange={(_event, value) => setInstallPackages(value)} />
                            <Button id="install-button" variant="primary" onClick={() => openInstallDialog()} isLoading={isInstalling}>Install Package</Button>
                        </CardBody>
                    </Card>
                </Content>
            </PageSection>
        </Page>
    );
};

document.addEventListener("DOMContentLoaded", async () => {
    const root = createRoot(document.getElementById("packagemanager")!);
    root.render(<PackageManagerPage />);
});
