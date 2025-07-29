
/*******************************************************************************
 * Copyright (c) Hilscher Gesellschaft fuer Systemautomation mbH
 * See Hilscher_Source_Code_License.txt
 ********************************************************************************/
import React, { useEffect, useState } from "react";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { ExclamationCircleIcon } from '@patternfly/react-icons';
import {
  Alert,
  DescriptionList,
  DescriptionListTerm,
  DescriptionListGroup,
  DescriptionListDescription
} from '@patternfly/react-core';
import cockpit from "cockpit";

const _ = cockpit.gettext;

interface HostnameResolveModalProps {
    isOpen: boolean;
    onClose: () => void;
    systemHostname: string;
    aziotHostname: string;
    onResolve: () => void;
    isLoading: boolean;
    error: string | null;
}

function HostnameResolveModal({ isOpen, onClose, systemHostname, aziotHostname, onResolve, isLoading, error }: Readonly<HostnameResolveModalProps>) {
    return (
        <Modal
            isOpen={isOpen}
            position="top"
            variant="medium"
            onClose={onClose}
            id="hostname-mismatch-modal"
        >
            <ModalHeader title={_("Resolve hostname mismatch")} />
            <ModalBody>
                <Stack hasGutter>
                    {error && (
                        <StackItem>
                            <Alert variant="danger" title={<p className="modal_error_title">{_("Failed to update hostname and restart containers")}</p>} ouiaId="DangerAlert">
                                <p className="modal_error_message">{error}</p>
                            </Alert>
                        </StackItem>
                    )}
                    <StackItem>
                        <p>{_("A mismatch between the system hostname and the hostname configured in Azure IIoT is causing disruptions in services related to netFIELD.io.")}</p>
                    </StackItem>
                    <StackItem>
                        <p>{_("To restore and maintain proper functionality, the hostname in the Azure IIoT configuration must be updated, and all currently running containers need to be recreated.")}</p>
                        <p>{_("Click 'Resolve' to fix the mismatch, or 'Cancel' to abort the operation.")}</p>
                    </StackItem>
                    <StackItem>
                        <DescriptionList columnModifier={{ default: '2Col' }}>
                            <DescriptionListGroup>
                                <DescriptionListTerm><p className="modal_simple_list_title">System Hostname</p></DescriptionListTerm>
                                <DescriptionListDescription>{systemHostname}</DescriptionListDescription>
                            </DescriptionListGroup>
                            <DescriptionListGroup>
                                <DescriptionListTerm><p className="modal_simple_list_title">Azure Hostname</p></DescriptionListTerm>
                                <DescriptionListDescription>{aziotHostname}</DescriptionListDescription>
                            </DescriptionListGroup>
                        </DescriptionList>
                    </StackItem>
                </Stack>
            </ModalBody>
            <ModalFooter>
                <Button 
                    variant='primary' 
                    onClick={onResolve}
                    isLoading={isLoading}
                    isDisabled={isLoading}
                >
                    {isLoading ? _("Resolving...") : _("Resolve")}
                </Button>
                <Button 
                    variant='link' 
                    className='btn-cancel' 
                    onClick={onClose}
                    isDisabled={isLoading}
                >
                    {_("Cancel")}
                </Button>
            </ModalFooter>
        </Modal>
    );
}

function useSystemHostname() {
    const [hostname, setHostname] = useState("");

    useEffect(() => {
        // Watch the file for changes using cockpit.file().watch
        const file = cockpit.file("/etc/hostname", { superuser: "try" });

        // Initial read
        file.read().then(content => {
            setHostname(content ? content.trim() : "");
        }).catch(() => {
            setHostname("");
        });

        // Watch for changes
        file.watch((content) => {
            setHostname(content ? content.trim() : "");
        });

        return () => {
            file.close();
        };
    }, []);

    return hostname;
}

function useAziotHostname() {
    const [hostname, setHostname] = useState("");

    useEffect(() => {
        const file = cockpit.file("/etc/aziot/config.toml", { superuser: "try" });

        // Initial read
        file.read().then(content => {
            if (!content) {
                console.warn(`File is empty or not readable: ${file.path}`);
                setHostname("");
                return;
            }
            const regex = /^\s*hostname\s*=\s*["']?([^"'\n]+)["']?/m;
            const match = regex.exec(content);
            setHostname(match ? match[1].trim() : "");
        }).catch(() => {
            setHostname("");
        });

        // Watch for changes
        file.watch((content) => {
            if (!content) {
                setHostname("");
                return;
            }
            const regex = /^\s*hostname\s*=\s*["']?([^"'\n]+)["']?/m;
            const match = regex.exec(content);
            setHostname(match ? match[1].trim() : "");
        });

        return () => {
            file.close();
        };
    }, []);

    return hostname;
}

