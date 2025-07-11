import cockpit from "cockpit";
import React from 'react';
import { createRoot } from "react-dom/client";
import 'cockpit-dark-theme'; // once per page

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { List, ListItem } from "@patternfly/react-core/dist/esm/components/List/index.js";
import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import {
    CheckIcon,
    ExclamationCircleIcon,
} from '@patternfly/react-icons';

import * as PK from "../lib/dnf5daemon.js";

import '../lib/patternfly/patternfly-6-cockpit.scss';
import "../../node_modules/@patternfly/patternfly/components/Page/page.css";

const DnfPage = ({ exists }) => {
    const [isRefreshing, setRefreshing] = React.useState(false);
    const [events, setEvents] = React.useState([]);

    const progressCallback = (signal_text) => {
        setEvents(prevState => [...prevState, signal_text]);
    };

    const refreshDatabase = async () => {
        setEvents([]);
        setRefreshing(true);
        const data = await PK.check_missing_packages("bash", progressCallback);
        console.log(data);
        setRefreshing(false);
    };

    const cancelRefreshDatabase = () => {
        setRefreshing(false);
    };
    console.log("events", events);

    return (
        <Page id="accounts" className='no-masthead-sidebar'>
            <PageSection hasBodyWrapper={false}>
                <Content>
                    <h1>dnf5daemon example</h1>
                    <p>daemon available?: { exists ? <CheckIcon /> : <ExclamationCircleIcon /> }</p>
                    <Card>
                        <CardTitle>Refresh database</CardTitle>
                        <CardBody>
                            <Button variant="primary" onClick={() => refreshDatabase()} isLoading={isRefreshing}>Refresh</Button>
                            {isRefreshing && <Button variant="secondary" isDanger onClick={() => cancelRefreshDatabase()}>Cancel refresh</Button>}

                        </CardBody>
                        {events.length !== 0 &&
                            <CardBody>
                                <h4>Events</h4>
                                <List isBordered>
                                    {events.map((evt, idx) => {
                                        return <ListItem key={idx} icon={<CheckIcon />}>{evt}</ListItem>;
                                    })}
                                </List>
                            </CardBody>
                        }
                    </Card>
                </Content>
            </PageSection>
        </Page>

    );
};

document.addEventListener("DOMContentLoaded", async () => {
    const dnf5daemon_exists = await PK.detect();
    console.log("dnf5daemon", dnf5daemon_exists);

    const root = createRoot(document.getElementById("dnf5daemon"));
    root.render(<DnfPage exists={dnf5daemon_exists} />);
});
