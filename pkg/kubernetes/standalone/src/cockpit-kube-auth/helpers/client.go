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
	"bytes"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"strconv"
)

const CA_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"

type AuthError struct {
	msg string
}

func (v *AuthError) Error() string {
	return v.msg
}

func newAuthError(msg string) error {
	return &AuthError{msg}
}

// helpers
func namedArrayObject(key string, name string, m map[string]interface{}) []map[string]interface{} {
	nm := make(map[string]interface{})
	nm[key] = m
	nm["name"] = name
	s := make([]map[string]interface{}, 1)
	s[0] = nm
	return s
}

// Struct for decoding json
type userInfo struct {
	FullName string `json:"fullName"`
	MetaData struct {
		Name string `json:"name"`
	} `json:"metadata"`
}

type apiVersions struct {
	Versions []string `json:"versions"`
}

// Simple client
type Client struct {
	host    string
	version string

	caData   string
	insecure bool
	requireOpenshift bool

	userAPI string
	client      *http.Client
}

func doRequest(client *http.Client, method string, path string, auth string, body []byte) (*http.Response, error) {
	var req *http.Request
	var err error
	if body != nil {
		req, err = http.NewRequest(method, path, bytes.NewReader(body))
	} else {
		req, err = http.NewRequest(method, path, nil)
	}

	if err != nil {
		return nil, err
	}

	if auth != "" {
		req.Header.Add("Authorization", auth)
	}
	return client.Do(req)
}

func (self *Client) fetchVersion(authHeader string) error {
	path := fmt.Sprintf("%s/api", self.host)
	resp, err := doRequest(self.client, "GET", path, authHeader, nil)

	// Treat connection errors as internal errors and invalid
	// responses as auth errors
	if err != nil {
		return errors.New(fmt.Sprintf("Couldn't connect to the api: %s", err))
	}

	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return newAuthError(fmt.Sprintf("Couldn't get api version: %s", resp.Status))
	}

	data := apiVersions{}
	deErr := json.NewDecoder(resp.Body).Decode(&data)
	if deErr != nil {
		return newAuthError(fmt.Sprintf("Couldn't get api version: %s", deErr))
	}

	if len(data.Versions) < 1 {
		return newAuthError(fmt.Sprintf("Couldn't get api version: invalid data"))
	}

	self.version = data.Versions[0]
	return nil
}

func (self *Client) guessUserData(creds *Credentials) error {
	// Do this explictly so that we know we have a valid response
	// Kubernetes doesn't provide any way for a caller
	// to find out who it is, so fill in the
	// user as best we can.
	err := self.fetchVersion(creds.GetHeader())
	if err != nil {
		return err
	}

	// If the API is open make sure we don't have any credentials
	// so we aren't just saying yes to everything
	resp, e := self.DoRequest("GET", "api", "", nil, nil)

	// Treat connection errors as internal errors and invalid
	// responses as auth errors
	if e != nil {
		return errors.New(fmt.Sprintf("Couldn't connect to api: %s", e))
	}

	defer resp.Body.Close()
	if resp.StatusCode != 401 && resp.StatusCode != 403 {
		if (creds.authHeader != "") {
			return newAuthError(fmt.Sprintf("Couldn't get api version: %s", resp.Status))
		}
	}

	creds.DisplayName = creds.UserName
	return nil
}

func (self *Client) fetchUserData(creds *Credentials) error {
	resp, err := self.DoRequest("GET", self.userAPI, "users/~", creds, nil)
	if err != nil {
		return err
	}

	defer resp.Body.Close()

	/*
	 * If we got a 404 and this isn't token auth
	 * we don't have any way to get a user object
	 * so just make sure the api isn't open
	 */
	if resp.StatusCode == 404 && self.requireOpenshift {
		return errors.New("Couldn't connect: Incompatible API")
	} else if resp.StatusCode == 404 && creds.UserName != "" {
		return self.guessUserData(creds)
	} else if resp.StatusCode != 200 {
		return newAuthError(fmt.Sprintf("Couldn't get user data: %s", resp.Status))
	}

	data := userInfo{}
	deErr := json.NewDecoder(resp.Body).Decode(&data)
	if deErr != nil {
		return newAuthError(fmt.Sprintf("Couldn't get user json data: %s", deErr))
	}

	creds.UserName = data.MetaData.Name
	if creds.UserName != "" {
		creds.DisplayName = data.FullName
		if creds.DisplayName == "" {
			creds.DisplayName = creds.UserName
		}
	} else {
		return newAuthError(fmt.Sprintf("Openshift user data wasn't valid: %v", data))
	}
	return nil
}