const useDeviceOnboardedStatus = () => {
    const [state, setState] = useState(false);

    useEffect(() => {
        cockpit.spawn(["systemctl", "is-active", "iotedge-docker"], { superuser: "try" }).then((result) => {
            if (result.includes('active')) {
                setState(true);
            } else {
                console.warn("iotedge-docker service is not active:", result);
            }
        }).catch((error) => {
            let msg = error;
            if (error && typeof error === "object" && "message" in error) {
                msg = (error as { message: string }).message || "";
            }
            console.error("Failed to check device onboarded status:", msg);
        });
    }, [state]);


    return state;
}

export const HostnameMismatchIndicator = () => {
    const [showIndicator, setShowIndicator] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const systemHostname = useSystemHostname();
    const aziotHostname = useAziotHostname();
    const isDeviceOnboarded = useDeviceOnboardedStatus();
    const isHostnameChanged = systemHostname !== aziotHostname && systemHostname !== "" && aziotHostname !== "";

    useEffect(() => {
        if (isHostnameChanged && isDeviceOnboarded) {
            setShowIndicator(true);
        } else {
            setShowIndicator(false);
        }
    }, [isHostnameChanged, isDeviceOnboarded]);

    if (!isHostnameChanged || !isDeviceOnboarded) {
        return null;
    }

    const updateAziotHostnameAndRestartContainers = async (systemHostname: string) => {
        let content = null;
        let configFile = null;
        let isContentReplaced = false;
        try {
            setIsLoading(true);
            setError(null);
            // Update the hostname in the aziot config file
            configFile = cockpit.file("/etc/aziot/config.toml", { superuser: "try" });
            content = await configFile.read();
            if (!content) {
                throw new Error("Failed to read /etc/aziot/config.toml");
            }
            const updatedContent = content.replace(/^\s*hostname\s*=\s*["']?([^"'\n]+)["']?/m, `hostname = "${systemHostname}"`);
            await configFile.replace(updatedContent);
            isContentReplaced = true;

            // Stop IoT Edge system
            await cockpit.spawn(["iotedge", "system", "stop"], { superuser: "try" });

            // Check if Docker daemon is running before attempting container operations
            try {
                // (> inactive is device offboarded)
                const iotEdgeDockerState = await cockpit.spawn(["systemctl", "is-active", "iotedge-docker"], { superuser: "try" });
                if (iotEdgeDockerState.includes('active')) {
                    // If daemon is running, try to get container IDs and remove them
                    try {
                        const containerIds = await cockpit.spawn(["docker-iotedge", "ps", "-aq"], { superuser: "try" });
                        if (containerIds?.trim()) {
                            const containerList = containerIds.trim().split('\n').filter(id => id.trim());
                            if (containerList.length > 0) {
                                await cockpit.spawn(["docker-iotedge", "rm", "-f", ...containerList], { superuser: "try" });
                            }
                        }
                    } catch (dockerError) {
                        console.warn("Docker container cleanup failed:", dockerError);
                        // Continue anyway - containers might already be gone
                    }
                }
            } catch (daemonError) {
                console.warn("IoT Edge Docker daemon is not running:", daemonError);
                // Continue anyway - device might be offboarded
            }

            // Apply new configuration
            await cockpit.spawn(["iotedge", "config", "apply"], { superuser: "try" });

            setShowIndicator(false); // Close dialog on success
        } catch (error) {
            if (error && typeof error === "object" && error !== null && "message" in error && typeof (error as any).message === "string") {
                setError((error as { message: string }).message || "");
            } else {
                setError("Failed to update hostname and restart containers");
            }

            if (isContentReplaced && content && configFile) {
                // fallback to original content if iotedge-docker command fails
                await configFile.replace(content);
            }

            throw error; // Re-throw to handle in the catch block
        } finally {
            setIsLoading(false);
        }
    };

    const handleResolve = async () => {
        await updateAziotHostnameAndRestartContainers(systemHostname);
    };

    return (
        <>
            <Button
                id="superuser-new-action"
                variant="link"
                onClick={() => setShowModal(true)}
                className="ct-locked"
            >
                <span className="ct-lock-wrapper">
                    <ExclamationCircleIcon />
                    {_("Hostname mismatch")}
                </span>
            </Button>
            {showModal&& 
                <HostnameResolveModal
                    isOpen={showIndicator}
                    onClose={() => setShowModal(false)}
                    systemHostname={systemHostname}
                    aziotHostname={aziotHostname}
                    onResolve={handleResolve}
                    isLoading={isLoading}
                    error={error}
                />
            }
        </>
    );
};