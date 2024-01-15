import React, { useEffect, useState } from "react";
import cockpit from "cockpit";
import {
    Card,
    CardBody,
    CardTitle, CodeBlock, CodeBlockCode,
    EmptyStateVariant,
    List,
    ListItem,
    ListVariant, Spinner
} from "@patternfly/react-core";
import "./bootInfo.scss";
import { EmptyStatePanel } from "../lib/cockpit-components-empty-state.jsx";

const _ = cockpit.gettext;

export function BootInfo({ user }) {
    const [svg, setSvg] = useState(undefined);
    const [text, setText] = useState(null);
    const userMode = user !== "system";

    useEffect(() => {
        const cmd = userMode ? ["systemd-analyze", "--user", "plot"] : ["systemd-analyze", "plot"];
        cockpit.spawn(cmd)
                .then(svg_xml => {
                    try {
                        const doc = new DOMParser().parseFromString(svg_xml, "text/xml");

                        const topLevelText = doc.querySelectorAll("*:not(g) > text");
                        const topLevelTextContent = [...topLevelText].map(e => {
                            const content = e.textContent;
                            e.remove();
                            return content;
                        });
                        setText(topLevelTextContent);

                        const svgElem = doc.querySelector("svg");
                        svgElem.style.scale = "0.5";
                        const [plot, legend] = doc.querySelectorAll("g");
                        legend.remove();
                        [...plot.querySelectorAll("text.left"), ...plot.querySelectorAll("text.right")].forEach((text) => {
                            // Sets up attributes to make it possible jump to the page of a specific service
                            const match = text.innerHTML.match(/^(?<service>.+\.[a-z._-]+)(\s+\((?<time>\d+(\.\d+)?)\w+\))?$/);
                            if (match !== null) {
                                const service = match.groups.service;
                                const time = match.groups.time;
                                text.setAttribute("data-service", service);
                                text.setAttribute("data-time", time);
                                text.classList.add("clickable-service");
                            }
                        });
                        setSvg(doc.documentElement);
                    } catch (e) {
                        setSvg(null);
                        setText(_("There was an error parsing the output of systemd-analyze"));
                    }
                })
                .catch((e) => {
                    setSvg(null);
                    setText(_("There was an error reading the output of systemd-analyze"));
                });
    }, [userMode]);

    if (svg === undefined) {
        const paragraph = (
            <Spinner size="xl" />
        );
        return (
            <div className="pf-v5-c-page__main-section">
                <EmptyStatePanel variant={EmptyStateVariant.xs} title={_("Loading")} headingLevel="h4" paragraph={paragraph} />
            </div>
        );
    }

    if (svg === null) {
        const paragraph = (
            <>
                {_("systemd-analyze failed to load boot info and returned the following error:")}
            </>
        );
        const secondary = (
            <CodeBlock>
                <CodeBlockCode id="code-content">{text.toString()}</CodeBlockCode>
            </CodeBlock>
        );
        return (
            <div className="pf-v5-c-page__main-section">
                <EmptyStatePanel variant={EmptyStateVariant.xs} title={_("Failure")} headingLevel="h4" paragraph={paragraph} secondary={secondary} />
            </div>
        );
    }

    const plotClicked = (event) => {
        const service = event.target.getAttribute("data-service");
        if (service !== null) {
            cockpit.jump(`/system/services#/${service}`, cockpit.transport.host);
        }
    };

    return (
        <div className="pf-v5-c-page__main-section">
            <Card>
                <CardTitle>{ _("Boot Info") }</CardTitle>
                <CardBody>
                    <>
                        {text.map(t => {
                            return <p key={t}>{t}</p>;
                        })}
                    </>
                    <List className="legend" isPlain variant={ListVariant.inline}>
                        <ListItem>
                            <div className="legendColor activating" />
                            { _("Activating") }
                        </ListItem>
                        <ListItem>
                            <div className="legendColor active" />
                            { _("Active") }
                        </ListItem>
                        <ListItem>
                            <div className="legendColor deactivating" />
                            { _("Deactivating") }
                        </ListItem>
                        <ListItem>
                            <div className="legendColor security" />
                            { _("Setting up security module") }
                        </ListItem>
                        <ListItem>
                            <div className="legendColor generators" />
                            { _("Generators") }
                        </ListItem>
                        <ListItem>
                            <div className="legendColor unitsload" />
                            { _("Loading unit files") }
                        </ListItem>
                    </List>
                    <div className="chart-container">
                        <div className="chart" role="presentation" onClick={plotClicked} onKeyDown={(_) => null} dangerouslySetInnerHTML={{ __html: svg.outerHTML }} />
                    </div>
                </CardBody>
            </Card>
        </div>
    );
}
