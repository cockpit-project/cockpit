/*
 * Copyright (C) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import React, { useState, useRef, useEffect } from "react";
import {
    Modal, ModalBody, ModalHeader
} from '@patternfly/react-core/dist/esm/components/Modal/index.js';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { InputGroup, InputGroupItem } from "@patternfly/react-core/dist/esm/components/InputGroup/index.js";
import { UserIcon, RobotIcon } from '@patternfly/react-icons';
import { Remarkable } from "remarkable";
import * as timeformat from "timeformat";
import { useDialogs } from "dialogs";

const _ = cockpit.gettext;

const defined_remarkable = new Remarkable();

interface Message {
    content: string;
    id: string;
    role: "user" | "bot";
    name: string;
    timestamp: string;
}

export const ChatBotModal = ({}) => {
    const dialogs = useDialogs();
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [isSendButtonDisabled, setIsSendButtonDisabled] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const handleSend = () => {
        const question = input.trim();
        if (!question)
            return;

        setInput("");
        setIsSendButtonDisabled(true);

        const userMsg: Message = {
            content: question,
            id: Date.now().toString(),
            role: "user",
            name: "user",
            timestamp: timeformat.time(new Date()),
        };
        setMessages(prev => [...prev, userMsg]);

        cockpit.http({
            address: "cert.console.stage.redhat.com",
            port: 443,
            tls: {
                certificate: { file: "/etc/pki/consumer/cert.pem" },
                key: { file: "/etc/pki/consumer/key.pem" },
                proxy: "http://squid.corp.redhat.com:3128/",
                headers: { "Content-Type": "application/json" },
            },
            superuser: "require",
        }).post("/api/lightspeed/v1/infer", { question })
                .then(answer => {
                    try {
                        const response = JSON.parse(answer);
                        const botMsg: Message = {
                            content: response.data.text,
                            id: response.data.request_id,
                            role: "bot",
                            name: "bot",
                            timestamp: timeformat.time(new Date()),
                        };
                        setMessages(prev => [...prev, botMsg]);
                    } catch {
                        const errorMsg: Message = {
                            content: _("Something went wrong processing the response"),
                            id: "error-" + Date.now(),
                            role: "bot",
                            name: "bot",
                            timestamp: timeformat.time(new Date()),
                        };
                        setMessages(prev => [...prev, errorMsg]);
                    }
                })
                .catch(err => {
                    console.error("Chat request failed:", err);
                    const errorMsg: Message = {
                        content: _("Failed to get a response"),
                        id: "error-" + Date.now(),
                        role: "bot",
                        name: "bot",
                    };
                    setMessages(prev => [...prev, errorMsg]);
                })
                .finally(() => setIsSendButtonDisabled(false));
    };

    return (
        <Modal isOpen position="top" variant="medium"
               onClose={dialogs.close}>
            <ModalHeader title={_("Ask Cockpit")} />
            <ModalBody>
                <div style={{ maxHeight: "300px", overflowY: "auto", marginBottom: "1rem" }}>
                    {messages.map(msg => (
                        <div key={msg.id} style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: "0.5rem",
                            justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                            marginBottom: "0.5rem",
                        }}>
                            {msg.role === "bot" && <RobotIcon />}
                            <Card isCompact isPlain={msg.role === "user"} style={{
                                maxWidth: "80%",
                                borderRadius: "1rem",
                                ...(msg.role === "user" && {
                                    backgroundColor: "var(--pf-t--global--color--brand--200)",
                                    color: "var(--pf-t--global--color--nonstatus--white--default)",
                                }),
                            }}>
                                <CardTitle>
                                    {msg.role === "user" ? _("You") : _("Bot")}
                                    <small style={{ marginInlineStart: "0.5rem", opacity: 0.7 }}>{msg.timestamp}</small>
                                </CardTitle>
                                <CardBody>
                                    {msg.role === "bot"
                                        ? <span dangerouslySetInnerHTML={{ __html: defined_remarkable.render(msg.content) }} />
                                        : msg.content}
                                </CardBody>
                            </Card>
                            {msg.role === "user" && <UserIcon />}
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
                </div>
                <InputGroup>
                    <InputGroupItem isFill>
                        <TextInput
                            id="chat-input"
                            value={input}
                            onChange={(_event, value) => setInput(value)}
                            onKeyDown={e => { if (e.key === "Enter") handleSend() }}
                            placeholder={_("Type a message…")}
                            isDisabled={isSendButtonDisabled}
                        />
                    </InputGroupItem>
                    <InputGroupItem>
                        <Button
                            variant="primary"
                            isDisabled={isSendButtonDisabled || !input.trim()}
                            onClick={handleSend}
                            isLoading={isSendButtonDisabled}
                        >
                            {_("Send")}
                        </Button>
                    </InputGroupItem>
                </InputGroup>
            </ModalBody>
        </Modal>
    );
};
