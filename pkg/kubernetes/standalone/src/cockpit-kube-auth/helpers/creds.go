/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

package helpers

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io/ioutil"
	"strings"
)

type Credentials struct {
	UserName    string
	DisplayName string

	password    string
	bearerToken string

	authHeader string
	authType   string
}

func (self *Credentials) GetHeader() string {
	return self.authHeader
}

func (self *Credentials) GetToken() string {
	return self.bearerToken
}

func (self *Credentials) GetApiUserMap() map[string]interface{} {
	m := make(map[string]interface{})
	name := self.UserName
	if name == "" {
		name = "cockpit-container-user"
	}

	user := make(map[string]string)
	if self.password != "" {
		user["password"] = self.password
		user["username"] = self.UserName
	} else {
		user["token"] = self.bearerToken
	}

	m["name"] = self.UserName
	m["user"] = user

	return m
}

func NewCredentials(authType string, authData string) (*Credentials, error) {
	cred := new(Credentials)
	cred.authType = strings.ToLower(authType)
	if cred.authType == "basic" {
		raw, err := base64.StdEncoding.DecodeString(authData)
		if err != nil {
			return nil, errors.New(fmt.Sprintf("Couldn't decode basic header: %s", err))
		}
		parts := strings.SplitN(string(raw), ":", 2)
		cred.UserName = parts[0]
		if len(parts) > 1 {
			cred.password = parts[1]
		}
		cred.authHeader = fmt.Sprintf("Basic %s", authData)
	} else if cred.authType == "bearer" {
		cred.bearerToken = authData
		cred.authHeader = fmt.Sprintf("Bearer %s", cred.bearerToken)

	} else if cred.authType == "negotiate" {
		cred.UserName = "Unauthenticated"
	} else {
		return nil, errors.New(fmt.Sprintf("Unsuported authentication type %s", authType))
	}
	return cred, nil
}

func NewCredentialsForSystem() (*Credentials, error) {
	token, err := ioutil.ReadFile("/var/run/secrets/kubernetes.io/serviceaccount/token")
	if err != nil {
		return nil, err
	}
	return NewCredentials("bearer", string(token))
}