func (self *Client) DoRequest(method string, api string, resource string,
	creds *Credentials, body []byte) (*http.Response, error) {
	if self.host == "" {
		return nil, errors.New("No kubernetes available")
	}

	authHeader := ""
	if creds != nil {
		authHeader = creds.GetHeader()
	}

	if self.version == "" {
		err := self.fetchVersion(authHeader)
		if err != nil {
			return nil, err
		}
	}

	path := fmt.Sprintf("%s/%s/%s/%s", self.host, api, self.version, resource)
	resp, rErr := doRequest(self.client, method, path, authHeader, body)
	if rErr != nil {
		return nil, errors.New(fmt.Sprintf("Couldn't connect: %s", rErr))
	}
	return resp, nil
}

func (self *Client) Login(authType string, authData string) ([]byte, error) {

	creds, err := NewCredentials(authType, authData)
	if err == nil {
		err = self.fetchUserData(creds)
	}

	if err != nil {
		if (creds.authType == "negotiate") {
			return nil, newAuthError(fmt.Sprintf("Negotiate failed: %s", err))
		}
		return nil, err
	}

	user_data := creds.GetApiUserMap()
	cluster := make(map[string]interface{})
	cluster["server"] = self.host
	if self.caData != "" {
		cluster["certificate-authority-data"] = self.caData
	}

	cluster["insecure-skip-tls-verify"] = self.insecure
	clusters := namedArrayObject("cluster", "container-cluster", cluster)

	context := make(map[string]interface{})
	context["cluster"] = "container-cluster"
	context["user"] = user_data["name"]
	contexts := namedArrayObject("context", "container-context", context)

	users := make([]map[string]interface{}, 1)
	users[0] = user_data

	login_data := make(map[string]interface{})
	login_data["apiVersion"] = self.version
	login_data["displayName"] = creds.DisplayName
	login_data["current-context"] = "container-context"
	login_data["clusters"] = clusters
	login_data["contexts"] = contexts
	login_data["users"] = users

	data := make(map[string]interface{})
	data["user"] = user_data["name"]
	data["login-data"] = login_data
	return json.Marshal(&data)
}

func NewClient() *Client {
	var caData []byte = nil
	var pool *x509.CertPool

	ac := new(Client)
	ac.insecure = false
	ac.host = os.Getenv("KUBERNETES_SERVICE_HOST")
	if ac.host != "" {
		// assume we are always on https
		ac.host = fmt.Sprintf("https://%s", ac.host)
		port := os.Getenv("KUBERNETES_SERVICE_PORT")
		if port != "" {
			ac.host = fmt.Sprintf("%s:%s", ac.host, port)
		}
	}

	ac.userAPI = os.Getenv("KUBERNETES_USER_API")
	if ac.userAPI == "" {
		ac.userAPI = "oapi"
	}

	ac.requireOpenshift, _ = strconv.ParseBool(os.Getenv("REGISTRY_ONLY"))

	ac.insecure, _ = strconv.ParseBool(os.Getenv("KUBERNETES_INSECURE"))
	if !ac.insecure {
		data := os.Getenv("KUBERNETES_CA_DATA")
		if data != "" {
			caData = []byte(data)
		}

		if caData == nil {
			var err error
			caData, err = ioutil.ReadFile(CA_PATH)
			if err != nil {
				log.Println(fmt.Sprintf("Couldn't load CA data: %s", err))
			}
		}

		if caData != nil {
			pool = x509.NewCertPool()
			pool.AppendCertsFromPEM(caData)
			ac.caData = base64.StdEncoding.EncodeToString(caData)
		}
	}

	tr := &http.Transport{
		TLSClientConfig: &tls.Config{RootCAs: pool, InsecureSkipVerify: ac.insecure},
	}
	ac.client = &http.Client{Transport: tr}

	return ac
}
